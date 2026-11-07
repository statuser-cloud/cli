import type { Command } from 'commander';
import { authedClient, globalOptions } from '../context.js';
import { t } from '../i18n.js';
import { formatTime, printJson, printLine, printTable } from '../output.js';
import { parseWhen } from './incidents.js';
import { parseId } from './servers.js';

// The spec has no schema for this answer (`ServerCheckResponseDto` lacks
// `@ApiProperty` in the backend), so its shape is written out here.
interface CheckGroup {
  group_id: string;
  group_checked_at: string;
  locations: Array<{
    location: string;
    status: string;
    latency: number;
    checked_at: string;
  }>;
}

/**
 * Checks of a server as the panel's chart gets them: points over the
 * period, each with the status and latency per location. Longer periods
 * come aggregated into time buckets by the API.
 */
export function registerServersChecks(servers: Command): void {
  servers
    .command('checks')
    .description(t.cmdServersChecks)
    .argument('<id>', 'id', parseId)
    .option('--since <when>', t.optChecksSince)
    .option('--until <when>', t.optChecksUntil)
    .action(
      async (
        id: number,
        opts: { since?: string; until?: string },
        command: Command,
      ) => {
        const query = {
          startDate: opts.since ? parseWhen(opts.since) : undefined,
          endDate: opts.until ? parseWhen(opts.until) : undefined,
        };
        const { client } = await authedClient(command);
        const groups = await client.call<CheckGroup[]>({
          method: 'GET',
          path: `/v1/servers/${id}/checks`,
          query,
        });
        if (globalOptions(command).json) {
          printJson(groups);
          return;
        }
        // For a day the API adds the last raw checks (`raw:…`) on top of the
        // aggregated points, so the panel's chart keeps moving between them;
        // in a table they repeat the points next to them.
        const points = groups.some((g) => !g.group_id.startsWith('raw:'))
          ? groups.filter((g) => !g.group_id.startsWith('raw:'))
          : groups;
        if (!points.length) {
          printLine(t.checksEmpty);
          return;
        }
        printTable(
          [t.colTime, t.colStatus, t.colLocations],
          points.map((group) => [
            formatTime(group.group_checked_at),
            group.locations.some((l) => l.status === 'offline')
              ? 'offline'
              : 'online',
            group.locations
              .map((l) =>
                l.status === 'online'
                  ? `${l.location} ${Math.round(l.latency)} ms`
                  : `${l.location} ${l.status}`,
              )
              .join(', '),
          ]),
        );
      },
    );
}
