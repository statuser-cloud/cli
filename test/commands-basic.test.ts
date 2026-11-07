import { afterEach, describe, expect, it } from 'vitest';
import {
  runCli,
  startFakeApi,
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

const plan = {
  features: {
    servers_limit: 50,
    heartbeat_monitoring_enabled: true,
    min_check_interval_seconds: 60,
    available_locations: ['msk-1', 'spb-1'],
  },
};

const existing = {
  id: 1,
  project_id: 100000,
  name: 'Shop',
  host: 'https://shop.example.com',
  protocol: 'http',
  status: 'online',
  http_method: 'head',
  body: null,
  headers: [],
  check_interval: 300,
  request_timeout: 30,
  locations: ['msk-1'],
};

/** An account with one server, two projects and a working plan. */
const account =
  (servers: unknown[] = [existing]): Handler =>
  (r) => {
    if (r.path === '/v1/billing/current-plan') return { body: plan };
    if (r.path === '/v1/projects') {
      return {
        body: [
          { id: 100500, name: 'B' },
          { id: 100000, name: 'A' },
        ],
      };
    }
    if (r.method === 'GET' && r.path === '/v1/servers')
      return { body: servers };
    if (r.method === 'POST' && r.path === '/v1/servers') {
      return { body: { id: 7, ...(r.body as object) } };
    }
    return { body: {} };
  };

describe('servers add', { timeout: 30_000 }, () => {
  it('creates an HTTP check from a URL in the oldest project', async () => {
    const result = await cli(account(), [
      'servers',
      'add',
      'https://api.example.com/health',
      '--name',
      'API',
    ]);
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual(['POST /v1/servers']);
    expect(server!.requests.at(-1)!.body).toMatchObject({
      protocol: 'http',
      host: 'https://api.example.com/health',
      name: 'API',
      project_id: 100000,
      http_method: 'head',
      check_interval: 300,
    });
  });

  it('takes an IP for a ping and works without a name', async () => {
    const result = await cli(account(), ['servers', 'add', '8.8.8.8']);
    expect(result.code).toBe(0);
    expect(server!.requests.at(-1)!.body).toMatchObject({
      protocol: 'ping',
      host: '8.8.8.8',
    });
    expect(server!.requests.at(-1)!.body).not.toHaveProperty('name');
  });

  it('asks for the protocol when the address does not tell it', async () => {
    const result = await cli(account(), ['servers', 'add', 'example.com']);
    expect(result.code).toBe(2);
    expect(writes(server!)).toEqual([]);
  });

  it('refuses a duplicate of a server in the account before writing', async () => {
    const result = await cli(account(), [
      'servers',
      'add',
      'https://shop.example.com',
      '--name',
      'Another',
    ]);
    expect(result.code).toBe(2);
    expect(writes(server!)).toEqual([]);
  });

  it('needs a name for a heartbeat and no address', async () => {
    const noName = await cli(account(), [
      'servers',
      'add',
      '--protocol',
      'heartbeat',
    ]);
    expect(noName.code).toBe(2);
    await server!.close();
    server = undefined;
    const created = await cli(account(), [
      'servers',
      'add',
      '--protocol',
      'heartbeat',
      '--name',
      'backup',
      '--interval',
      '86400',
    ]);
    expect(created.code).toBe(0);
    expect(server!.requests.at(-1)!.body).toMatchObject({
      protocol: 'heartbeat',
      name: 'backup',
      check_interval: 86400,
    });
  });

  it('writes nothing on --dry-run', async () => {
    const result = await cli(account(), [
      'servers',
      'add',
      'https://api.example.com',
      '--dry-run',
    ]);
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual([]);
  });
});

describe('servers delete', { timeout: 30_000 }, () => {
  it('refuses without --yes when there is no terminal', async () => {
    const result = await cli(account(), ['servers', 'delete', '1']);
    expect(result.code).toBe(2);
    expect(writes(server!)).toEqual([]);
  });

  it('deletes the given servers with --yes', async () => {
    const result = await cli(account(), [
      '--json',
      'servers',
      'delete',
      '1',
      '--yes',
    ]);
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual(['DELETE /v1/servers/1']);
    expect(JSON.parse(result.stdout).done).toEqual([1]);
  });
});

describe('servers update name and host', { timeout: 30_000 }, () => {
  it('changes the address of one server', async () => {
    const result = await cli(account(), [
      'servers',
      'update',
      '1',
      '--host',
      'https://new.example.com',
    ]);
    expect(result.code).toBe(0);
    expect(server!.requests.at(-1)!.body).toEqual({
      host: 'https://new.example.com',
    });
  });

  it('refuses a new address taken by another server', async () => {
    const result = await cli(
      account([
        existing,
        { ...existing, id: 2, host: 'https://b.example.com' },
      ]),
      ['servers', 'update', '1', '--host', 'https://b.example.com'],
    );
    expect(result.code).toBe(2);
    expect(writes(server!)).toEqual([]);
  });

  it('sets a name only on a single server', async () => {
    const result = await cli(
      account([
        existing,
        { ...existing, id: 2, host: 'https://b.example.com' },
      ]),
      ['servers', 'update', '--project', '100000', '--name', 'Same'],
    );
    expect(result.code).toBe(2);
    expect(writes(server!)).toEqual([]);
  });
});

describe('other basic commands', { timeout: 30_000 }, () => {
  it('servers test-notify sends a test alert', async () => {
    const result = await cli(account(), ['servers', 'test-notify', '1']);
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual(['POST /v1/servers/1/test-notify']);
  });

  it('incidents delete needs --yes and deletes each once', async () => {
    const result = await cli(account(), [
      'incidents',
      'delete',
      '5',
      '5',
      '6',
      '--yes',
    ]);
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual([
      'DELETE /v1/incidents/5',
      'DELETE /v1/incidents/6',
    ]);
  });

  it('incidents comment posts the text', async () => {
    const result = await cli(account(), [
      'incidents',
      'comment',
      '5',
      '-m',
      'Fix deployed',
    ]);
    expect(result.code).toBe(0);
    expect(server!.requests.at(-1)!.body).toEqual({
      comment_text: 'Fix deployed',
    });
  });

  it('projects list and pages list print tables', async () => {
    const projects = await cli(account(), ['projects', 'list']);
    expect(projects.stdout).toContain('100000');
    await server!.close();
    server = undefined;
    const pages = await cli(
      () => ({
        body: [
          {
            id: 12,
            name: 'Status',
            slug: 'shop',
            domains: [],
            is_published: true,
            project_id: 100000,
          },
        ],
      }),
      ['pages', 'list', '--json'],
    );
    expect(JSON.parse(pages.stdout)).toEqual([
      {
        id: 12,
        name: 'Status',
        slug: 'shop',
        domains: [],
        is_published: true,
        project_id: 100000,
      },
    ]);
  });
});

describe('review of basic commands', { timeout: 30_000 }, () => {
  it('deletes a repeated id once', async () => {
    const result = await cli(account(), [
      'servers',
      'delete',
      '1',
      '1',
      '--yes',
    ]);
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual(['DELETE /v1/servers/1']);
  });

  it('does not let a name like #1 hide a duplicate', async () => {
    const result = await cli(account(), [
      'servers',
      'add',
      'https://shop.example.com',
      '--name',
      '#1',
    ]);
    expect(result.code).toBe(2);
    expect(writes(server!)).toEqual([]);
  });
});

describe(
  'scenarios run, maintenance schedule, servers checks',
  { timeout: 30_000 },
  () => {
    const scenario = {
      ...existing,
      id: 9,
      protocol: 'scenario',
      request_timeout: 30,
    };

    it('runs a saved scenario and exits 4 when it fails', async () => {
      const result = await cli(
        (r) =>
          r.method === 'GET'
            ? { body: scenario }
            : { body: { status: 'failed', error: 'boom', failed_test: 't' } },
        ['scenarios', 'run', '9'],
      );
      expect(result.code).toBe(4);
      expect(writes(server!)).toEqual(['POST /v1/servers/9/scenario-run']);
    });

    it('refuses to run a server that is not a scenario', async () => {
      const result = await cli(
        () => ({ body: existing }),
        ['scenarios', 'run', '1'],
      );
      expect(result.code).toBe(2);
      expect(writes(server!)).toEqual([]);
    });

    it('schedules maintenance at a future time', async () => {
      const at = new Date(Date.now() + 86_400_000).toISOString();
      const result = await cli(
        (r) => ({
          body:
            r.method === 'POST'
              ? { id: 3, started_at: at, ended_at: at, title: 't', updates: [] }
              : {},
        }),
        [
          'maintenance',
          'schedule',
          '--page',
          '12',
          '--at',
          at,
          '--for',
          '2h',
          '--title',
          'DB',
          '--description',
          'Moving',
          '--servers',
          '5',
        ],
      );
      expect(result.code).toBe(0);
      const body = server!.requests.at(-1)!.body as Record<string, string>;
      expect(body.started_at).toBe(at);
      expect(Date.parse(body.ended_at) - Date.parse(at)).toBe(7_200_000);
    });

    it('refuses a start in the past', async () => {
      const result = await cli(
        () => ({ body: {} }),
        [
          'maintenance',
          'schedule',
          '--page',
          '12',
          '--at',
          '2020-01-01T00:00Z',
          '--title',
          'DB',
          '--description',
          'Moving',
          '--servers',
          '5',
        ],
      );
      expect(result.code).toBe(2);
      expect(server?.requests ?? []).toHaveLength(0);
    });

    it('deletes maintenance only with --yes outside a terminal', async () => {
      const handler: Handler = (r) => ({
        body: r.method === 'GET' ? [{ id: 3, title: 'DB' }] : {},
      });
      const refused = await cli(handler, [
        'maintenance',
        'delete',
        '3',
        '--page',
        '12',
      ]);
      expect(refused.code).toBe(2);
      expect(writes(server!)).toEqual([]);
      const done = await cli(handler, [
        'maintenance',
        'delete',
        '3',
        '--page',
        '12',
        '--yes',
      ]);
      expect(done.code).toBe(0);
      expect(writes(server!)).toEqual([
        'DELETE /v1/status-pages/12/planned-maintenances/3',
      ]);
    });

    it('servers checks prints status per location', async () => {
      const result = await cli(
        () => ({
          body: [
            {
              group_id: 'g',
              group_checked_at: '2026-11-07T10:00:00Z',
              locations: [
                {
                  location: 'msk-1',
                  status: 'online',
                  latency: 120,
                  checked_at: '',
                },
                {
                  location: 'spb-1',
                  status: 'offline',
                  latency: 0,
                  checked_at: '',
                },
              ],
            },
          ],
        }),
        ['servers', 'checks', '1', '--since', '7d'],
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('msk-1 120 ms, spb-1 offline');
      expect(server!.requests[0]!.path).toContain('startDate=');
    });
  },
);

describe('scenarios run secrets', { timeout: 30_000 }, () => {
  it('masks saved variables found in the environment and warns about the rest', async () => {
    server = await startFakeApi((r) =>
      r.method === 'GET'
        ? {
            body: {
              ...existing,
              id: 9,
              protocol: 'scenario',
              scenario_env_keys: ['SHOP_PASSWORD', 'OTHER'],
            },
          }
        : {
            body: {
              status: 'failed',
              error: 'expected hunter22-pw',
              console: [{ type: 'log', text: 'pw=hunter22-pw' }],
            },
          },
    );
    const result = await runCli(['--json', 'scenarios', 'run', '9'], {
      STATUSER_API_URL: server.url,
      STATUSER_API_KEY: 'k',
      SHOP_PASSWORD: 'hunter22-pw',
    });
    expect(result.stdout).not.toContain('hunter22');
    expect(result.stderr).toContain('OTHER');
  });
});

describe('free plan defaults', { timeout: 30_000 }, () => {
  it('creates with the locations of the plan, not the API default', async () => {
    const free = {
      features: {
        servers_limit: 5,
        min_check_interval_seconds: 300,
        available_locations: ['ala-1', 'ams-1'],
      },
    };
    const result = await cli(
      (r) => {
        if (r.path === '/v1/billing/current-plan') return { body: free };
        if (r.path === '/v1/projects') return { body: [{ id: 100000 }] };
        if (r.method === 'GET') return { body: [] };
        return { body: { id: 7 } };
      },
      ['servers', 'add', 'https://api.example.com'],
    );
    expect(result.code).toBe(0);
    expect(server!.requests.at(-1)!.body).toMatchObject({
      locations: ['ala-1', 'ams-1'],
      check_interval: 300,
    });
  });
});
