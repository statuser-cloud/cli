import type { Command } from 'commander';
import { authedClient, globalOptions } from '../context.js';
import { parseDuration } from '../duration.js';
import { CliError, ExitCode } from '../errors.js';
import { writeOwnFile } from '../files.js';
import type { components } from '../generated/openapi.js';
import { t } from '../i18n.js';
import { isSecretHeader } from '../servers-config/fields.js';
import {
  formatDuration,
  formatTime,
  printJson,
  printLine,
  printTable,
} from '../output.js';
import { listServers, parseId } from './servers.js';

type Incident = components['schemas']['IncidentResponseDto'];
type IncidentStatus = Incident['status'];
type IncidentSummary = components['schemas']['IncidentSummaryResponseDto'];

const STATUSES: IncidentStatus[] = [
  'ongoing',
  'resolved',
  'dismissed',
  'auto_closed_changed',
  'auto_closed_timeout',
];

// The PDF may include an AI summary, generated on the spot with its own
// 45 s timeout and a retry, before the document itself is rendered.
const PDF_TIMEOUT_MS = 180_000;

interface ListOptions {
  open?: boolean;
  status?: string;
  server?: string;
  project?: number;
  since?: string;
  until?: string;
}

export function registerIncidentsCommands(program: Command): void {
  const incidents = program.command('incidents').description(t.cmdIncidents);

  incidents
    .command('list')
    .description(t.cmdIncidentsList)
    .option('--open', t.optOpen)
    .option('--status <statuses>', t.optIncidentStatus)
    .option('--server <ids>', t.optServerIds)
    .option('--project <id>', t.optProject, parseId)
    .option('--since <when>', t.optSince)
    .option('--until <when>', t.optUntil)
    .action(async (opts: ListOptions, command: Command) => {
      if (opts.open && opts.status) {
        throw new CliError(t.incidentsOpenWithStatus, ExitCode.Usage);
      }
      const statuses = opts.open ? ['ongoing'] : splitList(opts.status);
      for (const status of statuses) {
        if (!STATUSES.includes(status as IncidentStatus)) {
          throw new CliError(t.incidentStatusInvalid(status), ExitCode.Usage);
        }
      }
      const serverIds = splitList(opts.server).map(parseId);
      const { client } = await authedClient(command);
      const list = await client.call<Incident[]>({
        method: 'GET',
        path: '/v1/incidents',
        query: {
          status: statuses.join(',') || undefined,
          server_ids: serverIds.join(',') || undefined,
          project_id: opts.project,
          from: opts.since ? parseWhen(opts.since) : undefined,
          to: opts.until ? parseWhen(opts.until) : undefined,
        },
      });
      if (globalOptions(command).json) {
        printJson(list.map(redactIncident));
        return;
      }
      if (!list.length) {
        printLine(t.incidentsEmpty);
        return;
      }
      const names = new Map(
        (await listServers(client, opts.project)).map((s) => [
          s.id,
          s.name || s.host,
        ]),
      );
      printTable(
        [
          t.colId,
          t.colServer,
          t.colStatus,
          t.colStarted,
          t.colDuration,
          t.colError,
        ],
        list.map((incident) => [
          incident.id,
          names.get(incident.server_id) ?? `#${incident.server_id}`,
          t.incidentStatus(incident.status),
          formatTime(incident.started_at),
          formatDuration(incident.started_at, incident.ended_at),
          incident.root_error,
        ]),
      );
    });

  incidents
    .command('get')
    .description(t.cmdIncidentsGet)
    .argument('<id>', 'id', parseId)
    .action(async (id: number, _opts: unknown, command: Command) => {
      const { client } = await authedClient(command);
      const incident = await client.call<Incident>({
        method: 'GET',
        path: `/v1/incidents/${id}`,
      });
      if (globalOptions(command).json) {
        printJson(redactIncident(incident));
        return;
      }
      const server = await client
        .call<{ name: string | null; host: string }>({
          method: 'GET',
          path: `/v1/incidents/${id}/server`,
        })
        .catch(() => null);
      printLine(t.incidentTitle(incident.id));
      printLine(
        t.incidentServer(
          server?.name || server?.host || `#${incident.server_id}`,
        ),
      );
      printLine(t.incidentStatusLine(t.incidentStatus(incident.status)));
      printLine(t.incidentStarted(formatTime(incident.started_at)));
      if (incident.ended_at) {
        printLine(t.incidentEnded(formatTime(incident.ended_at)));
      }
      printLine(
        t.incidentDurationLine(
          formatDuration(incident.started_at, incident.ended_at),
        ),
      );
      printLine(t.incidentError(incident.root_error));
      // Diagnostics depend on the plan and may not exist at all.
      if (incident.details?.length) {
        printLine(
          t.incidentDiagnostics(
            incident.details.map((detail) => detail.location).join(', '),
          ),
        );
      }
    });

  incidents
    .command('ai')
    .description(t.cmdIncidentsAi)
    .argument('<id>', 'id', parseId)
    .action(async (id: number, _opts: unknown, command: Command) => {
      const { client } = await authedClient(command);
      const summary = await client.call<IncidentSummary>({
        method: 'POST',
        path: `/v1/incidents/${id}/ai-summary`,
        timeoutMs: PDF_TIMEOUT_MS,
      });
      if (globalOptions(command).json) printJson(summary);
      else printLine(summary.summary ?? t.aiNoData);
    });

  incidents
    .command('pdf')
    .description(t.cmdIncidentsPdf)
    .argument('<id>', 'id', parseId)
    .requiredOption('-o, --output <file>', t.optOutput)
    .option('--force', t.optForce)
    .action(
      async (
        id: number,
        opts: { output: string; force?: boolean },
        command: Command,
      ) => {
        const { client } = await authedClient(command);
        const file = await client.callBinary({
          method: 'GET',
          path: `/v1/incidents/${id}/report`,
          timeoutMs: PDF_TIMEOUT_MS,
        });
        if (!file.contentType.includes('pdf')) {
          throw new CliError(t.unexpectedContentType(file.contentType));
        }
        await writeOwnFile(opts.output, file.bytes, !!opts.force);
        if (globalOptions(command).json) {
          printJson({ file: opts.output, bytes: file.bytes.length });
        } else {
          printLine(t.fileSaved(opts.output));
        }
      },
    );
}

export function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** `24h`, `7d`-style relative windows or an ISO date. */
export function parseWhen(raw: string, now = Date.now()): string {
  const days = /^(\d+)d$/.exec(raw.trim());
  if (days) return new Date(now - +days[1]! * 86_400_000).toISOString();
  if (/^(?:\d+[hms])+$/.test(raw.trim())) {
    return new Date(now - parseDuration(raw)).toISOString();
  }
  const date = Date.parse(raw);
  if (Number.isNaN(date)) {
    throw new CliError(t.whenInvalid(raw), ExitCode.Usage);
  }
  return new Date(date).toISOString();
}

/**
 * Response headers of the checked site are kept with the incident as they
 * came (cookies, tokens), and the replay command carries the server's own
 * headers; the backend masks only some names there, and replays stored
 * before that stay as they were. Output that goes to CI logs hides these
 * values the way `servers get` does. `statuser api` shows them.
 */
export function redactIncident(incident: Incident): Incident {
  return {
    ...incident,
    replay: incident.replay ? redactReplay(incident.replay) : incident.replay,
    details:
      incident.details &&
      incident.details.map((detail) =>
        detail.headers
          ? {
              ...detail,
              headers: Object.fromEntries(
                Object.entries(detail.headers).map(([key, value]) => [
                  key,
                  isSecretHeader(key) ? '***' : value,
                ]),
              ),
            }
          : detail,
      ),
  };
}

// `-H` and its argument as the backend writes them: single-quoted with
// `'\''` for a quote inside, or bare when the value needs no quoting.
const REPLAY_HEADER = /-H ('(?:[^']|'\\'')*'|[^\s']+)/g;

export function redactReplay(replay: string): string {
  return replay.replace(REPLAY_HEADER, (whole, arg: string) => {
    const header = arg.startsWith("'")
      ? arg.slice(1, -1).replace(/'\\''/g, "'")
      : arg;
    const colon = header.indexOf(':');
    if (colon < 0) return whole;
    const key = header.slice(0, colon).trim();
    const value = header.slice(colon + 1).trim();
    if (!value || !isSecretHeader(key)) return whole;
    // The scheme says what to substitute; like the backend, it is kept only
    // for Authorization — elsewhere the first word is part of the secret.
    const scheme = /authorization/i.test(key)
      ? /^([A-Za-z][A-Za-z0-9-]*)\s+\S/.exec(value)?.[1]
      : undefined;
    return `-H '${key}: ${scheme ? `${scheme} ***` : '***'}'`;
  });
}
