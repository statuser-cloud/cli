import type { Server } from './commands/servers.js';
import { isForbiddenHost } from './servers-config/forbidden-host.js';
import { HOST_PATTERN } from './servers-config/host-pattern.js';
import { textLength } from './text-length.js';

type Protocol = Server['protocol'];

/** What `servers update` was asked to set; undefined — leave as is. */
export interface BulkChange {
  /** Name, address and description are set on one server at a time. */
  name?: string;
  host?: string;
  /** An empty string removes the description. */
  description?: string;
  interval?: number;
  timeout?: number;
  regions?: string[];
  confirmDelay?: number;
  ssl?: boolean;
  domain?: boolean;
  blocklist?: boolean;
  /** A threshold in ms turns the alert on, false turns it off. */
  latency?: number | false;
}

export interface PlannedPatch {
  body: Record<string, unknown>;
  /** Field names that change, for the plan output. */
  fields: string[];
  /** Requested fields that do not apply to this server's protocol. */
  notApplicable: string[];
}

// Mirrors the backend: SSL and domain checks run for http, keyword and dns;
// the incident confirmation delay is ignored by dns, heartbeat and scenario;
// the latency alert exists for http, keyword, tcp and llm.
const SSL_DOMAIN: Protocol[] = ['http', 'keyword', 'dns'];
const NO_CONFIRM_DELAY: Protocol[] = ['dns', 'heartbeat', 'scenario'];
const LATENCY: Protocol[] = ['http', 'keyword', 'tcp', 'llm'];

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Pure: the PATCH for one server. Only fields that actually change are
 * sent; a field that does not apply to the protocol is reported instead of
 * being sent — the backend would silently reset it rather than reject it.
 */
export function planServerPatch(
  server: Server,
  change: BulkChange,
): PlannedPatch {
  const body: Record<string, unknown> = {};
  const fields: string[] = [];
  const notApplicable: string[] = [];
  const set = (field: string, key: string, value: unknown) => {
    body[key] = value;
    fields.push(field);
  };

  if (change.name !== undefined && change.name.trim() !== server.name) {
    set('name', 'name', change.name.trim());
  }
  if (change.host !== undefined) {
    // The address of a heartbeat or a scenario is made by the system.
    if (server.protocol === 'heartbeat' || server.protocol === 'scenario') {
      notApplicable.push('host');
    } else if (change.host.trim() !== server.host) {
      set('host', 'host', change.host.trim());
    }
  }
  if (change.description !== undefined) {
    const description = change.description.trim() || null;
    if (description !== (server.description ?? null)) {
      set('description', 'description', description);
    }
  }
  if (
    change.interval !== undefined &&
    change.interval !== server.check_interval
  ) {
    set('interval', 'check_interval', change.interval);
  }
  if (change.timeout !== undefined) {
    if (server.protocol === 'heartbeat' || server.protocol === 'dns') {
      notApplicable.push('timeout');
    } else if (change.timeout !== server.request_timeout) {
      set('timeout', 'request_timeout', change.timeout);
    }
  }
  if (change.regions !== undefined) {
    if (server.protocol === 'heartbeat' || server.protocol === 'dns') {
      notApplicable.push('regions');
    } else if (server.protocol === 'scenario' && change.regions.length !== 1) {
      notApplicable.push('regions');
    } else if (!sameSet(change.regions, server.locations ?? [])) {
      set('regions', 'locations', change.regions);
    }
  }
  if (change.confirmDelay !== undefined) {
    if (NO_CONFIRM_DELAY.includes(server.protocol)) {
      notApplicable.push('confirm-delay');
    } else if (change.confirmDelay !== server.incident_confirm_delay) {
      set('confirm-delay', 'incident_confirm_delay', change.confirmDelay);
    }
  }
  for (const [flag, key, current] of [
    ['ssl', 'is_ssl_check', server.is_ssl_check],
    ['domain', 'is_domain_check', server.is_domain_check],
    ['blocklist', 'is_blocklist_check', server.is_blocklist_check],
  ] as const) {
    const wanted = change[flag];
    if (wanted === undefined) continue;
    if (!SSL_DOMAIN.includes(server.protocol)) notApplicable.push(flag);
    else if (wanted !== current) set(flag, key, wanted);
  }
  if (change.latency !== undefined) {
    if (!LATENCY.includes(server.protocol)) notApplicable.push('latency');
    else if (change.latency === false) {
      if (server.is_latency_alert_enabled) {
        set('latency', 'is_latency_alert_enabled', false);
      }
    } else if (
      !server.is_latency_alert_enabled ||
      server.latency_trigger_ms !== change.latency
    ) {
      body.is_latency_alert_enabled = true;
      set('latency', 'latency_trigger_ms', change.latency);
    }
  }
  return { body, fields, notApplicable };
}

const SCENARIO_TIMEOUTS = [15, 30, 45, 60, 120];
const MAX_INTERVAL: Partial<Record<Protocol, number>> = {
  heartbeat: 31_536_000,
  scenario: 86_400,
};

/**
 * Whether the server accepts the planned values, as the backend checks
 * them for its protocol. All targets are checked before the first PATCH:
 * a timeout valid for HTTP but not for a scenario would otherwise stop the
 * batch half-way.
 */
export function bulkTargetProblem(
  server: Server,
  plan: PlannedPatch,
): string | null {
  // The API's limits for the text fields (`CreateServerDto`).
  if ('name' in plan.body) {
    const name = plan.body.name as string;
    if (!name) return 'name: empty';
    if (textLength(name) > 150) return 'name ≤ 150';
  }
  if ('host' in plan.body) {
    const host = plan.body.host as string;
    if (!HOST_PATTERN.test(host) || textLength(host) > 300) return 'host';
    if (isForbiddenHost(host)) return 'host: internal address';
  }
  if (
    typeof plan.body.description === 'string' &&
    textLength(plan.body.description) > 500
  ) {
    return 'description ≤ 500';
  }
  const interval =
    (plan.body.check_interval as number | undefined) ?? server.check_interval;
  const timeout =
    (plan.body.request_timeout as number | undefined) ?? server.request_timeout;
  if ('check_interval' in plan.body) {
    const max = MAX_INTERVAL[server.protocol] ?? 3600;
    if (interval < 60 || interval > max) return `interval 60–${max}`;
  }
  if ('request_timeout' in plan.body) {
    if (server.protocol === 'scenario') {
      if (!SCENARIO_TIMEOUTS.includes(timeout)) {
        return `timeout ${SCENARIO_TIMEOUTS.join('/')}`;
      }
    } else if (timeout < 1 || timeout > 60) {
      return 'timeout 1–60';
    }
  }
  if (
    server.protocol === 'scenario' &&
    ('check_interval' in plan.body || 'request_timeout' in plan.body) &&
    interval < timeout
  ) {
    return 'interval ≥ timeout';
  }
  return null;
}
