import type { Command } from 'commander';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { StatuserClient } from '../client.js';
import { removeConfig, resolveApiUrl, saveConfig } from '../config.js';
import { authedClient, globalOptions } from '../context.js';
import { CliError, ExitCode } from '../errors.js';
import { t } from '../i18n.js';
import { printJson, printLine } from '../output.js';

interface Account {
  id: number;
  email: string;
}

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description(t.cmdLogin)
    .option('--with-token', t.optWithToken)
    .action(async (opts: { withToken?: boolean }, command: Command) => {
      const apiKey = (
        opts.withToken ? await readStdin() : await promptHidden(t.promptApiKey)
      ).trim();
      if (!apiKey) throw new CliError(t.loginEmptyKey, ExitCode.Usage);

      const global = globalOptions(command);
      const apiUrl = await resolveApiUrl(global.apiUrl);
      const client = new StatuserClient({
        apiUrl,
        apiKey,
        debug: global.debug,
      });
      // Checked before saving: a typo should not be stored as a working key.
      const account = await client.call<Account>({
        method: 'GET',
        path: '/v1/account',
      });
      const path = await saveConfig({ api_url: apiUrl, api_key: apiKey });
      if (global.json) printJson({ email: account.email, config: path });
      else printLine(t.loginSaved(account.email, path));
    });

  program
    .command('logout')
    .description(t.cmdLogout)
    .action(async (_opts: unknown, command: Command) => {
      const removed = await removeConfig();
      if (globalOptions(command).json) printJson({ removed });
      else printLine(removed ? t.logoutDone : t.logoutNothing);
    });

  program
    .command('whoami')
    .description(t.cmdWhoami)
    .action(async (_opts: unknown, command: Command) => {
      const { client, auth } = await authedClient(command);
      const account = await client.call<Account>({
        method: 'GET',
        path: '/v1/account',
      });
      if (globalOptions(command).json) {
        printJson(account);
        return;
      }
      const source =
        auth.source.kind === 'env'
          ? t.keySourceEnv
          : t.keySourceFile(auth.source.path);
      printLine(t.whoami(account.email, source));
    });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Prompts on the terminal without echoing the key. */
function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(new CliError(t.loginNoTty, ExitCode.Usage));
  }
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stderr.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}
