import type { Server } from '../commands/servers.js';
import { CliError, ExitCode } from '../errors.js';
import { t } from '../i18n.js';
import type { DesiredConfig, DesiredScenario } from './config.js';

export type ScenarioServer = Pick<
  Server,
  | 'id'
  | 'name'
  | 'project_id'
  | 'protocol'
  | 'scenario_script'
  | 'scenario_env_keys'
  | 'check_interval'
  | 'request_timeout'
  | 'locations'
>;

export type PlanStep =
  | { kind: 'create'; scenario: DesiredScenario; body: Record<string, unknown> }
  | {
      kind: 'update';
      scenario: DesiredScenario;
      serverId: number;
      fields: string[];
      body: Record<string, unknown>;
    }
  | { kind: 'unchanged'; scenario: DesiredScenario; serverId: number };

export interface DeployPlan {
  projectId: number;
  steps: PlanStep[];
  /** Scenarios of the project the config does not mention. Never deleted. */
  unmanaged: Array<{ id: number; name: string | null }>;
}

/**
 * Pure: compares the config with the account's scenario servers. Every
 * conflict the API would reject mid-way is raised here, before any write.
 *
 * `servers` must hold ALL scenario servers of the account: the backend
 * rejects a script already used anywhere in the account, not only in the
 * project.
 */
export function buildDeployPlan(
  config: DesiredConfig,
  servers: ScenarioServer[],
): DeployPlan {
  const scenarios = servers.filter((s) => s.protocol === 'scenario');
  const inProject = scenarios.filter((s) => s.project_id === config.projectId);

  const matched = new Map<DesiredScenario, ScenarioServer | undefined>();
  const claimed = new Set<number>();
  for (const scenario of config.scenarios) {
    const server = matchServer(
      scenario,
      scenarios,
      inProject,
      config.projectId,
    );
    if (server) {
      // Two entries resolved to one server: an id pin plus a name match.
      if (claimed.has(server.id)) fail(t.deployDuplicateName(scenario.name));
      claimed.add(server.id);
    }
    matched.set(scenario, server);
  }

  // The backend checks the script only when it is set: on a create or a
  // real change. Duplicates saved earlier stay editable, as on the API.
  const writesScript = (scenario: DesiredScenario) =>
    matched.get(scenario)?.scenario_script !== scenario.script;
  const byScript = new Map<string, DesiredScenario>();
  for (const scenario of config.scenarios) {
    const other = byScript.get(scenario.script);
    if (other && (writesScript(other) || writesScript(scenario))) {
      fail(t.deployDuplicateScript(other.name, scenario.name));
    }
    byScript.set(scenario.script, scenario);
  }

  // Who holds each script, replayed in execution order (the config's): a
  // script freed by an earlier step may be taken by a later one, as on the
  // API. A swap between two servers still clashes on its first PATCH and is
  // left to two deploys.
  const holders = new Map<string, ScenarioServer[]>();
  for (const server of scenarios) {
    const list = holders.get(server.scenario_script ?? '') ?? [];
    list.push(server);
    holders.set(server.scenario_script ?? '', list);
  }
  for (const scenario of config.scenarios) {
    if (!writesScript(scenario)) continue;
    const own = matched.get(scenario);
    const holder = (holders.get(scenario.script) ?? []).find(
      (s) => s.id !== own?.id,
    );
    if (holder) {
      fail(t.deployScriptTaken(scenario.name, holder.id, holder.project_id));
    }
    if (own) {
      const old = own.scenario_script ?? '';
      holders.set(
        old,
        (holders.get(old) ?? []).filter((s) => s.id !== own.id),
      );
    }
    const taker =
      own ?? ({ id: -1, project_id: config.projectId } as ScenarioServer);
    holders.set(scenario.script, [
      ...(holders.get(scenario.script) ?? []),
      taker,
    ]);
  }

  const steps: PlanStep[] = config.scenarios.map((scenario) => {
    const server = matched.get(scenario);
    if (!server) {
      return {
        kind: 'create',
        scenario,
        body: {
          project_id: config.projectId,
          protocol: 'scenario',
          // The backend replaces it with a system host; any non-empty string.
          host: 'scenario',
          name: scenario.name,
          scenario_script: scenario.script,
          check_interval: scenario.interval,
          request_timeout: scenario.timeout,
          locations: [scenario.location],
          is_follow_redirects: true,
          is_ssl_check: false,
          is_domain_check: false,
          ...(scenario.env ? { scenario_env: scenario.env } : {}),
        },
      };
    }
    return diff(scenario, server);
  });

  const unmanaged = inProject
    .filter((s) => !claimed.has(s.id))
    .map((s) => ({ id: s.id, name: s.name }));
  return { projectId: config.projectId, steps, unmanaged };
}

function matchServer(
  scenario: DesiredScenario,
  scenarios: ScenarioServer[],
  inProject: ScenarioServer[],
  projectId: number,
): ScenarioServer | undefined {
  if (scenario.id !== undefined) {
    const pinned = scenarios.find((s) => s.id === scenario.id);
    if (!pinned) fail(t.deployIdNotFound(scenario.name, scenario.id));
    if (pinned.project_id !== projectId) {
      fail(t.deployIdOtherProject(scenario.name, pinned.id, pinned.project_id));
    }
    return pinned;
  }
  const byName = inProject.filter((s) => s.name === scenario.name);
  if (byName.length > 1) fail(t.deployDuplicateName(scenario.name));
  return byName[0];
}

function diff(scenario: DesiredScenario, server: ScenarioServer): PlanStep {
  const body: Record<string, unknown> = {};
  const fields: string[] = [];
  if (server.name !== scenario.name) {
    body.name = scenario.name;
    fields.push('name');
  }
  if (server.scenario_script !== scenario.script) {
    body.scenario_script = scenario.script;
    fields.push('script');
  }
  if (server.check_interval !== scenario.interval) {
    body.check_interval = scenario.interval;
    // Older backends cap a PATCHed interval at an hour unless `protocol` is
    // in the body; sending the unchanged protocol is harmless on newer ones.
    body.protocol = 'scenario';
    fields.push('interval');
  }
  if (server.request_timeout !== scenario.timeout) {
    body.request_timeout = scenario.timeout;
    fields.push('timeout');
  }
  if (
    server.locations.length !== 1 ||
    server.locations[0] !== scenario.location
  ) {
    body.locations = [scenario.location];
    fields.push('location');
  }
  if (scenario.env) {
    // Values never come back from the API, so a set env is always sent.
    // `scenario_env` is a merge patch: names absent from the config are
    // deleted explicitly with null.
    const patch: Record<string, string | null> = { ...scenario.env };
    for (const key of server.scenario_env_keys ?? []) {
      if (!(key in scenario.env)) patch[key] = null;
    }
    if (Object.keys(patch).length) {
      body.scenario_env = patch;
      fields.push('env');
    }
  }
  if (!fields.length) {
    return { kind: 'unchanged', scenario, serverId: server.id };
  }
  return { kind: 'update', scenario, serverId: server.id, fields, body };
}

function fail(message: string): never {
  throw new CliError(message, ExitCode.Usage);
}
