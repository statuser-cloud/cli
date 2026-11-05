import { readFileSync, statSync, writeFileSync } from 'node:fs';
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

const httpServer = (over: Record<string, unknown> = {}) => ({
  id: 1,
  project_id: 100000,
  name: 'Site',
  host: 'https://shop.example.com',
  protocol: 'http',
  status: 'online',
  http_method: 'head',
  body: null,
  headers: [],
  http_auth_type: 'none',
  is_follow_redirects: true,
  success_http_codes: ['2xx'],
  request_timeout: 30,
  check_interval: 300,
  incident_confirm_delay: 0,
  is_ssl_check: false,
  is_domain_check: false,
  is_blocklist_check: false,
  is_latency_alert_enabled: false,
  latency_trigger_ms: 1000,
  locations: ['msk-1'],
  ...over,
});

const plan = {
  features: {
    servers_limit: 50,
    min_check_interval_seconds: 60,
    available_locations: ['msk-1', 'spb-1'],
  },
};

describe('incidents', { timeout: 30_000 }, () => {
  it('lists ongoing incidents with server names', async () => {
    const result = await cli(
      (r) =>
        r.path.startsWith('/v1/incidents')
          ? {
              body: [
                {
                  id: 5,
                  server_id: 1,
                  started_at: new Date().toISOString(),
                  ended_at: null,
                  status: 'ongoing',
                  root_error: 'timeout',
                },
              ],
            }
          : { body: [httpServer()] },
      ['incidents', 'list', '--open'],
    );
    expect(result.code).toBe(0);
    expect(server!.requests[0]!.path).toBe('/v1/incidents?status=ongoing');
    expect(result.stdout).toContain('Site');
    expect(result.stdout).toContain('timeout');
  });

  it('saves the PDF readable by the owner and refuses to overwrite', async () => {
    const file = join(tempDir(), 'incident.pdf');
    const handler: Handler = () => ({
      raw: Buffer.from('%PDF-1.7'),
      headers: { 'content-type': 'application/pdf' },
    });
    const first = await cli(handler, ['incidents', 'pdf', '5', '-o', file]);
    expect(first.code).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe('%PDF-1.7');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const second = await cli(handler, ['incidents', 'pdf', '5', '-o', file]);
    expect(second.code).toBe(2);
  });

  it('does not save something that is not a PDF', async () => {
    const file = join(tempDir(), 'incident.pdf');
    const result = await cli(
      () => ({
        raw: Buffer.from('<html>'),
        headers: { 'content-type': 'text/html' },
      }),
      ['incidents', 'pdf', '5', '-o', file],
    );
    expect(result.code).toBe(1);
  });
});

describe('reports', { timeout: 30_000 }, () => {
  const report = (status: string) => ({
    id: 9,
    title: 'Outage',
    started_at: new Date().toISOString(),
    current_status: status,
    incidents: [],
    servers: [
      { id: 11, name: 'API', status: 'downtime' },
      { id: 12, name: 'Site', status: 'degraded' },
    ],
    updates: [],
  });

  it('resolves every server of the report, mapping id to server_id', async () => {
    const result = await cli(
      (r) => ({
        body: r.method === 'GET' ? [report('downtime')] : report('resolved'),
      }),
      ['reports', 'resolve', '9', '--page', '3', '--message', 'Fixed'],
    );
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual([
      'POST /v1/status-pages/3/incident-reports/9/updates',
    ]);
    expect(server!.requests.at(-1)!.body).toEqual({
      message: 'Fixed',
      servers: [
        { server_id: 11, status: 'resolved' },
        { server_id: 12, status: 'resolved' },
      ],
    });
  });

  it('does not message subscribers twice for a resolved report', async () => {
    const result = await cli(
      () => ({ body: [report('resolved')] }),
      ['reports', 'resolve', '9', '--page', '3', '--message', 'Fixed'],
    );
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual([]);
  });
});

describe('servers update', { timeout: 30_000 }, () => {
  const list = [
    httpServer(),
    httpServer({ id: 2, name: 'TCP', protocol: 'tcp' }),
    httpServer({ id: 3, name: 'Done', is_ssl_check: true }),
  ];

  it('patches only what changes and skips what does not apply', async () => {
    const result = await cli(
      (r) => ({ body: r.method === 'GET' ? list : {} }),
      ['servers', 'update', '--project', '100000', '--ssl', '--json'],
    );
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual(['PATCH /v1/servers/1']);
    expect(server!.requests.at(-1)!.body).toEqual({ is_ssl_check: true });
    expect(JSON.parse(result.stdout)).toMatchObject({
      done: [1],
      skipped: [2, 3],
    });
  });

  it('writes nothing on --dry-run', async () => {
    const result = await cli(
      () => ({ body: list }),
      ['servers', 'update', '1', '--interval', '120', '--dry-run'],
    );
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual([]);
    expect(result.stdout).toContain('#1: interval');
  });

  it('requires something to change', async () => {
    const result = await cli(
      () => ({ body: list }),
      ['servers', 'update', '1'],
    );
    expect(result.code).toBe(2);
  });
});

describe('export / diff / apply', { timeout: 30_000 }, () => {
  it('exports to a file readable by the owner, keeping scenarios on --force', async () => {
    const dir = tempDir();
    const file = join(dir, 'statuser.json');
    writeFileSync(
      file,
      JSON.stringify({
        project_id: 100000,
        scenarios: [{ name: 'A', file: 'a.spec.ts' }],
      }),
    );
    const result = await cli(
      () => ({
        body: [
          httpServer({
            headers: [{ key: 'Authorization', value: 'Bearer abc' }],
          }),
        ],
      }),
      ['export', '--project', '100000', '-o', file, '--force'],
    );
    expect(result.code).toBe(0);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const written = readFileSync(file, 'utf8');
    expect(written).not.toContain('Bearer abc');
    const parsed = JSON.parse(written);
    expect(parsed.scenarios).toHaveLength(1);
    expect(parsed.servers[0]).toMatchObject({ id: 1, protocol: 'http' });
  });

  function configFile(servers: unknown[]) {
    const file = join(tempDir(), 'statuser.json');
    writeFileSync(file, JSON.stringify({ project_id: 100000, servers }));
    return file;
  }

  const api: Handler = (r) => {
    if (r.path === '/v1/billing/current-plan') return { body: plan };
    if (r.method === 'GET') return { body: [httpServer()] };
    return { body: { id: 77 } };
  };

  it('diff changes nothing', async () => {
    const file = configFile([
      {
        id: 1,
        name: 'Site',
        protocol: 'http',
        host: 'https://shop.example.com',
        check_interval: 120,
      },
      { name: 'Ping', protocol: 'ping', host: '1.1.1.1' },
    ]);
    const result = await cli(api, ['diff', '-c', file]);
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual([]);
    expect(result.stdout).toContain('check_interval');
  });

  it('apply updates first, then creates', async () => {
    const file = configFile([
      { name: 'Ping', protocol: 'ping', host: '1.1.1.1' },
      {
        id: 1,
        name: 'Site',
        protocol: 'http',
        host: 'https://shop.example.com',
        check_interval: 120,
      },
    ]);
    const result = await cli(api, ['apply', '-c', file]);
    expect(result.code).toBe(0);
    expect(writes(server!)).toEqual([
      'PATCH /v1/servers/1',
      'POST /v1/servers',
    ]);
    expect(server!.requests.find((r) => r.method === 'PATCH')!.body).toEqual({
      check_interval: 120,
    });
  });

  it('refuses a protocol change before any write', async () => {
    const file = configFile([
      { id: 1, name: 'Site', protocol: 'ping', host: 'x' },
    ]);
    const result = await cli(api, ['apply', '-c', file]);
    expect(result.code).toBe(2);
    expect(writes(server!)).toEqual([]);
  });

  it('stops at the first failed write', async () => {
    const file = configFile([
      { name: 'A', protocol: 'ping', host: '1.1.1.1' },
      { name: 'B', protocol: 'ping', host: '2.2.2.2' },
    ]);
    const result = await cli(
      (r) =>
        r.method === 'POST'
          ? { status: 400, body: { message: 'bad' } }
          : api(r),
      ['apply', '-c', file],
    );
    expect(result.code).toBe(1);
    expect(writes(server!)).toEqual(['POST /v1/servers']);
  });
});
