import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { authedClient, globalOptions } from '../context.js';
import { CliError, ExitCode } from '../errors.js';
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
import { describeWriteFailure } from '../write-failure.js';
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
      const env = Object.create(null) as Record<string, string>;
      for (const [position, raw] of opts.env.entries()) {
        const index = raw.indexOf('=');
        // The argument may be a bare value: it is never quoted back.
        // A bad name may be part of a secret passed by mistake
        // (`--env 'YWJj=='`): the problem is named by position only.
        if (
          index <= 0 ||
          scenarioEnvProblem({ [raw.slice(0, index)]: '' }) !== null
        ) {
          throw new CliError(
            t.argInvalid('--env', position + 1),
            ExitCode.Usage,
          );
        }
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
            const failure = describeWriteFailure(step.scenario.name, error);
            if (json) printJson({ ...summary(), error: failure });
            throw new CliError(failure.message, failure.exitCode);
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

/**
 * Masks the given secret values in the diagnostic fields of a run result:
 * the error, the failed test title and the console. Structural fields
 * (status, location, links) are left intact — they are the contract.
 */
export function maskSecrets(
  result: ScenarioRunResponse,
  secrets: string[],
): ScenarioRunResponse {
  const values = secretForms(secrets);
  if (!values.length) return result;
  const mask = <T extends string | null | undefined>(text: T): T =>
    typeof text === 'string' ? (maskText(text, values) as T) : text;
  return {
    ...result,
    error: mask(result.error),
    failed_test: mask(result.failed_test),
    console:
      result.console?.map((entry) => ({
        ...entry,
        text: mask(entry.text) ?? '',
      })) ?? null,
  };
}

/**
 * Every form a value may take in the run's output: as given, escaped by
 * `JSON.stringify` in the script, and without trailing whitespace, which
 * the runner trims from console lines.
 */
function secretForms(secrets: string[]): string[] {
  const forms = new Set<string>();
  for (const secret of secrets) {
    // util.inspect (`console.log({ password })`) breaks a long multiline
    // string into one literal per line, joined with `+` and indented by
    // nesting: each line of the value is masked on its own too. Lines
    // shorter than four characters are left, so as not to mask everywhere.
    const lines = secret.includes('\n')
      ? secret.split('\n').filter((line) => line.length >= 4)
      : [];
    for (const part of [secret, ...lines]) {
      addForms(forms, part);
    }
  }
  return [...forms];
}

function addForms(forms: Set<string>, secret: string): void {
  // util.inspect has its own escaping and quote choice.
  for (const form of [
    secret,
    JSON.stringify(secret).slice(1, -1),
    inspect(secret).slice(1, -1),
  ]) {
    for (const variant of [form, form.trimEnd()]) {
      if (variant) forms.add(variant);
    }
  }
}

/**
 * Finds every place a value occupies in the original text first and only
 * then replaces them: masking one value before searching for the next
 * would break an overlapping one. The backend cuts long lines and appends
 * `…`, so the start of a value at the cut is masked too.
 */
function maskText(text: string, values: string[]): string {
  const cut = text.endsWith('…');
  const body = cut ? text.slice(0, -1) : text;
  const ranges: Array<[number, number]> = [];
  for (const value of values) {
    for (
      let at = body.indexOf(value);
      at >= 0;
      at = body.indexOf(value, at + 1)
    ) {
      ranges.push([at, at + value.length]);
    }
    // The runner keeps only the last part of a long error, without a mark:
    // a value cut at the start shows as its tail. Four characters at least,
    // so a common last letter does not mask the start of every line.
    for (
      let length = Math.min(value.length - 1, body.length);
      length >= 4;
      length -= 1
    ) {
      if (body.startsWith(value.slice(-length))) {
        ranges.push([0, length]);
        break;
      }
    }
    if (cut) {
      for (
        let length = Math.min(value.length - 1, body.length);
        length > 0;
        length -= 1
      ) {
        if (body.endsWith(value.slice(0, length))) {
          ranges.push([body.length - length, body.length]);
          break;
        }
      }
    }
  }
  if (!ranges.length) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  let out = '';
  let pos = 0;
  for (const [start, end] of merged) {
    out += `${body.slice(pos, start)}***`;
    pos = end;
  }
  return `${out}${body.slice(pos)}${cut ? '…' : ''}`;
}
