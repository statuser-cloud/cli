import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import type { StatuserClient } from '../client.js';
import { authedClient, globalOptions } from '../context.js';
import {
  CliError,
  ExitCode,
  NotSentError,
  StatuserApiError,
  type ExitCodeValue,
} from '../errors.js';
import { writeOwnFile } from '../files.js';
import type { components } from '../generated/openapi.js';
import { t } from '../i18n.js';
import { jsonErrorPosition } from '../json-error.js';
import { printErr, printJson, printLine } from '../output.js';
import { loadScenarioConfig } from '../scenarios/config.js';
import { buildDeployPlan, type DeployPlan } from '../scenarios/plan.js';
import { exportServers } from '../servers-config/export.js';
import { parseServersSection } from '../servers-config/parse.js';
import {
  buildServersPlan,
  checkScenarioLimits,
  type ServersPlan,
} from '../servers-config/plan.js';
import { describeStep } from './scenarios.js';
import { listServers, parseId } from './servers.js';

type CurrentPlan = components['schemas']['CurrentPlanResponseDto'];

const DEFAULT_CONFIG = 'statuser.json';

/**
 * Configuration as a file: `export` writes the project's servers to
 * statuser.json, `diff` shows what `apply` would change, `apply` brings the
 * project in line. Nothing is ever deleted; servers the file does not
 * mention are only listed.
 */
export function registerConfigCommands(program: Command): void {
  program
    .command('export')
    .description(t.cmdExport)
    .requiredOption('--project <id>', t.optProject, parseId)
    .option('-o, --output <file>', t.optExportOutput)
    .option('--force', t.optForce)
    .action(
      async (
        opts: { project: number; output?: string; force?: boolean },
        command: Command,
      ) => {
        const { client } = await authedClient(command);
        const result = exportServers(await listServers(client, opts.project));
        let document: Record<string, unknown> = {
          project_id: opts.project,
          servers: result.entries,
        };
        if (opts.output && opts.force) {
          // Re-exporting into an existing file keeps its scenarios section:
          // those entries point at local test files the export cannot know.
          // Only a missing file is "nothing to keep"; a broken or unreadable
          // one stops the export before it overwrites the scenarios inside.
          const existing = await readJson(opts.output).catch(
            (error: unknown) => {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
              }
              throw error instanceof CliError
                ? error
                : new CliError(
                    t.configInvalid(opts.output!, String(error)),
                    ExitCode.Usage,
                  );
            },
          );
          // Scenarios of another project must not move into this one.
          if (
            existing &&
            existing.scenarios !== undefined &&
            existing.project_id !== opts.project
          ) {
            throw new CliError(
              t.exportOtherProject(opts.output, Number(existing.project_id)),
              ExitCode.Usage,
            );
          }
          if (existing) document = { ...existing, ...document };
        }
        const text = `${JSON.stringify(document, null, 2)}\n`;
        if (opts.output) {
          await writeOwnFile(opts.output, text, !!opts.force);
          if (globalOptions(command).json) {
            printJson({ file: opts.output, servers: result.entries.length });
          } else {
            printErr(t.fileSaved(opts.output));
          }
        } else {
          process.stdout.write(text);
        }
        if (result.headerVariables.length) {
          printErr(t.exportHeaderVariables(result.headerVariables.join(', ')));
        }
        if (result.withSecrets.length) {
          printErr(
            t.exportSecretsOmitted(
              result.withSecrets.map((s) => s.name ?? `#${s.id}`).join(', '),
            ),
          );
        }
        if (result.pausedCount) printErr(t.exportPaused(result.pausedCount));
        if (result.scenarioCount) {
          printErr(t.exportScenarios(result.scenarioCount));
        }
        printErr(t.exportReview);
      },
    );

  program
    .command('diff')
    .description(t.cmdDiff)
    .option('-c, --config <path>', t.optConfig, DEFAULT_CONFIG)
    .action(async (opts: { config: string }, command: Command) => {
      const { client } = await authedClient(command);
      const plan = await buildFullPlan(client, opts.config);
      if (globalOptions(command).json) printJson(summarize(plan, true, []));
      else {
        printPlan(plan);
        printLine(t.deployDryRunDone);
      }
    });

  program
    .command('apply')
    .description(t.cmdApply)
    .option('-c, --config <path>', t.optConfig, DEFAULT_CONFIG)
    .action(async (opts: { config: string }, command: Command) => {
      const { client } = await authedClient(command);
      const plan = await buildFullPlan(client, opts.config);
      const json = globalOptions(command).json;
      if (!json) printPlan(plan);
      const { applied, failure } = await execute(client, plan, !!json);
      // With --json the run always ends with one JSON document, including
      // what was applied before a failure.
      if (json) {
        printJson({
          ...summarize(plan, false, applied),
          error: failure ?? null,
        });
      } else if (!applied.length && !failure) {
        printLine(t.deployNothing);
      }
      if (failure) throw new CliError(failure.message, failure.exitCode);
    });
}

interface FullPlan {
  projectId: number;
  servers: ServersPlan;
  scenarios: DeployPlan | null;
}

async function buildFullPlan(
  client: StatuserClient,
  path: string,
): Promise<FullPlan> {
  const raw = await readJson(path).catch((error: unknown) => {
    if (error instanceof CliError) throw error;
    throw new CliError(t.configNotFound(path), ExitCode.Usage);
  });
  const fail = (problem: string): never => {
    throw new CliError(t.configInvalid(path, problem), ExitCode.Usage);
  };
  if (raw.servers === undefined && raw.scenarios === undefined) {
    fail(t.applyNothingToManage);
  }
  // All validation and both plans come before the first write.
  const scenarioConfig = await loadScenarioConfig(path, process.env, {
    required: false,
  });
  const desired =
    raw.servers === undefined
      ? []
      : parseServersSection(raw.servers, process.env, fail);

  const [account, current] = await Promise.all([
    listServers(client),
    client.call<CurrentPlan>({
      method: 'GET',
      path: '/v1/billing/current-plan',
    }),
  ]);
  const scenarios = scenarioConfig.scenarios.length
    ? buildDeployPlan(scenarioConfig, account)
    : null;
  const scenarioCreates =
    scenarios?.steps.filter((s) => s.kind === 'create').length ?? 0;
  if (scenarios) {
    checkScenarioLimits(
      scenarios.steps,
      account.filter((s) => s.protocol === 'scenario').length,
      current.features,
    );
  }
  const servers = buildServersPlan(
    desired,
    scenarioConfig.projectId,
    account,
    current.features,
    scenarioCreates,
  );
  return { projectId: scenarioConfig.projectId, servers, scenarios };
}

function printPlan(plan: FullPlan): void {
  printLine(t.deployPlanTitle(plan.projectId));
  for (const step of plan.servers.steps) {
    const name = step.entry.name ?? step.entry.at;
    if (step.kind === 'create') {
      printLine(t.deployCreate(name));
      for (const warning of step.warnings) printErr(warning);
    } else if (step.kind === 'update') {
      printLine(t.deployUpdate(name, step.serverId, step.fields.join(', ')));
    } else {
      printLine(t.deployUnchanged(name, step.serverId));
    }
  }
  for (const item of plan.servers.unmanaged) {
    printLine(t.deployUnmanaged(item.name ?? '', item.id));
  }
  for (const step of plan.scenarios?.steps ?? []) {
    printLine(describeStep(step));
  }
  for (const item of plan.scenarios?.unmanaged ?? []) {
    printLine(t.deployUnmanaged(item.name ?? '', item.id));
  }
}

type Applied = { name: string; action: string; id: number };

/**
 * Updates first, then creates, then scenarios. The first failure stops the
 * run; what was applied before it stays, and a repeated run continues from
 * there. A dropped connection leaves the outcome of that step unknown.
 */
interface Failure {
  name: string;
  message: string;
  exitCode: ExitCodeValue;
  outcome_unknown: boolean;
}

async function execute(
  client: StatuserClient,
  plan: FullPlan,
  quiet: boolean,
): Promise<{ applied: Applied[]; failure?: Failure }> {
  const applied: Applied[] = [];
  const serverSteps = [
    ...plan.servers.steps.filter((s) => s.kind === 'update'),
    ...plan.servers.steps.filter((s) => s.kind === 'create'),
  ];
  const writes: Array<{ name: string; run: () => Promise<Applied> }> = [];
  for (const step of serverSteps) {
    const name = step.entry.name ?? step.entry.at;
    if (step.kind === 'update') {
      writes.push({
        name,
        run: async () => {
          await client.call({
            method: 'PATCH',
            path: `/v1/servers/${step.serverId}`,
            body: step.body,
          });
          return { name, action: 'update', id: step.serverId };
        },
      });
    } else if (step.kind === 'create') {
      writes.push({
        name,
        run: async () => {
          const created = await client.call<{ id: number }>({
            method: 'POST',
            path: '/v1/servers',
            body: step.body,
          });
          return { name, action: 'create', id: created.id };
        },
      });
    }
  }
  for (const step of plan.scenarios?.steps ?? []) {
    const name = step.scenario.name;
    if (step.kind === 'update') {
      writes.push({
        name,
        run: async () => {
          await client.call({
            method: 'PATCH',
            path: `/v1/servers/${step.serverId}`,
            body: step.body,
          });
          return { name, action: 'update', id: step.serverId };
        },
      });
    } else if (step.kind === 'create') {
      writes.push({
        name,
        run: async () => {
          const created = await client.call<{ id: number }>({
            method: 'POST',
            path: '/v1/servers',
            body: step.body,
          });
          return { name, action: 'create', id: created.id };
        },
      });
    }
  }

  for (const write of writes) {
    try {
      applied.push(await write.run());
      if (!quiet) printLine(t.deployApplied(write.name));
    } catch (error) {
      if (error instanceof NotSentError) {
        return {
          applied,
          failure: {
            name: write.name,
            message: t.deployStopped(write.name, error.message),
            exitCode: ExitCode.Failure,
            outcome_unknown: false,
          },
        };
      }
      // A 4xx is a refusal; after a 5xx the write may have been stored
      // before the answer failed, so it is an unknown outcome like a drop.
      if (error instanceof StatuserApiError && error.status < 500) {
        return {
          applied,
          failure: {
            name: write.name,
            message: t.deployStopped(write.name, error.format()),
            exitCode: error.exitCode,
            outcome_unknown: false,
          },
        };
      }
      // A network failure says nothing about whether the server applied it.
      return {
        applied,
        failure: {
          name: write.name,
          message: t.applyUnknownOutcome(
            write.name,
            error instanceof StatuserApiError
              ? error.format()
              : error instanceof Error
                ? error.message
                : String(error),
          ),
          exitCode: ExitCode.Failure,
          outcome_unknown: true,
        },
      };
    }
  }
  return { applied };
}

function summarize(plan: FullPlan, dryRun: boolean, applied: Applied[]) {
  return {
    project_id: plan.projectId,
    dry_run: dryRun,
    // Request bodies are left out: they may carry passwords and env values.
    servers: plan.servers.steps.map((step) => ({
      name: step.entry.name,
      action: step.kind,
      id: step.kind === 'create' ? null : step.serverId,
      fields: step.kind === 'update' ? step.fields : undefined,
    })),
    scenarios: (plan.scenarios?.steps ?? []).map((step) => ({
      name: step.scenario.name,
      action: step.kind,
      id: step.kind === 'create' ? null : step.serverId,
      fields: step.kind === 'update' ? step.fields : undefined,
    })),
    unmanaged: [
      ...plan.servers.unmanaged,
      ...(plan.scenarios?.unmanaged ?? []),
    ],
    applied,
  };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const text = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CliError(
      t.configInvalid(path, t.cfgJson(jsonErrorPosition(error))),
      ExitCode.Usage,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliError(t.configInvalid(path, t.cfgObject), ExitCode.Usage);
  }
  return parsed as Record<string, unknown>;
}
