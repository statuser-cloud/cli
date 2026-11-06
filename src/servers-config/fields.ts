import type { Server } from '../commands/servers.js';

/** Scenarios live in their own section with script files. */
export type ManagedProtocol = Exclude<Server['protocol'], 'scenario'>;

export const MANAGED_PROTOCOLS: ManagedProtocol[] = [
  'http',
  'keyword',
  'ping',
  'tcp',
  'dns',
  'heartbeat',
  'llm',
];

// Mirrors the backend (`servers.service.ts`): which settings a protocol
// actually uses. A field outside this list is not exported, and a file that
// sets it is rejected — the backend would keep it without effect or reset it.
const SSL_DOMAIN: ManagedProtocol[] = ['http', 'keyword', 'dns'];
const CONFIRM_DELAY: ManagedProtocol[] = [
  'http',
  'keyword',
  'ping',
  'tcp',
  'llm',
];
const LATENCY: ManagedProtocol[] = ['http', 'keyword', 'tcp', 'llm'];
const HTTP_LIKE: ManagedProtocol[] = ['http', 'keyword'];

/** Readable settings the file manages, by protocol. */
export function fieldsFor(protocol: ManagedProtocol): string[] {
  const fields = ['description', 'check_interval'];
  if (protocol !== 'heartbeat') fields.push('host');
  // DNS is checked from the backend through fixed resolvers: the server's
  // timeout and regions are stored but change nothing.
  if (protocol !== 'heartbeat' && protocol !== 'dns') {
    fields.push('request_timeout', 'locations');
  }
  if (CONFIRM_DELAY.includes(protocol)) fields.push('incident_confirm_delay');
  if (LATENCY.includes(protocol)) {
    fields.push('is_latency_alert_enabled', 'latency_trigger_ms');
  }
  if (SSL_DOMAIN.includes(protocol)) {
    fields.push('is_ssl_check', 'is_domain_check', 'is_blocklist_check');
  }
  if (HTTP_LIKE.includes(protocol)) {
    fields.push(
      'http_method',
      'body',
      'headers',
      'http_auth_type',
      'http_auth_username',
      'is_follow_redirects',
      'success_http_codes',
    );
  }
  if (protocol === 'keyword') fields.push('keyword', 'keyword_mode');
  if (protocol === 'tcp') fields.push('port');
  if (protocol === 'dns') fields.push('dns_record_types');
  if (protocol === 'heartbeat') fields.push('heartbeat_grace_interval');
  if (protocol === 'llm') fields.push('llm_provider', 'llm_model');
  return fields;
}

/**
 * Write-only settings: the API never returns them, so they are never
 * exported, and a file that sets one sends it on every apply.
 */
export function secretFieldsFor(protocol: ManagedProtocol): string[] {
  if (HTTP_LIKE.includes(protocol)) {
    return ['http_auth_password', 'http_auth_token'];
  }
  if (protocol === 'llm') return ['llm_api_key'];
  return [];
}

const SET_FIELDS = new Set([
  'locations',
  'dns_record_types',
  'success_http_codes',
]);

/**
 * Comparable form of a value as the backend stores it: strings trimmed,
 * an empty body equal to none, order-free lists sorted, success codes in
 * lower case.
 */
export function normalize(field: string, value: unknown): unknown {
  if (field === 'body') {
    return typeof value === 'string' ? value.trim() : '';
  }
  if (field === 'headers') {
    return Array.isArray(value)
      ? value.map((h: { key: string; value: string }) => ({
          key: String(h.key).trim(),
          value: String(h.value).trim(),
        }))
      : [];
  }
  if (SET_FIELDS.has(field) && Array.isArray(value)) {
    const items = value.map((item) => String(item).trim());
    return (
      field === 'success_http_codes'
        ? items.map((item) => item.toLowerCase())
        : items
    ).sort();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return field === 'description' && !trimmed ? null : trimmed;
  }
  return value ?? null;
}

export function sameValue(field: string, a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(normalize(field, a)) === JSON.stringify(normalize(field, b))
  );
}

// Header names whose values usually carry credentials.
// Wide on purpose: a value shown by mistake is a leak, a value hidden by
// mistake is one `statuser api` call away. `key` covers X-Access-Key,
// Ocp-Apim-Subscription-Key and the like.
const SECRET_HEADER =
  /authorization|auth|cookie|token|secret|passw|key|session|signature|credential|private/i;

export function isSecretHeader(name: string): boolean {
  return SECRET_HEADER.test(name);
}

/**
 * The account-wide key the backend uses to reject a duplicate monitor
 * (`ServersService.findDuplicateServer`). Two servers with equal keys
 * cannot coexist, whatever their names and projects.
 */
export function duplicateKey(state: Record<string, unknown>): string {
  const protocol = state.protocol as string;
  const str = (field: string) => String(normalize(field, state[field]) ?? '');
  // JSON keeps the parts apart: with a plain separator `a|b` + `c` and
  // `a` + `b|c` would collide.
  if (protocol === 'heartbeat')
    return JSON.stringify(['heartbeat', str('name')]);
  if (protocol === 'llm') {
    return JSON.stringify([
      'llm',
      str('host'),
      str('llm_provider'),
      str('llm_model'),
    ]);
  }
  const parts = [protocol, str('host')];
  if (protocol === 'tcp') parts.push(str('port'));
  if (protocol === 'http' || protocol === 'keyword') {
    parts.push(str('http_method'), str('body'));
  }
  if (protocol === 'keyword') parts.push(str('keyword'), str('keyword_mode'));
  return JSON.stringify(parts);
}

/**
 * Whether the API would take `existing` for a duplicate of `next`
 * (`findDuplicateServer`). Directed: a null port, method, keyword or mode
 * of `next` is left out of the search, so it matches any value there.
 * `duplicateKey` stays the test for "the identity changed".
 */
export function isDuplicateOf(
  next: Record<string, unknown>,
  existing: Record<string, unknown>,
): boolean {
  const protocol = next.protocol as string;
  if (existing.protocol !== protocol) return false;
  if (protocol === 'heartbeat' || protocol === 'llm') {
    return duplicateKey(next) === duplicateKey(existing);
  }
  const value = (state: Record<string, unknown>, field: string) =>
    normalize(field, state[field]) ?? null;
  const same = (field: string) => value(next, field) === value(existing, field);
  const sameIfSet = (field: string) =>
    value(next, field) === null || same(field);
  if (!same('host')) return false;
  if (protocol === 'tcp' && !sameIfSet('port')) return false;
  if (protocol === 'http' || protocol === 'keyword') {
    if (!sameIfSet('http_method') || !same('body')) return false;
  }
  if (protocol === 'keyword') {
    return sameIfSet('keyword') && sameIfSet('keyword_mode');
  }
  return true;
}
