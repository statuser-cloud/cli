import { afterEach, describe, expect, it } from 'vitest';
import {
  runCli,
  startFakeApi,
  type FakeApi,
  type FakeResponse,
} from './helpers/fake-api.js';

const NODE = process.execPath;

let server: FakeApi | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function heartbeatApi(reply: FakeResponse = { status: 204 }) {
  server = await startFakeApi(() => reply);
  return server;
}

const run = (api: FakeApi, command: string[]) =>
  runCli(['run', '--heartbeat', 'tok', '--', ...command], {
    STATUSER_API_URL: api.url,
  });

describe('statuser run', { timeout: 30_000 }, () => {
  it('pings success when the command exits 0', async () => {
    const api = await heartbeatApi();
    const result = await run(api, [NODE, '-e', 'process.exit(0)']);
    expect(result.code).toBe(0);
    expect(api.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /v1/heartbeat/tok',
    ]);
    // No API key is needed or sent for heartbeat.
    expect(api.requests[0]?.headers.authorization).toBeUndefined();
  });

  it('reports failure and keeps the command exit code', async () => {
    const api = await heartbeatApi();
    const result = await run(api, [NODE, '-e', 'process.exit(3)']);
    expect(result.code).toBe(3);
    expect(api.requests.map((r) => r.path)).toEqual(['/v1/heartbeat/tok/fail']);
  });

  it('maps death by signal to 128 + signal number', async () => {
    const api = await heartbeatApi();
    const result = await run(api, [
      NODE,
      '-e',
      "process.kill(process.pid, 'SIGTERM')",
    ]);
    expect(result.code).toBe(143);
    expect(api.requests.map((r) => r.path)).toEqual(['/v1/heartbeat/tok/fail']);
  });

  it('returns 127 and reports failure for a missing command', async () => {
    const api = await heartbeatApi();
    const result = await run(api, ['/nonexistent/statuser-test-command']);
    expect(result.code).toBe(127);
    expect(api.requests.map((r) => r.path)).toEqual(['/v1/heartbeat/tok/fail']);
  });

  it('keeps a successful exit when the ping is rejected', async () => {
    const api = await heartbeatApi({ status: 404, body: { message: 'x' } });
    const result = await run(api, [NODE, '-e', 'process.exit(0)']);
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/not found/i);
    expect(api.requests).toHaveLength(1);
  });

  it('does not retry a 4xx ping', async () => {
    const api = await heartbeatApi({ status: 400, body: { message: 'bad' } });
    await run(api, [NODE, '-e', 'process.exit(0)']);
    expect(api.requests).toHaveLength(1);
  });

  it('retries a 5xx ping up to three attempts', async () => {
    const api = await heartbeatApi({ status: 503, body: { message: 'down' } });
    const result = await run(api, [NODE, '-e', 'process.exit(0)']);
    expect(result.code).toBe(0);
    expect(api.requests).toHaveLength(3);
  });

  it('fails before running when no token is given', async () => {
    const api = await heartbeatApi();
    const result = await runCli(
      [
        'run',
        '--',
        NODE,
        '-e',
        'require("fs").writeFileSync("/dev/stderr","ran")',
      ],
      { STATUSER_API_URL: api.url },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).not.toContain('ran');
    expect(api.requests).toHaveLength(0);
  });
});
