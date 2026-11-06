import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import type { StatuserClient } from '../client.js';
import { authedClient, globalOptions } from '../context.js';
import { CliError, ExitCode, StatuserApiError } from '../errors.js';
import type { components } from '../generated/openapi.js';
import { t } from '../i18n.js';
import { printErr, printJson, printLine, printTable } from '../output.js';
import { SCENARIO_LOCATIONS } from '../scenarios/config.js';
import {
  bulkTargetProblem,
  planServerPatch,
  type BulkChange,
} from '../servers-update.js';
import { isSecretHeader, MANAGED_PROTOCOLS } from '../servers-config/fields.js';
import { patchPlanProblem } from '../servers-config/plan.js';
import { describeWriteFailure } from '../write-failure.js';

export type Server = components['schemas']['ServerResponseDto'];
type CurrentPlan = components['schemas']['CurrentPlanResponseDto'];

export async function listServers(
  client: StatuserClient,
  projectId?: number,
): Promise<Server[]> {
  // Without `limit` the API returns the whole list in one response.
  return client.call<Server[]>({
    method: 'GET',
    path: '/v1/servers',
    query: { project_id: projectId },
  });
}

/**
 * The heartbeat token and secret header values are live credentials: a
 * `servers get` in a CI log would hand them to anyone reading it. They stay
 * reachable through `statuser api` for whoever needs them on purpose.
 */
export function redactServer(server: Server): Server {
  return {
    ...server,
    heartbeat_token: server.heartbeat_token ? '***' : server.heartbeat_token,
    headers: (server.headers ?? []).map((header) =>
      isSecretHeader(header.key) ? { ...header, value: '***' } : header,
    ),
  };
}

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new CliError(t.invalidId(raw), ExitCode.Usage);
  }
  return id;
}

interface BulkResult {
  done: number[];
  skipped: number[];
  /**
   * `outcome_unknown`: the request may have been applied before the answer
   * was lost (a drop, a timeout, a 5xx). `resume --from` returns those too.
   */
  failed: Array<{ id: number; message: string; outcome_unknown: boolean }>;
  /** Set when the key stopped working mid-way; the rest was not attempted. */
  aborted?: 'unauthorized';
}

export function registerServersCommands(program: Command): void {
  const servers = program.command('servers').description(t.cmdServers);

  servers
    .command('list')
    .description(t.cmdServersList)
    .option('--project <id>', t.optProject, parseId)
    .option('--protocol <protocol>', t.optProtocol, parseProtocol)
    .action(
      async (
        opts: { project?: number; protocol?: string },
        command: Command,
      ) => {
        const { client } = await authedClient(command);
        let list = await listServers(client, opts.project);
        if (opts.protocol) {
          list = list.filter((server) => server.protocol === opts.protocol);
        }
        if (globalOptions(command).json) {
          printJson(list.map(redactServer));
          return;
        }
        if (!list.length) {
          printLine(t.serversEmpty);
          return;
        }
        printTable(
          [
            t.colId,
            t.colName,
            t.colProtocol,
            t.colStatus,
            t.colHost,
            t.colProject,
          ],
          list.map((s) => [
            s.id,
            s.name,
            s.protocol,
            s.status,
            s.host,
            s.project_id,
          ]),
        );
      },
    );

  servers
    .command('get')
    .description(t.cmdServersGet)
    .argument('<id>', 'id', parseId)
    .action(async (id: number, _opts: unknown, command: Command) => {
      const { client } = await authedClient(command);
      printJson(
        redactServer(
          await client.call<Server>({
            method: 'GET',
            path: `/v1/servers/${id}`,
          }),
        ),
      );
    });

  servers
    .command('pause')
    .description(t.cmdServersPause)
    .argument('[ids...]', 'id')
    .option('--project <id>', t.optProject, parseId)
    .action(
      async (ids: string[], opts: { project?: number }, command: Command) => {
        const { client } = await authedClient(command);
        const all = await listServers(client, opts.project);
        const targets = pickTargets(all, ids, opts.project);
        // Already paused servers are skipped and left out of `done`: a
        // `resume --from` must not switch on checks someone turned off on purpose.
        const result = await bulk(client, targets, 'pause', (server) =>
          server.status === 'paused' ? t.alreadyPaused(server.id) : null,
        );
        report(command, result, t.pausedOne);
      },
    );

  servers
    .command('resume')
    .description(t.cmdServersResume)
    .argument('[ids...]', 'id')
    .option('--project <id>', t.optProject, parseId)
    .option('--from <file>', t.optFromFile)
    .action(
      async (
        ids: string[],
        opts: { project?: number; from?: string },
        command: Command,
      ) => {
        const { client } = await authedClient(command);
        const fromIds = opts.from ? await readPausedIds(opts.from) : [];
        if (opts.from && !ids.length && !fromIds.length) {
          // The pause step had nothing to pause — nothing to resume either.
          report(command, { done: [], skipped: [], failed: [] }, t.resumedOne);
          return;
        }
        const all = await listServers(client, opts.project);
        const targets = pickTargets(
          all,
          [...ids, ...fromIds.map(String)],
          opts.from ? undefined : opts.project,
        );
        const result = await bulk(client, targets, 'unpause', (server) =>
          server.status !== 'paused' ? t.notPaused(server.id) : null,
        );
        report(command, result, t.resumedOne);
      },
    );

  servers
    .command('update')
    .description(t.cmdServersUpdate)
    .argument('[ids...]', 'id')
    .option('--project <id>', t.optProject, parseId)
    .option('--protocol <protocol>', t.optProtocol, parseProtocol)
    .option('--interval <seconds>', t.optInterval, parseNonNegative)
    .option('--timeout <seconds>', t.optRequestTimeout, parseNonNegative)
    .option('--regions <codes>', t.optRegions)
    .option('--confirm-delay <seconds>', t.optConfirmDelay, parseNonNegative)
    .option('--ssl', t.optSsl)
    .option('--no-ssl', t.optNoSsl)
    .option('--domain', t.optDomain)
    .option('--no-domain', t.optNoDomain)
    .option('--blocklist', t.optBlocklist)
    .option('--no-blocklist', t.optNoBlocklist)
    .option('--latency-alert <ms>', t.optLatencyAlert, parseNonNegative)
    .option('--no-latency-alert', t.optNoLatencyAlert)
    .option('--dry-run', t.optDryRun)
    .action(async (ids: string[], opts: UpdateOptions, command: Command) => {
      const change = toBulkChange(opts);
      const { client } = await authedClient(command);
      let all = await listServers(client, opts.project);
      if (opts.protocol) {
        all = all.filter((server) => server.protocol === opts.protocol);
      }
      const targets = pickTargets(all, ids, opts.project);
      const plans = new Map(
        targets.map((server) => [server.id, planServerPatch(server, change)]),
      );
      const current = await client.call<CurrentPlan>({
        method: 'GET',
        path: '/v1/billing/current-plan',
      });
      for (const server of targets) {
        const plan = plans.get(server.id)!;
        const problem =
          bulkTargetProblem(server, plan) ??
          (plan.fields.length
            ? patchPlanProblem(server, plan.body, current.features)
            : null);
        if (problem) {
          throw new CliError(
            t.updateValueInvalid(server.id, problem),
            ExitCode.Usage,
          );
        }
      }
      const json = globalOptions(command).json;
      if (opts.dryRun) {
        const planned = targets.map((server) => {
          const plan = plans.get(server.id)!;
          return {
            id: server.id,
            fields: plan.fields,
            not_applicable: plan.notApplicable,
          };
        });
        if (json) printJson({ dry_run: true, planned });
        else {
          for (const item of planned) {
            printLine(
              describeUpdate(item.id, item.fields, item.not_applicable),
            );
          }
          printLine(t.deployDryRunDone);
        }
        return;
      }
      const result = await bulkApply(
        targets,
        (server) => {
          const plan = plans.get(server.id)!;
          if (plan.fields.length) return null;
          return plan.notApplicable.length
            ? t.updateNotApplicable(server.id, plan.notApplicable.join(', '))
            : t.updateUnchanged(server.id);
        },
        (server) =>
          client.call({
            method: 'PATCH',
            path: `/v1/servers/${server.id}`,
            body: plans.get(server.id)!.body,
          }),
      );
      report(command, result, (id) => {
        const plan = plans.get(id)!;
        return describeUpdate(id, plan.fields, plan.notApplicable);
      });
    });
}

interface UpdateOptions {
  project?: number;
  protocol?: string;
  interval?: number;
  timeout?: number;
  regions?: string;
  confirmDelay?: number;
  ssl?: boolean;
  domain?: boolean;
  blocklist?: boolean;
  latencyAlert?: number | false;
  dryRun?: boolean;
}

const CONFIRM_DELAY_MAX = 3600;
const LATENCY_MIN = 50;
const LATENCY_MAX = 60_000;

function toBulkChange(opts: UpdateOptions): BulkChange {
  const regions = opts.regions
    ?.split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (regions) {
    if (!regions.length) throw new CliError(t.regionsEmpty, ExitCode.Usage);
    for (const region of regions) {
      if (!SCENARIO_LOCATIONS.includes(region as never)) {
        throw new CliError(t.regionInvalid(region), ExitCode.Usage);
      }
    }
  }
  // API bounds of the flags that do not depend on the protocol.
  if (
    opts.confirmDelay !== undefined &&
    opts.confirmDelay > CONFIRM_DELAY_MAX
  ) {
    throw new CliError(t.numberRange(0, CONFIRM_DELAY_MAX), ExitCode.Usage);
  }
  if (
    typeof opts.latencyAlert === 'number' &&
    (opts.latencyAlert < LATENCY_MIN || opts.latencyAlert > LATENCY_MAX)
  ) {
    throw new CliError(t.numberRange(LATENCY_MIN, LATENCY_MAX), ExitCode.Usage);
  }
  const change: BulkChange = {
    interval: opts.interval,
    timeout: opts.timeout,
    regions,
    confirmDelay: opts.confirmDelay,
    ssl: opts.ssl,
    domain: opts.domain,
    blocklist: opts.blocklist,
    latency: opts.latencyAlert,
  };
  if (Object.values(change).every((value) => value === undefined)) {
    throw new CliError(t.updateNothing, ExitCode.Usage);
  }
  return change;
}

function describeUpdate(
  id: number,
  fields: string[],
  notApplicable: string[],
): string {
  const parts = [fields.length ? fields.join(', ') : t.noChanges];
  if (notApplicable.length) {
    parts.push(t.notApplicableNote(notApplicable.join(', ')));
  }
  return `#${id}: ${parts.join('; ')}`;
}

function parseNonNegative(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new CliError(t.numberInvalid(raw), ExitCode.Usage);
  }
  return value;
}

export function pickTargets(
  all: Server[],
  rawIds: string[],
  projectId: number | undefined,
): Server[] {
  if (!rawIds.length) {
    if (projectId === undefined) {
      throw new CliError(t.serversNoTargets, ExitCode.Usage);
    }
    return all;
  }
  const byId = new Map(all.map((server) => [server.id, server]));
  return rawIds.map((raw) => {
    const id = parseId(raw);
    const server = byId.get(id);
    if (!server) {
      throw new StatuserApiError(404, t.notFound(id), 'server_not_found');
    }
    return server;
  });
}

async function bulk(
  client: StatuserClient,
  targets: Server[],
  action: 'pause' | 'unpause',
  skipReason: (server: Server) => string | null,
): Promise<BulkResult> {
  return bulkApply(targets, skipReason, (server) =>
    client.call({
      method: 'PATCH',
      path: `/v1/servers/${server.id}/${action}`,
    }),
  );
}

export async function bulkApply(
  targets: Server[],
  skipReason: (server: Server) => string | null,
  apply: (server: Server) => Promise<unknown>,
): Promise<BulkResult> {
  const result: BulkResult = { done: [], skipped: [], failed: [] };
  for (const server of targets) {
    const reason = skipReason(server);
    if (reason) {
      printErr(reason);
      result.skipped.push(server.id);
      continue;
    }
    try {
      await apply(server);
      result.done.push(server.id);
    } catch (error) {
      if (error instanceof StatuserApiError && error.status === 401) {
        // The key stopped working: every next call fails the same way. What
        // was done so far is still reported, so `resume --from` can use it.
        result.aborted = 'unauthorized';
        break;
      }
      const failure = describeWriteFailure(`#${server.id}`, error);
      const message =
        error instanceof StatuserApiError
          ? error.format()
          : error instanceof Error
            ? error.message
            : String(error);
      printErr(t.bulkFailed(server.id, message));
      result.failed.push({
        id: server.id,
        message,
        outcome_unknown: failure.outcome_unknown,
      });
    }
  }
  return result;
}

export function report(
  command: Command,
  result: BulkResult,
  doneLine: (id: number) => string,
): void {
  if (globalOptions(command).json) {
    // `paused`/`resumed` naming would split the contract; one shape for both.
    printJson(result);
  } else {
    for (const id of result.done) printLine(doneLine(id));
    printLine(t.bulkSummary(result.done.length, result.failed.length));
  }
  if (result.aborted) {
    printErr(t.unauthorized);
    process.exitCode = ExitCode.Auth;
  } else if (result.failed.length) {
    process.exitCode = ExitCode.Failure;
  }
}

async function readPausedIds(path: string): Promise<number[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      done?: unknown;
      failed?: unknown;
    };
    if (
      Array.isArray(parsed.done) &&
      parsed.done.every((id) => Number.isInteger(id))
    ) {
      // A pause whose answer was lost may have been applied: it is resumed
      // too, and a server that is not paused is skipped.
      const uncertain = Array.isArray(parsed.failed)
        ? parsed.failed
            .filter(
              (f: { id?: unknown; outcome_unknown?: unknown }) =>
                f?.outcome_unknown === true && Number.isInteger(f.id),
            )
            .map((f: { id: number }) => f.id)
        : [];
      return [...(parsed.done as number[]), ...uncertain];
    }
  } catch {
    // Reported below with the file name.
  }
  throw new CliError(t.fromFileInvalid(path), ExitCode.Usage);
}

const PROTOCOLS: Array<Server['protocol']> = [...MANAGED_PROTOCOLS, 'scenario'];

/** A typo would filter out every server and report an empty success. */
function parseProtocol(raw: string): string {
  if (!PROTOCOLS.includes(raw as Server['protocol'])) {
    throw new CliError(
      `--protocol: ${t.cfgOneOf(PROTOCOLS.join(', '))}`,
      ExitCode.Usage,
    );
  }
  return raw;
}
