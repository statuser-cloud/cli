import { t } from '../i18n.js';
import { HOST_PATTERN } from './host-pattern.js';
import { textLength } from '../text-length.js';
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
  /** `name` is in the file: null then clears the name, absence keeps it. */
  nameGiven: boolean;
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
const YEAR = 31_536_000;
const RANGES: Record<string, [number, number]> = {
  check_interval: [60, 3600],
  request_timeout: [1, 60],
  incident_confirm_delay: [0, 3600],
  latency_trigger_ms: [50, 60_000],
  heartbeat_grace_interval: [0, YEAR],
  port: [1, 65_535],
};
const BOOLEANS = [
  'is_latency_alert_enabled',
  'is_ssl_check',
  'is_domain_check',
  'is_blocklist_check',
  'is_follow_redirects',
];
// String fields and their `MaxLength`; `null` — no limit.
const STRINGS: Record<string, number | null> = {
  host: 300,
  description: 500,
  body: null,
  keyword: 256,
  http_auth_username: 256,
  llm_model: 128,
};
const SECRET_MAX: Record<string, number> = {
  http_auth_password: 4096,
  http_auth_token: 4096,
  llm_api_key: 512,
};
const NAME_MAX = 150;
// What `sanitizeHeaders` keeps: an RFC 7230 token as the name and no
// control characters in the value. Anything else the backend drops silently,
// so a file with it would wipe the server's headers on apply.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$/;
// eslint-disable-next-line no-control-regex
const HEADER_CONTROL = /[\x00-\x08\x0a-\x1f\x7f]/;
// HTTP credentials allow no control characters at all (`server-http-auth.ts`).
// eslint-disable-next-line no-control-regex
const AUTH_CONTROL = /[\x00-\x1f\x7f]/;
// `SUCCESS_HTTP_CODE_PATTERN` and its list size in the backend.
const SUCCESS_CODE = /^[1-5](xx|\d\d)$/;
const SUCCESS_CODES_MAX = 20;

/**
 * Validates the `servers` section. Everything that can be checked without
 * the API is checked here, before the first write: unknown or misplaced
 * fields, types, ranges, lengths, header names, missing `$VAR`s.
 */
export function parseServersSection(
  raw: unknown,
  env: NodeJS.ProcessEnv,
  fail: (problem: string) => never,
): DesiredServer[] {
  if (!Array.isArray(raw)) return fail(`servers: ${t.cfgArray}`);
  const result: DesiredServer[] = [];
  for (const [index, item] of raw.entries()) {
    const at = `servers[${index}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return fail(`${at}: ${t.cfgObject}`);
    }
    const entry = item as Record<string, unknown>;
    const protocol = entry.protocol as ManagedProtocol;
    if (!MANAGED_PROTOCOLS.includes(protocol)) {
      return fail(
        `${at}.protocol: ${t.cfgProtocol(MANAGED_PROTOCOLS.join(', '))}`,
      );
    }
    if (
      entry.id !== undefined &&
      (!Number.isInteger(entry.id) || (entry.id as number) <= 0)
    ) {
      return fail(`${at}.id: ${t.cfgPositiveInt}`);
    }
    const name =
      typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : null;
    if (entry.name !== undefined && entry.name !== null && name === null) {
      return fail(`${at}.name: ${t.cfgNonEmptyString}`);
    }
    if (name !== null && textLength(name) > NAME_MAX) {
      return fail(`${at}.name: ${t.cfgMaxLength(NAME_MAX)}`);
    }
    if (name === null && entry.id === undefined) {
      return fail(`${at}: ${t.cfgNameOrId}`);
    }

    const readable = new Set(fieldsFor(protocol));
    const secret = new Set(secretFieldsFor(protocol));
    const fields: Record<string, unknown> = {};
    const secrets: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'id' || key === 'name' || key === 'protocol') continue;
      if (secret.has(key)) {
        // An empty Basic password is legal; tokens and keys are not.
        if (
          typeof value !== 'string' ||
          (!value && key !== 'http_auth_password')
        ) {
          return fail(`${at}.${key}: ${t.cfgString}`);
        }
        let resolved = resolveEnvValue(value, `${at}.${key}`, env);
        if (key === 'http_auth_token' || key === 'llm_api_key') {
          // The backend trims a token or key and refuses an empty one: a
          // blank LLM key would silently leave the check without the model.
          resolved = resolved.trim();
          if (!resolved) return fail(`${at}.${key}: ${t.cfgString}`);
        }
        if (key !== 'llm_api_key' && AUTH_CONTROL.test(resolved)) {
          return fail(`${at}.${key}: ${t.cfgControlChars}`);
        }
        // HTTP credentials are measured in UTF-16 units (`resolveHttpAuth`),
        // the LLM key by `@MaxLength`.
        const length =
          key === 'llm_api_key' ? textLength(resolved) : resolved.length;
        if (length > SECRET_MAX[key]!) {
          return fail(`${at}.${key}: ${t.cfgMaxLength(SECRET_MAX[key]!)}`);
        }
        secrets[key] = resolved;
        continue;
      }
      if (!readable.has(key)) {
        return fail(`${at}.${key}: ${t.cfgNotUsedBy(protocol)}`);
      }
      const problem = checkField(key, value, protocol);
      if (problem) return fail(`${at}.${key}: ${problem}`);
      if (key === 'headers') {
        const headers = (value as Array<{ key: string; value: string }>).map(
          (h) => ({
            key: h.key.trim(),
            value: resolveEnvValue(h.value, `${at}.headers`, env).trim(),
          }),
        );
        for (const header of headers) {
          if (!HEADER_NAME.test(header.key)) {
            return fail(`${at}.headers: ${t.cfgHeaderName(header.key)}`);
          }
          if (HEADER_CONTROL.test(header.value)) {
            return fail(`${at}.headers: ${t.cfgHeaderValue(header.key)}`);
          }
        }
        fields.headers = headers;
        continue;
      }
      if (key === 'success_http_codes') {
        // Stored as the API stores them, so the plan check sees `2xx`.
        fields[key] = (value as string[]).map((v) => v.trim().toLowerCase());
        continue;
      }
      fields[key] = value;
    }
    result.push({
      at,
      id: entry.id as number | undefined,
      name,
      nameGiven: entry.name !== undefined,
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
      key === 'check_interval' && protocol === 'heartbeat' ? YEAR : range[1];
    return Number.isInteger(value) &&
      (value as number) >= range[0] &&
      (value as number) <= max
      ? null
      : t.cfgRange(range[0], max);
  }
  if (BOOLEANS.includes(key)) {
    return typeof value === 'boolean' ? null : t.cfgBoolean;
  }
  if (key in STRINGS) {
    if (typeof value !== 'string') return t.cfgString;
    if (key === 'host' && !HOST_PATTERN.test(value.trim())) {
      return t.cfgHostInvalid;
    }
    // The API trims these and refuses an empty result.
    if ((key === 'keyword' || key === 'llm_model') && !value.trim()) {
      return t.cfgString;
    }
    if (key === 'http_auth_username') {
      // RFC 7617: the colon separates username and password.
      if (value.includes(':')) return t.cfgUsernameColon;
      if (AUTH_CONTROL.test(value)) return t.cfgControlChars;
    }
    const max = STRINGS[key];
    // The login goes to the API as written, and its length is checked
    // there untrimmed.
    // The login is also checked trimmed and in UTF-16 units when the
    // authorization is resolved (`resolveHttpAuth`).
    const tooLong =
      key === 'http_auth_username'
        ? textLength(value) > max! || value.trim().length > max!
        : textLength(value.trim()) > max!;
    return typeof max === 'number' && tooLong ? t.cfgMaxLength(max) : null;
  }
  if (ENUMS[key]) {
    return ENUMS[key]!.includes(value as string)
      ? null
      : t.cfgOneOf(ENUMS[key]!.join(', '));
  }
  if (key === 'locations') {
    // An empty list leaves the server without agents: it would never be checked.
    return Array.isArray(value) &&
      value.length > 0 &&
      value.every((v) => LOCATIONS.includes(v))
      ? null
      : t.cfgListOf(LOCATIONS.join(', '));
  }
  if (key === 'dns_record_types') {
    return Array.isArray(value) &&
      value.length > 0 &&
      value.every((v) => DNS_TYPES.includes(v))
      ? null
      : t.cfgListOf(DNS_TYPES.join(', '));
  }
  if (key === 'success_http_codes') {
    return Array.isArray(value) &&
      value.length >= 1 &&
      value.length <= SUCCESS_CODES_MAX &&
      value.every(
        (v) =>
          typeof v === 'string' && SUCCESS_CODE.test(v.trim().toLowerCase()),
      )
      ? null
      : t.cfgSuccessCodes(SUCCESS_CODES_MAX);
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
      : t.cfgHeaders;
  }
  return null;
}
