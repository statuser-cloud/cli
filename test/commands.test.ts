import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runCli,
  startFakeApi,
  tempDir,
  type FakeApi,
  type Handler,
} from './helpers/fake-api.js';

let server: FakeApi | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function cli(handler: Handler, args: string[]) {
  server ??= await startFakeApi(handler);
  return runCli(args, {
    STATUSER_API_URL: server.url,
    STATUSER_API_KEY: 'test-key',
  });
}

const writes = (api: FakeApi) =>
  api.requests
    .filter((r) => r.method !== 'GET')
    .map((r) => `${r.method} ${r.path}`);

describe('servers pause / resume', { timeout: 30_000 }, () => {
  it('pauses only running servers and resumes only those', async () => {
    const dir = tempDir();
    const paused = join(dir, 'paused.json');

    const pause = await cli(
      (r) =>
        r.method === 'GET'
          ? {
              body: [
                { id: 1, status: 'online' },
                { id: 2, status: 'paused' },
              ],
            }
          : { body: {} },
      ['servers', 'pause', '--project', '100000', '--json'],
    );
    expect(pause.code).toBe(0);
    expect(server!.requests[0]?.path).toBe('/v1/servers?project_id=100000');
    expect(writes(server!)).toEqual(['PATCH /v1/servers/1/pause']);
    const result = JSON.parse(pause.stdout);
    expect(result).toMatchObject({ done: [1], skipped: [2], failed: [] });
    writeFileSync(paused, pause.stdout);
    await server!.close();
    server = undefined;

    const resume = await cli(
      (r) =>
        r.method === 'GET'
          ? {
              body: [
                { id: 1, status: 'paused' },
                { id: 2, status: 'paused' },
              ],
            }
          : { body: {} },
      ['servers', 'resume', '--from', paused],
    );
    expect(resume.code).toBe(0);
    expect(writes(server!)).toEqual(['PATCH /v1/servers/1/unpause']);
  });

  it('exits with the auth code when the key stops working mid-way', async () => {
    const result = await cli(
      (r) =>
        r.method === 'GET'
          ? {
              body: [
                { id: 1, status: 'online' },
                { id: 2, status: 'online' },
              ],
            }
          : { status: 401, body: { message: 'Unauthorized' } },
      ['servers', 'pause', '--project', '100000'],
    );
    expect(result.code).toBe(3);
    expect(writes(server!)).toHaveLength(1);
  });

  it('requires ids or a project', async () => {
    const result = await cli(() => ({ body: [] }), ['servers', 'pause']);
    expect(result.code).toBe(2);
  });
});

describe('maintenance end', { timeout: 30_000 }, () => {
  const maintenance = (endedAt: Date) => ({
    id: 7,
    title: 't',
    description: 'd',
    started_at: new Date(Date.now() - 3_600_000).toISOString(),
    ended_at: endedAt.toISOString(),
    servers: [],
    updates: [],
    created_at: new Date().toISOString(),
  });

  it('moves a future end to now', async () => {
    const item = maintenance(new Date(Date.now() + 3_600_000));
    const result = await cli(
      (r) => ({ body: r.method === 'GET' ? [item] : item }),
      ['maintenance', 'end', '7', '--page', '12'],
    );
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual([
      'PATCH /v1/status-pages/12/planned-maintenances/7',
    ]);
  });

  it('does not move an end that has already passed', async () => {
    const item = maintenance(new Date(Date.now() - 60_000));
    const result = await cli(
      () => ({ body: [item] }),
      ['maintenance', 'end', '7', '--page', '12'],
    );
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual([]);
  });

  it('posts the timeline message when asked', async () => {
    const item = maintenance(new Date(Date.now() - 60_000));
    await cli(
      (r) => ({ body: r.method === 'GET' ? [item] : {} }),
      ['maintenance', 'end', '7', '--page', '12', '--message', 'Done'],
    );
    expect(writes(server!)).toEqual([
      'POST /v1/status-pages/12/planned-maintenances/7/updates',
    ]);
    expect(server!.requests.at(-1)?.body).toEqual({ message: 'Done' });
  });

  it('does not post the same message twice on a retried step', async () => {
    const item = {
      ...maintenance(new Date(Date.now() - 60_000)),
      updates: [{ id: 1, message: 'Done' }],
    };
    const result = await cli(
      () => ({ body: [item] }),
      ['maintenance', 'end', '7', '--page', '12', '--message', ' Done '],
    );
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual([]);
  });
});

const currentPlan = {
  features: {
    servers_limit: 50,
    scenarios_limit: 10,
    scenario_min_check_interval_seconds: 60,
    scenario_max_timeout_seconds: 120,
  },
};
const withPlan =
  (handler: Handler): Handler =>
  (r) =>
    r.path === '/v1/billing/current-plan' ? { body: currentPlan } : handler(r);

describe('scenarios deploy', { timeout: 30_000 }, () => {
  function project() {
    const dir = tempDir();
    mkdirSync(join(dir, 'checks'));
    writeFileSync(join(dir, 'checks', 'a.spec.ts'), 'test("a", () => {})');
    writeFileSync(join(dir, 'checks', 'b.spec.ts'), 'test("b", () => {})');
    const config = join(dir, 'statuser.json');
    writeFileSync(
      config,
      JSON.stringify({
        project_id: 100000,
        scenarios: [
          { name: 'A', file: 'checks/a.spec.ts' },
          { name: 'B', file: 'checks/b.spec.ts' },
        ],
      }),
    );
    return config;
  }

  it('changes nothing on --dry-run', async () => {
    const result = await cli(
      withPlan(() => ({ body: [] })),
      ['scenarios', 'deploy', '-c', project(), '--dry-run'],
    );
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual([]);
    expect(result.stdout).toContain('create');
  });

  it('stops at the first failed write', async () => {
    const result = await cli(
      withPlan((r) =>
        r.method === 'GET'
          ? { body: [] }
          : { status: 400, body: { message: 'bad', error_code: 'x' } },
      ),
      ['scenarios', 'deploy', '-c', project()],
    );
    expect(result.code).toBe(1);
    expect(writes(server!)).toEqual(['POST /v1/servers']);
    expect(result.stderr).toContain('“A”');
  });

  it('fails on a missing CI variable before any request', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.spec.ts'), 'test("a", () => {})');
    const config = join(dir, 'statuser.json');
    writeFileSync(
      config,
      JSON.stringify({
        project_id: 100000,
        scenarios: [
          { name: 'A', file: 'a.spec.ts', env: { PASS: '$NOT_SET_IN_CI' } },
        ],
      }),
    );
    const result = await cli(
      () => ({ body: [] }),
      ['scenarios', 'deploy', '-c', config],
    );
    expect(result.code).toBe(2);
    expect(server!.requests).toHaveLength(0);
  });
});

describe('auth', { timeout: 30_000 }, () => {
  it('exits 3 when the API rejects the key', async () => {
    const result = await cli(
      () => ({ status: 401, body: { message: 'Unauthorized' } }),
      ['whoami'],
    );
    expect(result.code).toBe(3);
  });
});
