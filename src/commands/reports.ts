import type { Command } from 'commander';
import type { StatuserClient } from '../client.js';
import { authedClient, globalOptions } from '../context.js';
import { CliError, ExitCode, StatuserApiError } from '../errors.js';
import type { components } from '../generated/openapi.js';
import { t } from '../i18n.js';
import { formatTime, printJson, printLine, printTable } from '../output.js';
import { pageServerIds } from '../status-page.js';
import { splitList } from './incidents.js';
import { parseId } from './servers.js';

type Report = components['schemas']['StatusPageIncidentReportResponseDto'];
type ServerStatus = Report['current_status'];

// `not_affected` drops a server from the report; it is not a way to state
// an impact, so the CLI does not offer it.
const IMPACTS: ServerStatus[] = ['downtime', 'degraded'];
const UPDATE_STATUSES: ServerStatus[] = ['downtime', 'degraded', 'resolved'];

interface CreateOptions {
  page: number;
  title: string;
  message: string;
  servers?: string;
  allServers?: boolean;
  status: string;
  incident?: string;
}

interface UpdateOptions {
  page: number;
  message: string;
  status?: string;
}

/**
 * Public incident reports on a status page. Every message goes to the page
 * timeline and to its subscribers in the page language, so the CLI never
 * writes a message of its own: `--message` is required everywhere.
 */
export function registerReportsCommands(program: Command): void {
  const reports = program.command('reports').description(t.cmdReports);

  reports
    .command('list')
    .description(t.cmdReportsList)
    .requiredOption('--page <id>', t.optPage, parseId)
    .action(async (opts: { page: number }, command: Command) => {
      const { client } = await authedClient(command);
      const list = await listReports(client, opts.page);
      if (globalOptions(command).json) {
        printJson(list);
        return;
      }
      if (!list.length) {
        printLine(t.reportsEmpty);
        return;
      }
      printTable(
        [t.colId, t.colTitle, t.colStatus, t.colStarted],
        list.map((report) => [
          report.id,
          report.title,
          t.serverImpact(report.current_status),
          formatTime(report.started_at),
        ]),
      );
    });

  reports
    .command('create')
    .description(t.cmdReportsCreate)
    .requiredOption('--page <id>', t.optPage, parseId)
    .requiredOption('--title <title>', t.optTitle)
    .requiredOption('--message <text>', t.optReportMessage)
    .option('--servers <ids>', t.optServers)
    .option('--all-servers', t.optAllServers)
    .option('--status <status>', t.optImpact, 'downtime')
    .option('--incident <ids>', t.optLinkedIncidents)
    .action(async (opts: CreateOptions, command: Command) => {
      const status = parseStatus(opts.status, IMPACTS);
      if (opts.servers && opts.allServers) {
        throw new CliError(t.maintenanceBothServers, ExitCode.Usage);
      }
      let serverIds = splitList(opts.servers).map(parseId);
      if (!serverIds.length && !opts.allServers) {
        throw new CliError(t.maintenanceNoServers, ExitCode.Usage);
      }
      const { client } = await authedClient(command);
      if (opts.allServers) serverIds = await pageServerIds(client, opts.page);
      const report = await client.call<Report>({
        method: 'POST',
        path: `/v1/status-pages/${opts.page}/incident-reports`,
        body: {
          title: opts.title,
          initial_message: opts.message,
          started_at: new Date().toISOString(),
          servers: serverIds.map((id) => ({ server_id: id, status })),
          incident_ids: splitList(opts.incident).map(parseId),
        },
      });
      if (globalOptions(command).json) printJson(report);
      else printLine(t.reportCreated(report.id));
    });

  reports
    .command('update')
    .description(t.cmdReportsUpdate)
    .argument('<reportId>', 'id', parseId)
    .requiredOption('--page <id>', t.optPage, parseId)
    .requiredOption('--message <text>', t.optReportMessage)
    .option('--status <status>', t.optUpdateStatus)
    .action(async (id: number, opts: UpdateOptions, command: Command) => {
      const status = opts.status
        ? parseStatus(opts.status, UPDATE_STATUSES)
        : undefined;
      const { client } = await authedClient(command);
      const report = await findReport(client, opts.page, id);
      const updated = await postUpdate(client, opts.page, report, {
        message: opts.message,
        status,
      });
      if (globalOptions(command).json) printJson(updated);
      else printLine(t.reportUpdated(id));
    });

  reports
    .command('resolve')
    .description(t.cmdReportsResolve)
    .argument('<reportId>', 'id', parseId)
    .requiredOption('--page <id>', t.optPage, parseId)
    .requiredOption('--message <text>', t.optReportMessage)
    .action(async (id: number, opts: UpdateOptions, command: Command) => {
      const { client } = await authedClient(command);
      const report = await findReport(client, opts.page, id);
      // A retried CI step must not send subscribers a second "resolved".
      if (report.current_status === 'resolved') {
        if (globalOptions(command).json) {
          printJson({ ...report, already_resolved: true });
        } else {
          printLine(t.reportAlreadyResolved(id));
        }
        return;
      }
      const updated = await postUpdate(client, opts.page, report, {
        message: opts.message,
        status: 'resolved',
      });
      if (globalOptions(command).json) printJson(updated);
      else printLine(t.reportResolved(id));
    });
}

async function listReports(
  client: StatuserClient,
  pageId: number,
): Promise<Report[]> {
  return client.call<Report[]>({
    method: 'GET',
    path: `/v1/status-pages/${pageId}/incident-reports`,
  });
}

async function findReport(
  client: StatuserClient,
  pageId: number,
  id: number,
): Promise<Report> {
  const report = (await listReports(client, pageId)).find((r) => r.id === id);
  if (!report) {
    throw new StatuserApiError(
      404,
      `incident report ${id} not found`,
      'status_page_incident_report_not_found',
    );
  }
  return report;
}

/**
 * An update carries the full list of affected servers with their statuses,
 * not a patch: servers left out would drop from the report. The current
 * list is the report's own (`servers[].id` there is the server id).
 */
async function postUpdate(
  client: StatuserClient,
  pageId: number,
  report: Report,
  change: { message: string; status?: ServerStatus },
): Promise<Report> {
  const servers = report.servers
    .filter((server) => server.status !== 'not_affected')
    .map((server) => ({
      server_id: server.id,
      status: change.status ?? server.status,
    }));
  if (!servers.length) {
    throw new CliError(t.reportNoServers(report.id), ExitCode.Usage);
  }
  return client.call<Report>({
    method: 'POST',
    path: `/v1/status-pages/${pageId}/incident-reports/${report.id}/updates`,
    body: { message: change.message, servers },
  });
}

function parseStatus(raw: string, allowed: ServerStatus[]): ServerStatus {
  if (!allowed.includes(raw as ServerStatus)) {
    throw new CliError(t.statusChoice(allowed.join(', ')), ExitCode.Usage);
  }
  return raw as ServerStatus;
}
