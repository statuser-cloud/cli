import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import type { StatuserClient } from '../client.js';
import { authedClient, globalOptions } from '../context.js';
import { CliError, ExitCode, StatuserApiError } from '../errors.js';
import type { components } from '../generated/openapi.js';
import { t } from '../i18n.js';
import { printErr, printJson, printLine, printTable } from '../output.js';

export type Server = components['schemas']['ServerResponseDto'];

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
  failed: Array<{ id: number; message: string }>;
}

export function registerServersCommands(program: Command): void {
  const servers = program.command('servers').description(t.cmdServers);

  servers
    .command('list')
    .description(t.cmdServersList)
    .option('--project <id>', t.optProject, parseId)
    .option('--protocol <protocol>', t.optProtocol)
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
          printJson(list);
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
        await client.call<Server>({ method: 'GET', path: `/v1/servers/${id}` }),
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
}

function pickTargets(
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
      throw new StatuserApiError(
        404,
        `server ${id} not found`,
        'server_not_found',
      );
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
  const result: BulkResult = { done: [], skipped: [], failed: [] };
  for (const server of targets) {
    const reason = skipReason(server);
    if (reason) {
      printErr(reason);
      result.skipped.push(server.id);
      continue;
    }
    try {
      await client.call({
        method: 'PATCH',
        path: `/v1/servers/${server.id}/${action}`,
      });
      result.done.push(server.id);
    } catch (error) {
      if (error instanceof StatuserApiError && error.status === 401) {
        // The key stopped working: every next call fails the same way.
        throw error;
      }
      const message =
        error instanceof StatuserApiError ? error.format() : String(error);
      printErr(t.bulkFailed(server.id, message));
      result.failed.push({ id: server.id, message });
    }
  }
  return result;
}

function report(
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
  if (result.failed.length) process.exitCode = ExitCode.Failure;
}

async function readPausedIds(path: string): Promise<number[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      done?: unknown;
    };
    if (
      Array.isArray(parsed.done) &&
      parsed.done.every((id) => Number.isInteger(id))
    ) {
      return parsed.done as number[];
    }
  } catch {
    // Reported below with the file name.
  }
  throw new CliError(t.fromFileInvalid(path), ExitCode.Usage);
}
