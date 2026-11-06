import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { authedClient, globalOptions } from '../context.js';
import { CliError, ExitCode, StatuserApiError } from '../errors.js';
import type { components } from '../generated/openapi.js';
import { t } from '../i18n.js';
import { printErr, printJson, printLine } from '../output.js';
import {
  loadScenarioConfig,
  resolveEnvValue,
  scenarioEnvProblem,
  SCENARIO_DEFAULT_LOCATION,
  SCENARIO_DEFAULT_TIMEOUT,
  SCENARIO_LOCATIONS,
  SCENARIO_TIMEOUTS,
} from '../scenarios/config.js';
import { buildDeployPlan, type PlanStep } from '../scenarios/plan.js';
import { checkScenarioLimits } from '../servers-config/plan.js';
import { listServers } from './servers.js';

type ScenarioPreviewBody = components['schemas']['ScenarioPreviewDto'];
type CurrentPlan = components['schemas']['CurrentPlanResponseDto'];
type ScenarioRunResponse = components['schemas']['ScenarioRunResponseDto'];
type ScenarioRunStatus = ScenarioRunResponse['status'];

// The sandbox may wait up to 30 s for a free slot on top of the run itself,
// then uploads artifacts.
const PREVIEW_OVERHEAD_MS = 90_000;

interface TestOptions {
  timeout: string;
  location: string;
  env: string[];
}

const collect = (value: string, previous: string[]) => [...previous, value];

export function registerScenariosCommands(program: Command): void {
  const scenarios = program.command('scenarios').description(t.cmdScenarios);

  scenarios
    .command('test')
    .description(t.cmdScenariosTest)
    .argument('<file>')
    .option(
      '--timeout <seconds>',
      t.optTimeout,
      String(SCENARIO_DEFAULT_TIMEOUT),
    )
    .option('--location <code>', t.optLocation, SCENARIO_DEFAULT_LOCATION)
    .option('--env <KEY=VALUE>', t.optEnv, collect, [])
    .action(async (file: string, opts: TestOptions, command: Command) => {
      const timeout = Number(opts.timeout);
      if (!SCENARIO_TIMEOUTS.includes(timeout as never)) {
        throw new CliError(t.optTimeout, ExitCode.Usage);
      }
      if (!SCENARIO_LOCATIONS.includes(opts.location as never)) {
        throw new CliError(t.optLocation, ExitCode.Usage);
      }
      const env: Record<string, string> = {};
      for (const raw of opts.env) {
        const index = raw.indexOf('=');
        if (index <= 0)
          throw new CliError(t.apiFieldInvalid(raw), ExitCode.Usage);
        env[raw.slice(0, index)] = resolveEnvValue(
          raw.slice(index + 1),
          file,
          process.env,
        );
      }
      const envProblem = scenarioEnvProblem(env);
      if (envProblem) throw new CliError(envProblem, ExitCode.Usage);
      let script: string;
      try {
        script = await readFile(file, 'utf8');
      } catch {
        throw new CliError(t.configNotFound(file), ExitCode.Usage);
      }

      const json = globalOptions(command).json;
      if (!json) printErr(t.scenarioRunning);
      const { client } = await authedClient(command);
      // Not retried on a dropped connection: the run may have happened, and
      // the account allows one on-demand run at a time.
      const result = await client.call<ScenarioRunResponse>({
        method: 'POST',
        path: '/v1/scenario-runs/preview',
        body: {
          scenario_script: script,
          // Both checked against the spec enums above.
          request_timeout: timeout as ScenarioPreviewBody['request_timeout'],
          locations: [
            opts.location as NonNullable<
              ScenarioPreviewBody['locations']
            >[number],
          ],
          ...(Object.keys(env).length ? { scenario_env: env } : {}),
        } satisfies ScenarioPreviewBody,
        timeoutMs: timeout * 1000 + PREVIEW_OVERHEAD_MS,
      });

      // The test may print or compare its passwords; the run result comes
      // back verbatim, so the values passed here are masked before output.
      const masked = maskSecrets(result, Object.values(env));
      if (json) printJson(masked);
      else printRunResult(masked);
      process.exitCode = runExitCode(result.status);
    });

  scenarios
    .command('deploy')
    .description(t.cmdScenariosDeploy)
    .option('-c, --config <path>', t.optConfig, 'statuser.json')
    .option('--dry-run', t.optDryRun)
    .action(
      async (opts: { config: string; dryRun?: boolean }, command: Command) => {
        const config = await loadScenarioConfig(opts.config);
        const { client } = await authedClient(command);
        // The whole account: duplicate scripts are checked account-wide.
        const [servers, current] = await Promise.all([
          listServers(client),
          client.call<CurrentPlan>({
            method: 'GET',
            path: '/v1/billing/current-plan',
          }),
        ]);
        const plan = buildDeployPlan(config, servers);
        // Plan limits before the first write, as `apply` does.
        const creates = plan.steps.filter((s) => s.kind === 'create').length;
        checkScenarioLimits(
          plan.steps,
          servers.filter((s) => s.protocol === 'scenario').length,
          current.features,
        );
        if (
          creates &&
          servers.length + creates > current.features.servers_limit
        ) {
          throw new CliError(
            t.applyServersLimit(
              current.features.servers_limit,
              servers.length,
              creates,
            ),
            ExitCode.Usage,
          );
        }
        const json = globalOptions(command).json;

        const pending = plan.steps.filter((s) => s.kind !== 'unchanged');
        if (!json) {
          printLine(t.deployPlanTitle(plan.projectId));
          for (const step of plan.steps) printLine(describeStep(step));
          for (const item of plan.unmanaged) {
            printLine(t.deployUnmanaged(item.name ?? '', item.id));
          }
          if (
            pending.some((s) => s.kind === 'update' && s.fields.includes('env'))
          ) {
            printErr(t.deployEnvAlwaysSent);
          }
        }

        const applied: Array<{ name: string; action: string; id: number }> = [];
        const summary = () => ({
          project_id: plan.projectId,
          dry_run: !!opts.dryRun,
          // Bodies are left out: they carry scenario env values.
          steps: plan.steps.map((step) => ({
            name: step.scenario.name,
            action: step.kind,
            id: step.kind === 'create' ? null : step.serverId,
            fields: step.kind === 'update' ? step.fields : undefined,
          })),
          unmanaged: plan.unmanaged,
          applied,
        });

        if (opts.dryRun || !pending.length) {
          if (json) printJson(summary());
          else printLine(opts.dryRun ? t.deployDryRunDone : t.deployNothing);
          return;
        }

        for (const step of pending) {
          try {
            if (step.kind === 'create') {
              const created = await client.call<{ id: number }>({
                method: 'POST',
                path: '/v1/servers',
                body: step.body,
              });
              applied.push({
                name: step.scenario.name,
                action: 'create',
                id: created.id,
              });
            } else if (step.kind === 'update') {
              await client.call({
                method: 'PATCH',
                path: `/v1/servers/${step.serverId}`,
                body: step.body,
              });
              applied.push({
                name: step.scenario.name,
                action: 'update',
                id: step.serverId,
              });
            }
            if (!json) printLine(t.deployApplied(step.scenario.name));
          } catch (error) {
            const message =
              error instanceof StatuserApiError
                ? error.format()
                : String(error);
            if (json) printJson({ ...summary(), error: message });
            throw new CliError(
              t.deployStopped(step.scenario.name, message),
              error instanceof StatuserApiError
                ? error.exitCode
                : ExitCode.Failure,
            );
          }
        }
        if (json) printJson(summary());
      },
    );
}

export function describeStep(step: PlanStep): string {
  switch (step.kind) {
    case 'create':
      return t.deployCreate(step.scenario.name);
    case 'update':
      return t.deployUpdate(
        step.scenario.name,
        step.serverId,
        step.fields.join(', '),
      );
    case 'unchanged':
      return t.deployUnchanged(step.scenario.name, step.serverId);
  }
}

function printRunResult(result: ScenarioRunResponse): void {
  if (result.status === 'passed') {
    printLine(t.scenarioPassed(((result.duration_ms ?? 0) / 1000).toFixed(1)));
  } else if (result.status === 'runner_error') {
    printLine(t.scenarioRunnerError);
  } else {
    printLine(t.scenarioFailed(result.status));
    if (result.failed_test) printLine(t.scenarioFailedTest(result.failed_test));
    if (result.error) printLine(t.scenarioError(result.error));
  }
  for (const [kind, url] of Object.entries(result.artifact_urls ?? {})) {
    if (url) printLine(t.scenarioArtifact(kind, url));
  }
}

/** passed → 0, a site-side failure → 4, our sandbox failing → 1. */
function runExitCode(status: ScenarioRunStatus): number {
  if (status === 'passed') return ExitCode.Ok;
  if (status === 'runner_error') return ExitCode.Failure;
  return ExitCode.ScenarioFailed;
}

// Values shorter than this would mask ordinary words of the output.
const MIN_MASKED_LENGTH = 4;

export function maskSecrets<T>(value: T, secrets: string[]): T {
  const masked = secrets.filter((s) => s.length >= MIN_MASKED_LENGTH);
  if (!masked.length) return value;
  const replace = (text: string) =>
    masked.reduce((acc, secret) => acc.split(secret).join('***'), text);
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return replace(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node).map(([key, item]) => [key, walk(item)]),
      );
    }
    return node;
  };
  return walk(value) as T;
}
