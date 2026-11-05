import type { Command } from 'commander';
import { StatuserClient } from './client.js';
import { resolveApiUrl, resolveAuth, type ResolvedAuth } from './config.js';

export interface GlobalOptions {
  json?: boolean;
  apiUrl?: string;
  debug?: boolean;
}

export function globalOptions(command: Command): GlobalOptions {
  return command.optsWithGlobals<GlobalOptions>();
}

/** Client with the API key: fails with exit code 3 when there is none. */
export async function authedClient(
  command: Command,
): Promise<{ client: StatuserClient; auth: ResolvedAuth }> {
  const opts = globalOptions(command);
  const auth = await resolveAuth(opts.apiUrl);
  return {
    client: new StatuserClient({
      apiUrl: auth.apiUrl,
      apiKey: auth.apiKey,
      debug: opts.debug,
    }),
    auth,
  };
}

/** Client without a key, for heartbeat pings that authenticate by token. */
export async function anonymousClient(
  command: Command,
): Promise<StatuserClient> {
  const opts = globalOptions(command);
  return new StatuserClient({
    apiUrl: await resolveApiUrl(opts.apiUrl),
    debug: opts.debug,
  });
}
