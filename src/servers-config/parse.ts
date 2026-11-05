import { resolveEnvValue } from '../scenarios/config.js';
import {
  fieldsFor,
  MANAGED_PROTOCOLS,
  secretFieldsFor,
  type ManagedProtocol,
} from './fields.js';

export interface DesiredServer {
  /** Index in the file, for messages. */
  at: string;
  id?: number;
  name: string | null;
  protocol: ManagedProtocol;
  /** Readable settings present in the file, as written. */
  fields: Record<string, unknown>;
  /** Write-only settings with `$VAR` resolved; sent on every apply. */
  secrets: Record<string, string>;
}

const LOCATIONS = ['msk-1', 'spb-1', 'ala-1', 'nyc-1', 'ams-1'];
const DNS_TYPES = [
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'TXT',
  'NS',
  'SOA',
  'PTR',
  'SRV',
];
const ENUMS: Record<string, string[]> = {
  http_method: ['head', 'get', 'options', 'post', 'put', 'patch'],
  keyword_mode: ['present', 'absent'],
  http_auth_type: ['none', 'basic', 'bearer'],
  llm_provider: ['openai_compatible', 'anthropic_compatible'],
};
// API bounds (`create-server.dto.ts`); checked here so a value the API
// rejects never stops apply after earlier writes.
const RANGES: Record<string, [number, number]> = {
  check_interval: [60, 3600],
  request_timeout: [1, 60],
  incident_confirm_delay: [0, 3600],
  latency_trigger_ms: [50, 60_000],
  heartbeat_grace_interval: [0, 3600],
  port: [1, 65_535],
};
// Heartbeat jobs may run once a year.
const HEARTBEAT_MAX_INTERVAL = 31_536_000;
const BOOLEANS = [
  'is_latency_alert_enabled',
  'is_ssl_check',
  'is_domain_check',
  'is_blocklist_check',
  'is_follow_redirects',
];
const STRINGS = [
  'host',
  'description',
  'body',
  'keyword',
  'http_auth_username',
  'llm_model',
];

/**
 * Validates the `servers` section. Everything that can be checked without
 * the API is checked here, before the first write: unknown or misplaced
 * fields, types, enums, empty location lists, missing `$VAR`s.
 */
export function parseServersSection(
  raw: unknown,
  env: NodeJS.ProcessEnv,
  fail: (problem: string) => never,
): DesiredServer[] {
  if (!Array.isArray(raw)) return fail('servers: array expected');
  const result: DesiredServer[] = [];
  for (const [index, item] of raw.entries()) {
    const at = `servers[${index}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return fail(`${at}: object expected`);
    }
    const entry = item as Record<string, unknown>;
    const protocol = entry.protocol as ManagedProtocol;
    if (!MANAGED_PROTOCOLS.includes(protocol)) {
      return fail(
        `${at}.protocol: one of ${MANAGED_PROTOCOLS.join(', ')} (scenarios go to the scenarios section)`,
      );
    }
    if (
      entry.id !== undefined &&
      (!Number.isInteger(entry.id) || (entry.id as number) <= 0)
    ) {
      return fail(`${at}.id: positive integer`);
    }
    const name =
      typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : null;
    if (entry.name !== undefined && entry.name !== null && name === null) {
      return fail(`${at}.name: non-empty string or null`);
    }
    if (name === null && entry.id === undefined) {
      return fail(`${at}: name or id required`);
    }
    if (protocol === 'heartbeat' && name === null) {
      return fail(`${at}.name: required for heartbeat`);
    }

    const readable = new Set(fieldsFor(protocol));
    const secret = new Set(secretFieldsFor(protocol));
    const fields: Record<string, unknown> = {};
    const secrets: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'id' || key === 'name' || key === 'protocol') continue;
      if (secret.has(key)) {
        if (typeof value !== 'string' || !value) {
          return fail(`${at}.${key}: string expected`);
        }
        secrets[key] = resolveEnvValue(value, `${at}.${key}`, env);
        continue;
      }
      if (!readable.has(key)) {
        return fail(`${at}.${key}: not used by protocol ${protocol}`);
      }
      const problem = checkField(key, value, protocol);
      if (problem) return fail(`${at}.${key}: ${problem}`);
      fields[key] =
        key === 'headers'
          ? (value as Array<{ key: string; value: string }>).map((h) => ({
              key: h.key,
              value: resolveEnvValue(h.value, `${at}.headers`, env),
            }))
          : value;
    }
    result.push({
      at,
      id: entry.id as number | undefined,
      name,
      protocol,
      fields,
      secrets,
    });
  }
  return result;
}

function checkField(
  key: string,
  value: unknown,
  protocol: ManagedProtocol,
): string | null {
  const range = RANGES[key];
  if (range) {
    const max =
      key === 'check_interval' && protocol === 'heartbeat'
        ? HEARTBEAT_MAX_INTERVAL
        : range[1];
    return Number.isInteger(value) &&
      (value as number) >= range[0] &&
      (value as number) <= max
      ? null
      : `whole number ${range[0]}–${max}`;
  }
  if (BOOLEANS.includes(key)) {
    return typeof value === 'boolean' ? null : 'true or false expected';
  }
  if (STRINGS.includes(key)) {
    return typeof value === 'string' ? null : 'string expected';
  }
  if (ENUMS[key]) {
    return ENUMS[key]!.includes(value as string)
      ? null
      : `one of ${ENUMS[key]!.join(', ')}`;
  }
  if (key === 'locations') {
    // An empty list leaves the server without agents: it would never be checked.
    return Array.isArray(value) &&
      value.length > 0 &&
      value.every((v) => LOCATIONS.includes(v))
      ? null
      : `non-empty list of ${LOCATIONS.join(', ')}`;
  }
  if (key === 'dns_record_types') {
    return Array.isArray(value) &&
      value.length > 0 &&
      value.every((v) => DNS_TYPES.includes(v))
      ? null
      : `non-empty list of ${DNS_TYPES.join(', ')}`;
  }
  if (key === 'success_http_codes') {
    return Array.isArray(value) && value.every((v) => typeof v === 'string')
      ? null
      : 'list of strings expected';
  }
  if (key === 'headers') {
    return Array.isArray(value) &&
      value.every(
        (h) =>
          typeof h === 'object' &&
          h !== null &&
          typeof h.key === 'string' &&
          typeof h.value === 'string',
      )
      ? null
      : 'list of { "key", "value" } expected';
  }
  return null;
}
