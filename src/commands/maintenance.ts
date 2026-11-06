import type { Command } from 'commander';
import { authedClient, globalOptions } from '../context.js';
import { parseDuration } from '../duration.js';
import { CliError, ExitCode, StatuserApiError } from '../errors.js';
import type { components } from '../generated/openapi.js';
import { t } from '../i18n.js';
import { printJson, printLine } from '../output.js';
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
      if (opts.servers && opts.allServers) {
        throw new CliError(t.maintenanceBothServers, ExitCode.Usage);
      }
      let serverIds = (opts.servers ?? '')
        .split(',')
        .map((raw) => raw.trim())
        .filter(Boolean)
        .map(parseId);
      if (!serverIds.length && !opts.allServers) {
        throw new CliError(t.maintenanceNoServers, ExitCode.Usage);
      }
      const { client } = await authedClient(command);
      if (opts.allServers) serverIds = await pageServerIds(client, opts.page);
      const now = new Date();
      const created = await client.call<Maintenance>({
        method: 'POST',
        path: `/v1/status-pages/${opts.page}/planned-maintenances`,
        body: {
          title: opts.title,
          description: opts.description,
          started_at: now.toISOString(),
          ended_at: new Date(now.getTime() + windowMs).toISOString(),
          servers: serverIds.map((id) => ({ id })),
        },
      });
      if (globalOptions(command).json) printJson(created);
      else printLine(t.maintenanceStarted(created.id, created.ended_at));
    });

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
