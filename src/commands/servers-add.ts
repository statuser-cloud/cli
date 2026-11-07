import type { Command } from 'commander';
import { isIP } from 'node:net';
import type { StatuserClient } from '../client.js';
import { authedClient, globalOptions } from '../context.js';
import { CliError, ExitCode } from '../errors.js';
import type { components } from '../generated/openapi.js';
import { t } from '../i18n.js';
import { printErr, printJson, printLine } from '../output.js';
import { SCENARIO_LOCATIONS } from '../scenarios/config.js';
import { parseServersSection } from '../servers-config/parse.js';
import { buildServersPlan } from '../servers-config/plan.js';
import { listServers, parseId, redactServer, type Server } from './servers.js';

type CurrentPlan = components['schemas']['CurrentPlanResponseDto'];
type Project = components['schemas']['ProjectResponseDto'];

const ADD_PROTOCOLS = ['http', 'keyword', 'ping', 'tcp', 'dns', 'heartbeat'];

interface AddOptions {
  name?: string;
  protocol?: string;
  project?: number;
  port?: string;
  keyword?: string;
  keywordAbsent?: boolean;
  dnsTypes?: string;
  interval?: string;
  timeout?: string;
  regions?: string;
  dryRun?: boolean;
}

/**
 * One server, with the panel defaults for everything not given. The entry
 * goes through the same parser and plan as `apply`, so the same checks run
 * before the write: ranges, the host gate, account-wide duplicates and the
 * plan. Settings without a flag here are changed later by `servers update`.
 */
export function registerServersAdd(servers: Command): void {
  servers
    .command('add')
    .description(t.cmdServersAdd)
    .argument('[host]', t.argServerHost)
    .option('--name <name>', t.optServerName)
    .option('--protocol <protocol>', t.optAddProtocol)
    .option('--project <id>', t.optProject, parseId)
    .option('--port <port>', t.optPort)
    .option('--keyword <word>', t.optKeyword)
    .option('--keyword-absent', t.optKeywordAbsent)
    .option('--dns-types <types>', t.optDnsTypes)
    .option('--interval <seconds>', t.optInterval)
    .option('--timeout <seconds>', t.optRequestTimeout)
    .option('--regions <codes>', t.optRegions)
    .option('--dry-run', t.optDryRun)
    .action(
      async (host: string | undefined, opts: AddOptions, command: Command) => {
        const entry = buildEntry(host, opts);
        // The parser names the place as in a file, `servers[0].port`; here
        // the field name alone says which flag to fix.
        const desired = parseServersSection(
          [entry],
          process.env,
          (problem) => usage(problem.replace(/^servers\[0\]\.?/, '')),
          { allowUnnamed: true },
        );
        const label = (entry.name as string | undefined) ?? host ?? '';
        desired[0]!.at = label;

        const { client } = await authedClient(command);
        const [account, current, projectId] = await Promise.all([
          listServers(client),
          client.call<CurrentPlan>({
            method: 'GET',
            path: '/v1/billing/current-plan',
          }),
          opts.project ?? defaultProject(client),
        ]);
        const plan = buildServersPlan(
          desired,
          projectId,
          account,
          current.features,
          0,
          { createOnly: true },
        );
        const step = plan.steps[0]!;
        if (step.kind !== 'create') throw new Error('expected a create step');
        for (const warning of step.warnings) printErr(warning);

        const json = globalOptions(command).json;
        if (opts.dryRun) {
          if (json) printJson({ dry_run: true, body: step.body });
          else printLine(t.addDryRun(label));
          return;
        }
        const created = await client.call<Server>({
          method: 'POST',
          path: '/v1/servers',
          body: step.body,
        });
        if (json) printJson(redactServer(created));
        else printLine(t.addCreated(created.id, created.name || label));
      },
    );
}

function buildEntry(
  host: string | undefined,
  opts: AddOptions,
): Record<string, unknown> {
  const protocol = opts.protocol ?? guessProtocol(host);
  if (!ADD_PROTOCOLS.includes(protocol)) {
    usage(`--protocol: ${t.cfgOneOf(ADD_PROTOCOLS.join(', '))}`);
  }
  if (protocol === 'heartbeat') {
    if (host) usage(t.addHostNotUsed);
    // A heartbeat is told apart by its name: the API requires one.
    if (!opts.name?.trim()) usage(`--name: ${t.cfgNonEmptyString}`);
  } else if (!host) {
    usage(t.addHostNeeded);
  }
  const entry: Record<string, unknown> = { protocol };
  if (host) entry.host = host;
  if (opts.name !== undefined) entry.name = opts.name;
  if (opts.port !== undefined) entry.port = integer('--port', opts.port);
  if (opts.keyword !== undefined) entry.keyword = opts.keyword;
  if (opts.keywordAbsent) entry.keyword_mode = 'absent';
  if (opts.dnsTypes !== undefined) entry.dns_record_types = list(opts.dnsTypes);
  if (opts.interval !== undefined) {
    entry.check_interval = integer('--interval', opts.interval);
  }
  if (opts.timeout !== undefined) {
    entry.request_timeout = integer('--timeout', opts.timeout);
  }
  if (opts.regions !== undefined) {
    const regions = list(opts.regions);
    for (const region of regions) {
      if (!SCENARIO_LOCATIONS.includes(region as never)) {
        usage(t.regionInvalid(region));
      }
    }
    entry.locations = regions;
  }
  return entry;
}

/** A URL is an HTTP check, an address literal a ping; anything else is asked. */
function guessProtocol(host: string | undefined): string {
  if (!host) return 'heartbeat';
  if (/^https?:\/\//i.test(host.trim())) return 'http';
  if (isIP(host.trim().replace(/^\[|\]$/g, ''))) return 'ping';
  return usage(t.addProtocolNeeded(host));
}

/** Where the API puts a server without `project_id`: the oldest project. */
async function defaultProject(client: StatuserClient): Promise<number> {
  const projects = await client.call<Project[]>({
    method: 'GET',
    path: '/v1/projects',
  });
  return Math.min(...projects.map((project) => project.id));
}

function integer(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value)) usage(`${flag}: ${t.numberInvalid(raw)}`);
  return value;
}

function list(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function usage(message: string): never {
  throw new CliError(message, ExitCode.Usage);
}
