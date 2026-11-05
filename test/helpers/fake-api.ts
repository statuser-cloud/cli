import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler = (
  request: RecordedRequest,
) => FakeResponse | Promise<FakeResponse>;

export interface FakeApi {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

/** A local HTTP server standing in for the Statuser API; records every request. */
export async function startFakeApi(handler: Handler): Promise<FakeApi> {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const recorded: RecordedRequest = {
      method: req.method ?? '',
      path: req.url ?? '',
      headers: req.headers,
      body: raw ? JSON.parse(raw) : undefined,
    };
    requests.push(recorded);
    const reply = await handler(recorded);
    const status = reply.status ?? 200;
    res.writeHead(status, {
      'content-type': 'application/json',
      ...reply.headers,
    });
    res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const TSX = join(process.cwd(), 'node_modules', '.bin', 'tsx');
const ENTRY = join(process.cwd(), 'src', 'index.ts');

/**
 * Runs the CLI from source in a child process with an isolated config
 * directory and English messages, the way a CI job would.
 */
export function runCli(
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(TSX, [ENTRY, ...args], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: 'en_US.UTF-8',
        XDG_CONFIG_HOME: tempDir(),
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdin.end();
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'statuser-cli-test-'));
}
