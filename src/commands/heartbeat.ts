import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { sleep, type StatuserClient } from '../client.js';
import { anonymousClient, authedClient, globalOptions } from '../context.js';
import { CliError, ExitCode, StatuserApiError } from '../errors.js';
import { t } from '../i18n.js';
import { printErr, printJson, printLine } from '../output.js';
import { parseId, type Server } from './servers.js';

const PING_ATTEMPTS = 3;
const PING_RETRY_DELAY_MS = 2_000;
const PING_TIMEOUT_MS = 10_000;

interface TokenOptions {
  heartbeat?: string;
  server?: number;
}

export function registerHeartbeatCommands(program: Command): void {
  const heartbeat = program.command('heartbeat').description(t.cmdHeartbeat);

  heartbeat
    .command('ping')
    .description(t.cmdHeartbeatPing)
    .argument('[token]', t.optHeartbeatToken)
    .option('--server <id>', t.optHeartbeatServer, parseId)
    .option('--fail', t.optFail)
    .action(
      async (
        token: string | undefined,
        opts: { server?: number; fail?: boolean },
        command: Command,
      ) => {
        const resolved = await resolveToken(command, {
          heartbeat: token,
          server: opts.server,
        });
        await sendHeartbeat(
          await anonymousClient(command),
          resolved,
          !!opts.fail,
        );
        if (globalOptions(command).json)
          printJson({ ok: true, fail: !!opts.fail });
        else printLine(opts.fail ? t.heartbeatFailSent : t.heartbeatSent);
      },
    );

  program
    .command('run')
    .description(t.cmdRun)
    .option('--heartbeat <token>', t.optHeartbeatToken)
    .option('--server <id>', t.optHeartbeatServer, parseId)
    .argument('<command...>')
    .action(async (argv: string[], opts: TokenOptions, command: Command) => {
      const [file, ...args] = argv;
      if (!file) throw new CliError(t.runNoCommand, ExitCode.Usage);
      // Resolved before the run: a typo in the token should fail now, not
      // after an hour-long backup.
      const token = await resolveToken(command, opts);
      const client = await anonymousClient(command);

      // With --json stdout carries only our report, so the command's own
      // output goes to stderr.
      const json = !!globalOptions(command).json;
      const exitCode = await runChild(file, args, json);
      let delivered = true;
      try {
        await sendHeartbeat(client, token, exitCode !== 0);
      } catch (error) {
        // The command's own result wins: a backup that succeeded must not
        // turn into a failed CI step because the ping did not get through.
        delivered = false;
        printErr(t.heartbeatSendFailed(describe(error)));
      }
      if (json) {
        printJson({ exit_code: exitCode, fail: exitCode !== 0, delivered });
      }
      process.exitCode = exitCode;
    });
}

async function resolveToken(
  command: Command,
  opts: TokenOptions,
): Promise<string> {
  const token = opts.heartbeat || process.env.STATUSER_HEARTBEAT_TOKEN;
  if (opts.heartbeat && opts.server !== undefined) {
    throw new CliError(t.heartbeatBothSources, ExitCode.Usage);
  }
  if (opts.server === undefined) {
    if (!token) throw new CliError(t.heartbeatNoToken, ExitCode.Usage);
    return token;
  }
  const { client } = await authedClient(command);
  const server = await client.call<Server>({
    method: 'GET',
    path: `/v1/servers/${opts.server}`,
  });
  if (server.protocol !== 'heartbeat' || !server.heartbeat_token) {
    throw new CliError(
      t.heartbeatNotHeartbeat(server.id, server.protocol),
      ExitCode.Usage,
    );
  }
  return server.heartbeat_token;
}

/**
 * Network errors, 429 and 5xx are retried, although a ping that timed out
 * may already be recorded: a repeated ping changes nothing that matters, a
 * lost failure ping leaves a broken job unnoticed. 4xx is final.
 */
async function sendHeartbeat(
  client: StatuserClient,
  token: string,
  fail: boolean,
): Promise<void> {
  const path = `/v1/heartbeat/${encodeURIComponent(token)}${fail ? '/fail' : ''}`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await client.call({
        method: 'POST',
        path,
        anonymous: true,
        timeoutMs: PING_TIMEOUT_MS,
      });
      return;
    } catch (error) {
      if (error instanceof StatuserApiError && error.status === 404) {
        throw new CliError(t.heartbeatTokenRejected, ExitCode.Usage);
      }
      const retryable =
        !(error instanceof StatuserApiError) ||
        error.status === 429 ||
        error.status >= 500;
      if (!retryable || attempt >= PING_ATTEMPTS) throw error;
      await sleep(PING_RETRY_DELAY_MS);
    }
  }
}

/**
 * Runs the command with inherited stdio and no shell. Returns its exit code;
 * death by signal maps to 128 + signal number, as shells report it.
 *
 * Without a terminal (cron, CI) the command gets its own process group and a
 * signal goes to the whole group: a `backup.sh` that started `pg_dump` must
 * not leave it running after a SIGTERM to us. In a terminal the group stays
 * shared — Ctrl+C already reaches every process, and a separate group could
 * not read the terminal.
 */
function runChild(
  file: string,
  args: string[],
  stdoutToStderr: boolean,
): Promise<number> {
  return new Promise((resolve) => {
    const ownGroup = process.platform !== 'win32' && !process.stdin.isTTY;
    const child = spawn(file, args, {
      stdio: stdoutToStderr ? ['inherit', 2, 'inherit'] : 'inherit',
      shell: false,
      detached: ownGroup,
    });
    const forwarded = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
    const forward = (signal: NodeJS.Signals) => {
      // In a shared group the terminal already delivers Ctrl+C and hangup to
      // the command; sending them again would turn one Ctrl+C into two and
      // cut short a command that cleans up on the first. The listener stays
      // anyway: without it Node exits at once and the ping is never sent.
      if (!ownGroup && signal !== 'SIGTERM') return;
      try {
        if (ownGroup && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // The group is already gone.
      }
    };
    for (const signal of forwarded) process.on(signal, forward);
    const cleanup = () => {
      for (const signal of forwarded) process.off(signal, forward);
    };

    let settled = false;
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      cleanup();
      printErr(t.runSpawnFailed(file, error.message));
      resolve(error.code === 'EACCES' ? 126 : 127);
    });
    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code !== null) resolve(code);
      else resolve(128 + (signal ? (constants.signals[signal] ?? 0) : 0));
    });
  });
}

function describe(error: unknown): string {
  if (error instanceof StatuserApiError) return error.format();
  if (error instanceof Error) return error.message;
  return String(error);
}
