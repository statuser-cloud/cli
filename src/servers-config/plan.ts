import type { Server } from '../commands/servers.js';
import { CliError, ExitCode } from '../errors.js';
import type { components } from '../generated/openapi.js';
import { t } from '../i18n.js';
import { duplicateKey, sameValue } from './fields.js';
import type { DesiredServer } from './parse.js';

type PlanFeatures = components['schemas']['PlanFeaturesResponseDto'];

export type ServerStep =
  | {
      kind: 'create';
      entry: DesiredServer;
      body: Record<string, unknown>;
      warnings: string[];
    }
  | {
      kind: 'update';
      entry: DesiredServer;
      serverId: number;
      fields: string[];
      body: Record<string, unknown>;
    }
  | { kind: 'unchanged'; entry: DesiredServer; serverId: number };

export interface ServersPlan {
  steps: ServerStep[];
  /** Servers of the project the file does not mention. Never deleted. */
  unmanaged: Array<{ id: number; name: string | null }>;
}

const fail = (message: string): never => {
  throw new CliError(message, ExitCode.Usage);
};

/**
 * Pure: compares the `servers` section with the account. Everything the
 * API would reject mid-way — an ambiguous match, a protocol change, a
 * duplicate monitor, a plan limit, a create without its password — is
 * raised here, before any write.
 *
 * `account` must hold ALL servers of the account: duplicates and the
 * servers limit are account-wide.
 */
export function buildServersPlan(
  desired: DesiredServer[],
  projectId: number,
  account: Server[],
  features: PlanFeatures,
  plannedScenarioCreates = 0,
): ServersPlan {
  const inProject = account.filter(
    (s) => s.project_id === projectId && s.protocol !== 'scenario',
  );
  const byId = new Map(account.map((s) => [s.id, s]));
  const claimed = new Set<number>();
  const steps: ServerStep[] = [];

  checkNames(desired, inProject);
  for (const entry of desired) {
    const server = matchServer(entry, byId, inProject, projectId);
    if (server) {
      if (claimed.has(server.id))
        fail(t.applyClaimedTwice(entry.at, server.id));
      claimed.add(server.id);
      // Changing the protocol wipes what belongs to the old one: HTTP
      // credentials, the LLM key, the heartbeat token.
      if (server.protocol !== entry.protocol) {
        fail(t.applyProtocolChange(entry.at, server.id, server.protocol));
      }
      steps.push(diffServer(entry, server));
    } else {
      steps.push(createStep(entry, projectId));
    }
  }

  checkAuth(steps, byId);
  checkDuplicates(steps, account);
  checkPlan(steps, account, features, plannedScenarioCreates);

  const unmanaged = inProject
    .filter((s) => !claimed.has(s.id))
    .map((s) => ({ id: s.id, name: s.name }));
  return { steps, unmanaged };
}

function matchServer(
  entry: DesiredServer,
  byId: Map<number, Server>,
  inProject: Server[],
  projectId: number,
): Server | undefined {
  if (entry.id !== undefined) {
    const server = byId.get(entry.id);
    // A pinned id that is gone is an error, not a reason to create a copy.
    if (!server || server.protocol === 'scenario') {
      return fail(t.applyIdNotFound(entry.at, entry.id));
    }
    if (server.project_id !== projectId) {
      return fail(t.applyIdOtherProject(entry.at, entry.id, server.project_id));
    }
    return server;
  }
  const byName = inProject.filter((s) => s.name === entry.name);
  if (byName.length > 1) fail(t.applyAmbiguousName(entry.at, entry.name ?? ''));
  return byName[0];
}

/**
 * Entries without an id are found by name on every run, so names must stay
 * unique in the project after apply — otherwise the next run of the same
 * file would stop on an ambiguous match.
 */
function checkNames(desired: DesiredServer[], inProject: Server[]): void {
  const pinned = new Set(
    desired.map((e) => e.id).filter((id) => id !== undefined),
  );
  const fileNames = new Map<string, string>();
  for (const entry of desired) {
    if (entry.name === null) continue;
    const other = fileNames.get(entry.name);
    if (other) fail(t.applyDuplicateName(entry.at, other, entry.name));
    fileNames.set(entry.name, entry.at);
  }
  for (const server of inProject) {
    if (server.name === null || pinned.has(server.id)) continue;
    const at = fileNames.get(server.name);
    const entry = desired.find((e) => e.at === at);
    // A pinned entry taking the name of another server of the project.
    if (entry && entry.id !== undefined) {
      fail(t.applyNameTaken(entry.at, server.name, server.id));
    }
  }
}

function diffServer(entry: DesiredServer, server: Server): ServerStep {
  const current = server as unknown as Record<string, unknown>;
  const body: Record<string, unknown> = {};
  const fields: string[] = [];
  if (entry.name !== null && entry.name !== server.name) {
    body.name = entry.name;
    fields.push('name');
  }
  for (const [field, value] of Object.entries(entry.fields)) {
    if (!sameValue(field, value, current[field])) {
      // `body: null` would be stored as the string "null"; clear with "".
      body[field] = field === 'body' && value === null ? '' : value;
      fields.push(field);
    }
  }
  // Values never come back from the API, so a set secret is always sent.
  for (const [field, value] of Object.entries(entry.secrets)) {
    body[field] = value;
    fields.push(field);
  }
  if (!fields.length) {
    return { kind: 'unchanged', entry, serverId: server.id };
  }
  return { kind: 'update', entry, serverId: server.id, fields, body };
}

function createStep(entry: DesiredServer, projectId: number): ServerStep {
  const f = entry.fields;
  const warnings: string[] = [];
  if (entry.protocol !== 'heartbeat' && !f.host) {
    fail(t.applyFieldRequired(entry.at, 'host'));
  }
  if (entry.protocol === 'tcp' && f.port === undefined) {
    fail(t.applyFieldRequired(entry.at, 'port'));
  }
  if (entry.protocol === 'keyword' && !f.keyword) {
    fail(t.applyFieldRequired(entry.at, 'keyword'));
  }
  if (entry.protocol === 'dns' && !f.dns_record_types) {
    fail(t.applyFieldRequired(entry.at, 'dns_record_types'));
  }
  if (entry.protocol === 'llm' && !f.llm_provider) {
    fail(t.applyFieldRequired(entry.at, 'llm_provider'));
  }
  // An empty Basic password is legal; only its absence is not.
  if (
    f.http_auth_type === 'basic' &&
    entry.secrets.http_auth_password === undefined
  ) {
    fail(t.applyFieldRequired(entry.at, 'http_auth_password'));
  }
  if (f.http_auth_type === 'bearer' && !entry.secrets.http_auth_token) {
    fail(t.applyFieldRequired(entry.at, 'http_auth_token'));
  }
  if (entry.protocol === 'llm' && entry.secrets.llm_api_key && !f.llm_model) {
    fail(t.applyFieldRequired(entry.at, 'llm_model'));
  }
  if (entry.protocol === 'llm' && !entry.secrets.llm_api_key) {
    warnings.push(t.applyLlmAvailability(entry.name ?? entry.at));
  }
  const isHttp = entry.protocol === 'http' || entry.protocol === 'keyword';
  return {
    kind: 'create',
    entry,
    warnings,
    body: {
      // Fields the API requires for every protocol, with the panel defaults.
      is_follow_redirects: isHttp,
      request_timeout: 30,
      check_interval: 300,
      is_ssl_check: false,
      is_domain_check: false,
      // HEAD has no body, so a keyword check needs GET to see the page.
      ...(isHttp && {
        http_method: entry.protocol === 'keyword' ? 'get' : 'head',
      }),
      ...(entry.protocol === 'keyword' && { keyword_mode: 'present' }),
      ...f,
      ...entry.secrets,
      ...(entry.protocol === 'heartbeat' && { host: 'heartbeat' }),
      ...(f.body === null && { body: '' }),
      project_id: projectId,
      protocol: entry.protocol,
      ...(entry.name !== null && { name: entry.name }),
    },
  };
}

/**
 * HTTP credentials as they end up after the write: Basic needs a username,
 * switching the type needs the new secret, and a set `Authorization`
 * header would clash with them (`server_http_auth_header_conflict`).
 */
function checkAuth(steps: ServerStep[], byId: Map<number, Server>): void {
  for (const step of steps) {
    if (step.kind === 'unchanged') continue;
    const current =
      step.kind === 'update' ? byId.get(step.serverId) : undefined;
    const body = step.body;
    const type = (body.http_auth_type ??
      current?.http_auth_type ??
      'none') as string;
    // A secret of the other type would be accepted and ignored.
    if (body.http_auth_password !== undefined && type !== 'basic') {
      fail(
        t.applyAuthSecretMismatch(step.entry.at, 'http_auth_password', type),
      );
    }
    if (body.http_auth_token !== undefined && type !== 'bearer') {
      fail(t.applyAuthSecretMismatch(step.entry.at, 'http_auth_token', type));
    }
    if (type === 'none') continue;
    const username = body.http_auth_username ?? current?.http_auth_username;
    if (type === 'basic' && !username) {
      fail(t.applyFieldRequired(step.entry.at, 'http_auth_username'));
    }
    const typeChanged = !current || current.http_auth_type !== type;
    const secret = type === 'basic' ? 'http_auth_password' : 'http_auth_token';
    if (typeChanged && body[secret] === undefined) {
      fail(t.applyFieldRequired(step.entry.at, secret));
    }
    const headers = (body.headers ?? current?.headers ?? []) as Array<{
      key: string;
    }>;
    if (headers.some((h) => h.key.trim().toLowerCase() === 'authorization')) {
      fail(t.applyAuthHeaderConflict(step.entry.at));
    }
  }
}

/**
 * The backend rejects a monitor equal to another one anywhere in the
 * account, and it checks every request against the state at that moment.
 * So the plan is replayed in execution order (updates, then creates): a
 * swap of addresses between two servers collides on its first PATCH and
 * is refused here, before any write.
 */
function checkDuplicates(steps: ServerStep[], account: Server[]): void {
  const states = new Map<
    string,
    { state: Record<string, unknown>; label: string }
  >();
  for (const server of account) {
    if (server.protocol === 'scenario') continue;
    states.set(`#${server.id}`, {
      state: server as unknown as Record<string, unknown>,
      label: server.name ?? server.host,
    });
  }
  const ordered = [
    ...steps.filter((s) => s.kind === 'update'),
    ...steps.filter((s) => s.kind === 'create'),
  ];
  for (const step of ordered) {
    const slot = step.kind === 'create' ? step.entry.at : `#${step.serverId}`;
    const previous = states.get(slot);
    const state = { ...previous?.state, ...step.body };
    const label = step.entry.name ?? previous?.label ?? step.entry.at;
    const key = duplicateKey(state);
    // The backend checks only a create or a write that changes the identity:
    // a duplicate made before the check existed can still be edited.
    if (previous && duplicateKey(previous.state) === key) {
      states.set(slot, { state, label });
      continue;
    }
    for (const [other, item] of states) {
      if (other !== slot && duplicateKey(item.state) === key) {
        fail(t.applyDuplicate(label, item.label));
      }
    }
    states.set(slot, { state, label });
  }
}

// Fields whose presence in a PATCH makes the backend re-check the plan
// (`ServerWriteService.update` → `validateServerFeatures`).
const FEATURE_TRIGGERS = [
  'check_interval',
  'locations',
  'is_ssl_check',
  'is_domain_check',
  'is_blocklist_check',
  'is_latency_alert_enabled',
  'latency_trigger_ms',
  'incident_confirm_delay',
  'llm_api_key',
  'success_http_codes',
];

interface Requirements {
  features: Array<keyof PlanFeatures>;
  interval?: number;
  locations?: string[];
}

/**
 * What a write needs from the plan, as the backend checks it: on create
 * the new server, on update the server as it will be after the PATCH —
 * so a server kept from a richer plan fails as soon as it is touched.
 */
function requirements(step: ServerStep, current?: Server): Requirements {
  if (step.kind === 'unchanged') return { features: [] };
  const body = step.body;
  if (
    step.kind === 'update' &&
    !FEATURE_TRIGGERS.some((field) => field in body)
  ) {
    return { features: [] };
  }
  const merged = {
    ...(current as unknown as Record<string, unknown>),
    ...body,
  };
  const needs: Array<keyof PlanFeatures> = [];
  const byProtocol: Partial<Record<string, keyof PlanFeatures>> = {
    keyword: 'keyword_monitoring_enabled',
    dns: 'dns_monitoring_enabled',
    heartbeat: 'heartbeat_monitoring_enabled',
    llm: 'ai_monitoring_enabled',
  };
  const protocolFeature = byProtocol[merged.protocol as string];
  if (protocolFeature) needs.push(protocolFeature);
  const inference =
    body.llm_api_key !== undefined
      ? Boolean(body.llm_api_key)
      : current?.llm_check_mode === 'inference';
  if (merged.protocol === 'llm' && inference)
    needs.push('ai_inference_enabled');
  if (merged.is_ssl_check === true) needs.push('ssl_monitoring_enabled');
  if (merged.is_domain_check === true) needs.push('domain_monitoring_enabled');
  // The backend reads only the sent value here: old rows have it on.
  if (body.is_blocklist_check === true) {
    needs.push('blocklist_monitoring_enabled');
  }
  if (merged.is_latency_alert_enabled === true) {
    needs.push('latency_alerts_enabled');
  }
  if (
    typeof body.incident_confirm_delay === 'number' &&
    body.incident_confirm_delay > 0
  ) {
    needs.push('incident_debounce_enabled');
  }
  const codes = body.success_http_codes;
  if (Array.isArray(codes) && !(codes.length === 1 && codes[0] === '2xx')) {
    needs.push('custom_success_http_codes_enabled');
  }
  return {
    features: needs,
    interval: merged.check_interval as number | undefined,
    locations: merged.locations as string[] | undefined,
  };
}

function checkPlan(
  steps: ServerStep[],
  account: Server[],
  features: PlanFeatures,
  plannedScenarioCreates: number,
): void {
  const byId = new Map(account.map((s) => [s.id, s]));
  const creates = steps.filter((s) => s.kind === 'create').length;
  // An account already over the limit after a downgrade may still edit
  // its servers; only new ones are refused.
  if (
    creates + plannedScenarioCreates > 0 &&
    account.length + creates + plannedScenarioCreates > features.servers_limit
  ) {
    fail(
      t.applyServersLimit(
        features.servers_limit,
        account.length,
        creates + plannedScenarioCreates,
      ),
    );
  }
  for (const step of steps) {
    if (step.kind === 'unchanged') continue;
    const current =
      step.kind === 'update' ? byId.get(step.serverId) : undefined;
    const needed = requirements(step, current);
    for (const feature of needed.features) {
      if (!features[feature]) {
        fail(t.applyFeatureUnavailable(step.entry.at, feature));
      }
    }
    if (
      needed.interval !== undefined &&
      needed.interval < features.min_check_interval_seconds
    ) {
      fail(
        t.applyIntervalTooLow(
          step.entry.at,
          features.min_check_interval_seconds,
        ),
      );
    }
    const unavailable = (needed.locations ?? []).filter(
      (l) => !features.available_locations.includes(l),
    );
    if (unavailable.length) {
      fail(t.applyLocationsUnavailable(step.entry.at, unavailable.join(', ')));
    }
  }
}

/**
 * The scenario side of the plan limits: the number of scenarios, their
 * minimal interval and maximal timeout. Checked together with the servers
 * so a full apply never stops on the scenarios after servers were written.
 */
export function checkScenarioLimits(
  steps: Array<{
    kind: string;
    scenario: { name: string; interval: number; timeout: number };
  }>,
  existingScenarios: number,
  features: PlanFeatures,
): void {
  const creates = steps.filter((s) => s.kind === 'create').length;
  if (creates && existingScenarios + creates > features.scenarios_limit) {
    fail(
      t.applyScenariosLimit(
        features.scenarios_limit,
        existingScenarios,
        creates,
      ),
    );
  }
  for (const step of steps) {
    if (step.kind === 'unchanged') continue;
    const { name, interval, timeout } = step.scenario;
    if (interval < features.scenario_min_check_interval_seconds) {
      fail(
        t.applyIntervalTooLow(
          name,
          features.scenario_min_check_interval_seconds,
        ),
      );
    }
    if (timeout > features.scenario_max_timeout_seconds) {
      fail(
        t.applyScenarioTimeoutTooHigh(
          name,
          features.scenario_max_timeout_seconds,
        ),
      );
    }
  }
}
