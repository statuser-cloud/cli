import { createRequire } from 'node:module';
import { CliError, ExitCode, parseApiErrorBody } from './errors.js';
import { t } from './i18n.js';

const require = createRequire(import.meta.url);
export const CLI_VERSION: string = (
  require('../package.json') as { version: string }
).version;

const USER_AGENT = `statuser-cli/${CLI_VERSION}`;
const MAX_429_RETRIES = 2;
const MAX_429_WAIT_SECONDS = 30;
const DEFAULT_TIMEOUT_MS = 60_000;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  method: HttpMethod;
  /** Path relative to the API address, starting with `/`. */
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Send without the API key (heartbeat pings authenticate by token in the path). */
  anonymous?: boolean;
  timeoutMs?: number;
}

export interface ClientOptions {
  apiUrl: string;
  apiKey?: string;
  debug?: boolean;
}

export class StatuserClient {
  constructor(private readonly options: ClientOptions) {}

  async call<T>(opts: RequestOptions): Promise<T> {
    return (await this.execute(opts)) as T;
  }

  private async execute(opts: RequestOptions): Promise<unknown> {
    const url = this.buildUrl(opts.path, opts.query);
    const headers: Record<string, string> = {
      'user-agent': USER_AGENT,
      accept: 'application/json',
    };
    if (!opts.anonymous) {
      if (!this.options.apiKey) throw new CliError(t.noApiKey, ExitCode.Auth);
      // A newline or space inside the key makes fetch throw an error that
      // quotes the whole header — the key would land in stderr and CI logs.
      if (!/^[\x21-\x7e]+$/.test(this.options.apiKey)) {
        throw new CliError(t.apiKeyMalformed, ExitCode.Auth);
      }
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }
    let body: string | undefined;
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['content-type'] = 'application/json';
    }

    for (let attempt = 0; ; attempt += 1) {
      this.debug(`→ ${opts.method} ${redactUrl(url)}`);
      let res: Response;
      try {
        res = await fetch(url, {
          method: opts.method,
          headers,
          body,
          // Never follow redirects: the key must not travel to another origin.
          redirect: 'manual',
          signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (error) {
        throw new CliError(t.networkError(describeFetchError(error)));
      }
      this.debug(`← ${res.status}`);

      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        const wait = parseRetryAfter(res.headers.get('retry-after'));
        if (wait !== null && wait <= MAX_429_WAIT_SECONDS) {
          await res.body?.cancel();
          await sleep(wait * 1000);
          continue;
        }
      }

      const text = await res.text();
      if (res.status >= 200 && res.status < 300) {
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
      throw parseApiErrorBody(res.status, text);
    }
  }

  private buildUrl(path: string, query: RequestOptions['query']): string {
    if (!path.startsWith('/')) {
      throw new CliError(t.apiPathInvalid, ExitCode.Usage);
    }
    const base = new URL(this.options.apiUrl);
    const url = new URL(`${this.options.apiUrl}${path}`);
    // `//evil.example` or encoded tricks in the path must not change the host.
    if (url.origin !== base.origin) {
      throw new CliError(t.foreignOrigin(url.toString()), ExitCode.Usage);
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.append(key, String(value));
    }
    return url.toString();
  }

  private debug(line: string): void {
    if (this.options.debug) process.stderr.write(`${line}\n`);
  }
}

/** Heartbeat tokens live in the path; they are credentials, so debug output hides them. */
export function redactUrl(url: string): string {
  return url.replace(/(\/heartbeat\/)[^/?#]+/, '$1***');
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'timeout';
    const cause = (error as { cause?: { code?: string; message?: string } })
      .cause;
    return cause?.code ?? cause?.message ?? error.message;
  }
  return String(error);
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
