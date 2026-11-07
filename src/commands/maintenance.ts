import type { Command } from 'commander';
import { authedClient, globalOptions } from '../context.js';
import { parseDuration } from '../duration.js';
import { CliError, ExitCode, StatuserApiError } from '../errors.js';
import type { components } from '../generated/openapi.js';
import { t } from '../i18n.js';
import type { StatuserClient } from '../client.js';
import { confirmDeletion } from '../confirm.js';
import { formatTime, printJson, printLine, printTable } from '../output.js';
import { pageServerIds } from '../status-page.js';
import { parseId } from './servers.js';
import { textLength } from '../text-length.js';

type Maintenance =
  components['schemas']['StatusPagePlannedMaintenanceResponseDto'];

const DEFAULT_WINDOW = '30m';
// `MaxLength` of an update message in the API.
const MESSAGE_MAX_LENGTH = 65_535;

interface StartOptions {
  page: number;
  title: string;
  description: string;
  for: string;
  servers?: string;
  allServers?: boolean;
}

interface ScheduleOptions extends StartOptions {
  at: string;
}

interface EndOptions {
  page: number;
  message?: string;
}

/**
 * Planned maintenance is shown on the status page and announced to
 * subscribers; it does NOT mute alerts. Pausing checks around a deploy is a
 * separate step (`servers pause` / `servers resume --from`).
 */
export function registerMaintenanceCommands(program: Command): void {
  const maintenance = program
    .command('maintenance')
    .description(t.cmdMaintenance);

  maintenance
    .command('start')
    .description(t.cmdMaintenanceStart)
    .requiredOption('--page <id>', t.optPage, parseId)
    .requiredOption('--title <title>', t.optTitle)
    .requiredOption('--description <text>', t.optDescription)
    .option('--servers <ids>', t.optServers)
    .option('--all-servers', t.optAllServers)
    .option('--for <duration>', t.optFor, DEFAULT_WINDOW)
    .action(async (opts: StartOptions, command: Command) => {
      const windowMs = parseDuration(opts.for);
      const servers = pickServers(opts);
      const { client } = await authedClient(command);
      const now = new Date();
      const created = await createMaintenance(
        client,
        opts,
        servers,
        now,
        windowMs,
      );
      if (globalOptions(command).json) printJson(created);
      else printLine(t.maintenanceStarted(created.id, created.ended_at));
    });

  maintenance
    .command('schedule')
    .description(t.cmdMaintenanceSchedule)
    .requiredOption('--page <id>', t.optPage, parseId)
    .requiredOption('--at <datetime>', t.optAt)
    .requiredOption('--title <title>', t.optTitle)
    .requiredOption('--description <text>', t.optDescription)
    .option('--servers <ids>', t.optServers)
    .option('--all-servers', t.optAllServers)
    .option('--for <duration>', t.optFor, DEFAULT_WINDOW)
    .action(async (opts: ScheduleOptions, command: Command) => {
      const windowMs = parseDuration(opts.for);
      // A start in the past would announce what already happened; work
      // going on now is opened by `start`.
      const start = Date.parse(opts.at);
      if (Number.isNaN(start) || start <= Date.now()) {
        throw new CliError(t.maintenanceAtInvalid(opts.at), ExitCode.Usage);
      }
      const servers = pickServers(opts);
      const { client } = await authedClient(command);
      const created = await createMaintenance(
        client,
        opts,
        servers,
        new Date(start),
        windowMs,
      );
      if (globalOptions(command).json) printJson(created);
      else {
        printLine(
          t.maintenanceScheduled(
            created.id,
            formatTime(created.started_at),
            formatTime(created.ended_at),
          ),
        );
      }
    });

  maintenance
    .command('list')
    .description(t.cmdMaintenanceList)
    .requiredOption('--page <id>', t.optPage, parseId)
    .action(async (opts: { page: number }, command: Command) => {
      const { client } = await authedClient(command);
      const list = await client.call<Maintenance[]>({
        method: 'GET',
        path: `/v1/status-pages/${opts.page}/planned-maintenances`,
      });
      if (globalOptions(command).json) {
        printJson(list);
        return;
      }
      if (!list.length) {
        printLine(t.maintenanceEmpty);
        return;
      }
      printTable(
        [t.colId, t.colTitle, t.colStarted, t.colEnd],
        list.map((item) => [
          item.id,
          item.title,
          formatTime(item.started_at),
          formatTime(item.ended_at),
        ]),
      );
    });

  maintenance
    .command('delete')
    .description(t.cmdMaintenanceDelete)
    .argument('<maintenanceId>', 'id', parseId)
    .requiredOption('--page <id>', t.optPage, parseId)
    .option('--yes', t.optYes)
    .action(
      async (
        id: number,
        opts: { page: number; yes?: boolean },
        command: Command,
      ) => {
        const { client } = await authedClient(command);
        const base = `/v1/status-pages/${opts.page}/planned-maintenances`;
        const current = (
          await client.call<Maintenance[]>({ method: 'GET', path: base })
        ).find((item) => item.id === id);
        if (!current) {
          throw new StatuserApiError(404, t.notFound(id), 'not_found');
        }
        await confirmDeletion(
          t.confirmDeleteMaintenance(id, current.title),
          opts.yes,
        );
        await client.call({ method: 'DELETE', path: `${base}/${id}` });
        if (globalOptions(command).json) printJson({ deleted: true, id });
        else printLine(t.deletedOne(id));
      },
    );

  maintenance
    .command('end')
    .description(t.cmdMaintenanceEnd)
    .argument('<maintenanceId>', 'id', parseId)
    .requiredOption('--page <id>', t.optPage, parseId)
    .option('--message <text>', t.optMessage)
    .action(async (id: number, opts: EndOptions, command: Command) => {
      // Checked before the window is closed: a message the API rejects after
      // the PATCH would leave the window closed without its announcement.
      if (opts.message !== undefined) {
        const text = opts.message.trim();
        if (!text || textLength(text) > MESSAGE_MAX_LENGTH) {
          throw new CliError(
            t.messageInvalid(MESSAGE_MAX_LENGTH),
            ExitCode.Usage,
          );
        }
      }
      const { client } = await authedClient(command);
      const base = `/v1/status-pages/${opts.page}/planned-maintenances`;
      const list = await client.call<Maintenance[]>({
        method: 'GET',
        path: base,
      });
      const current = list.find((item) => item.id === id);
      if (!current) {
        throw new StatuserApiError(
          404,
          t.notFound(id),
          'status_page_planned_maintenance_not_found',
        );
      }

      // A repeated `end` (retried CI job) must not move an already passed
      // end date forward to the new "now".
      const now = new Date();
      const alreadyEnded = new Date(current.ended_at) <= now;
      let result = current;
      if (!alreadyEnded) {
        result = await client.call<Maintenance>({
          method: 'PATCH',
          path: `${base}/${id}`,
          body: { ended_at: now.toISOString() },
        });
      }

      // Changing the date alone adds nothing to the timeline and notifies
      // nobody; a message does both. The same message already in the
      // timeline means a retried step: subscribers are not told twice.
      const message = opts.message?.trim();
      const alreadyPosted =
        !!message &&
        current.updates.some((update) => update.message.trim() === message);
      if (message && !alreadyPosted) {
        try {
          result = await client.call<Maintenance>({
            method: 'POST',
            path: `${base}/${id}/updates`,
            body: { message },
          });
        } catch (error) {
          throw new CliError(
            t.maintenanceMessageFailed(
              error instanceof StatuserApiError
                ? error.format()
                : String(error),
            ),
            error instanceof StatuserApiError
              ? error.exitCode
              : ExitCode.Failure,
          );
        }
      }

      if (globalOptions(command).json) {
        printJson({ ...result, already_ended: alreadyEnded });
      } else {
        printLine(
          alreadyEnded ? t.maintenanceAlreadyEnded(id) : t.maintenanceEnded(id),
        );
      }
    });
}

/** The servers named on the command line, or `all` for the whole page. */
function pickServers(opts: StartOptions): number[] | 'all' {
  if (opts.servers && opts.allServers) {
    throw new CliError(t.maintenanceBothServers, ExitCode.Usage);
  }
  if (opts.allServers) return 'all';
  const ids = (opts.servers ?? '')
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map(parseId);
  if (!ids.length) throw new CliError(t.maintenanceNoServers, ExitCode.Usage);
  return ids;
}

async function createMaintenance(
  client: StatuserClient,
  opts: StartOptions,
  servers: number[] | 'all',
  start: Date,
  windowMs: number,
): Promise<Maintenance> {
  const serverIds =
    servers === 'all' ? await pageServerIds(client, opts.page) : servers;
  return client.call<Maintenance>({
    method: 'POST',
    path: `/v1/status-pages/${opts.page}/planned-maintenances`,
    body: {
      title: opts.title,
      description: opts.description,
      started_at: start.toISOString(),
      ended_at: new Date(start.getTime() + windowMs).toISOString(),
      servers: serverIds.map((id) => ({ id })),
    },
  });
}
