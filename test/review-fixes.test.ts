import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { redactReplay } from '../src/commands/incidents.js';
import { maskSecrets } from '../src/commands/scenarios.js';
import { localizeError } from '../src/commander-i18n.js';
import { loadScenarioConfig } from '../src/scenarios/config.js';
import { CliError } from '../src/errors.js';
import { parseServersSection } from '../src/servers-config/parse.js';
import { checkScenarioLimits } from '../src/servers-config/plan.js';
import { bulkTargetProblem, planServerPatch } from '../src/servers-update.js';
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

const fail = (problem: string): never => {
  throw new CliError(problem);
};

const plan = {
  features: {
    servers_limit: 50,
    scenarios_limit: 1,
    scenario_min_check_interval_seconds: 60,
    scenario_max_timeout_seconds: 120,
    min_check_interval_seconds: 60,
    available_locations: ['msk-1'],
  },
};

describe('secrets in output', { timeout: 30_000 }, () => {
  it('hides the heartbeat token and secret headers in servers get', async () => {
    const result = await cli(
      () => ({
        body: {
          id: 1,
          protocol: 'heartbeat',
          heartbeat_token: 'live-token-123',
          headers: [{ key: 'Authorization', value: 'Bearer abc' }],
        },
      }),
      ['servers', 'get', '1'],
    );
    expect(result.stdout).not.toContain('live-token-123');
    expect(result.stdout).not.toContain('Bearer abc');
  });

  it('masks values passed to a scenario run', () => {
    const masked = maskSecrets(
      {
        error: 'expected "hunter22" to be "x"',
        console: [{ text: 'hunter22' }],
      },
      ['hunter22', 'ab'],
    );
    expect(JSON.stringify(masked)).not.toContain('hunter22');
  });
});

describe('scenarios deploy limits', { timeout: 30_000 }, () => {
  it('stops before writing when the plan has no room for all scenarios', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.spec.ts'), 'test("a", async () => {})');
    writeFileSync(join(dir, 'b.spec.ts'), 'test("b", async () => {})');
    const config = join(dir, 'statuser.json');
    writeFileSync(
      config,
      JSON.stringify({
        project_id: 100000,
        scenarios: [
          { name: 'A', file: 'a.spec.ts' },
          { name: 'B', file: 'b.spec.ts' },
        ],
      }),
    );
    const result = await cli(
      (r) =>
        r.path === '/v1/billing/current-plan' ? { body: plan } : { body: [] },
      ['scenarios', 'deploy', '-c', config],
    );
    expect(result.code).toBe(2);
    expect(writes(server!)).toEqual([]);
  });

  it('rejects a script without test() before any write', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.spec.ts'), 'export const value = 1;');
    const config = join(dir, 'statuser.json');
    writeFileSync(
      config,
      JSON.stringify({
        project_id: 100000,
        scenarios: [{ name: 'A', file: 'a.spec.ts' }],
      }),
    );
    await expect(loadScenarioConfig(config)).rejects.toThrow(/test/);
  });

  it('accepts an empty scenarios section where it is optional', async () => {
    const config = join(tempDir(), 'statuser.json');
    writeFileSync(
      config,
      JSON.stringify({ project_id: 100000, scenarios: [] }),
    );
    await expect(
      loadScenarioConfig(config, {}, { required: false }),
    ).resolves.toMatchObject({ scenarios: [] });
  });
});

describe('apply and export safety', { timeout: 30_000 }, () => {
  it('prints one JSON report with what was applied before a failure', async () => {
    const config = join(tempDir(), 'statuser.json');
    writeFileSync(
      config,
      JSON.stringify({
        project_id: 100000,
        servers: [
          { name: 'A', protocol: 'ping', host: '1.1.1.1' },
          { name: 'B', protocol: 'ping', host: '2.2.2.2' },
        ],
      }),
    );
    let posts = 0;
    const result = await runCliWith(
      (r) => {
        if (r.path === '/v1/billing/current-plan') return { body: plan };
        if (r.method === 'GET') return { body: [] };
        posts += 1;
        return posts === 1
          ? { body: { id: 7 } }
          : { status: 500, body: { message: 'boom' } };
      },
      ['apply', '-c', config, '--json'],
    );
    expect(result.code).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.applied).toEqual([{ name: 'A', action: 'create', id: 7 }]);
    expect(report.error.name).toBe('B');
  });

  it('export -o --json reports the written file', async () => {
    const file = join(tempDir(), 'out.json');
    const result = await cli(
      () => ({
        body: [{ id: 1, name: 'A', protocol: 'ping', host: '1.1.1.1' }],
      }),
      ['export', '--project', '100000', '-o', file, '--json'],
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ file, servers: 1 });
  });

  it('does not overwrite a broken statuser.json on export --force', async () => {
    const file = join(tempDir(), 'statuser.json');
    writeFileSync(file, '{ "project_id": 100000, "scenarios": [], }');
    const result = await cli(
      () => ({ body: [] }),
      ['export', '--project', '100000', '-o', file, '--force'],
    );
    expect(result.code).toBe(2);
  });
});

async function runCliWith(handler: Handler, args: string[]) {
  return cli(handler, args);
}

describe('other contracts', { timeout: 30_000 }, () => {
  it('api --input with broken JSON is a usage error', async () => {
    const file = join(tempDir(), 'body.json');
    writeFileSync(file, '{');
    const result = await cli(
      () => ({ body: {} }),
      ['api', '/v1/servers', '-X', 'POST', '--input', file],
    );
    expect(result.code).toBe(2);
    expect(server!.requests).toHaveLength(0);
  });

  it('api --json prints text answers as a JSON string', async () => {
    const result = await cli(
      () => ({
        raw: Buffer.from('a,b\n1,2'),
        headers: { 'content-type': 'text/csv' },
      }),
      ['api', '/v1/incidents/export', '--json'],
    );
    expect(JSON.parse(result.stdout)).toBe('a,b\n1,2');
  });

  it('logout --json prints JSON', async () => {
    const result = await runCli(['logout', '--json']);
    expect(JSON.parse(result.stdout)).toEqual({ removed: false });
  });

  it('maintenance end checks the message before closing the window', async () => {
    const result = await cli(
      () => ({ body: [] }),
      ['maintenance', 'end', '7', '--page', '12', '--message', '   '],
    );
    expect(result.code).toBe(2);
    expect(server!.requests).toHaveLength(0);
  });
});

describe('servers update targets', () => {
  const base = {
    id: 2,
    protocol: 'scenario',
    check_interval: 300,
    request_timeout: 30,
    locations: ['msk-1'],
  } as never;

  it('refuses a timeout a scenario cannot take', () => {
    const planned = planServerPatch(base, { timeout: 20 });
    expect(bulkTargetProblem(base, planned)).toMatch(/timeout/);
  });

  it('lets a valid scenario timeout through', () => {
    const planned = planServerPatch(base, { timeout: 60 });
    expect(bulkTargetProblem(base, planned)).toBeNull();
  });
});

describe('servers section checks', () => {
  const parse = (entries: unknown[]) => parseServersSection(entries, {}, fail);

  it('rejects a header name the backend would drop', () => {
    expect(() =>
      parse([
        {
          name: 'A',
          protocol: 'http',
          host: 'https://a.example.com',
          headers: [{ key: 'X Api Key', value: 'v' }],
        },
      ]),
    ).toThrow(/X Api Key/);
  });

  it('accepts an empty Basic password and a long heartbeat grace', () => {
    const [http] = parse([
      {
        name: 'A',
        protocol: 'http',
        host: 'https://a.example.com',
        http_auth_type: 'basic',
        http_auth_username: 'u',
        http_auth_password: '',
      },
    ]);
    expect(http!.secrets.http_auth_password).toBe('');
    expect(() =>
      parse([
        { name: 'H', protocol: 'heartbeat', heartbeat_grace_interval: 7200 },
      ]),
    ).not.toThrow();
  });

  it('rejects a description longer than the API allows', () => {
    expect(() =>
      parse([
        {
          name: 'A',
          protocol: 'ping',
          host: 'x.example.com',
          description: 'a'.repeat(501),
        },
      ]),
    ).toThrow(/description/);
  });
});

describe('commander errors in Russian', () => {
  it('rewrites known parse errors', () => {
    expect(localizeError("error: unknown option '--x'")).toMatch(/--x/);
  });
});

describe('third review round', () => {
  it('masks a secret printed inside JSON', () => {
    const secret = 'ab"cd\\ef';
    const masked = maskSecrets(
      { error: null, console: [{ text: JSON.stringify({ p: secret }) }] },
      [secret],
    );
    expect(masked.console![0]!.text).toBe('{"p":"***"}');
  });

  it('lets a scenario be renamed on a plan without scenarios', () => {
    expect(() =>
      checkScenarioLimits(
        [
          {
            kind: 'update',
            fields: ['name'],
            scenario: { name: 'S', interval: 30, timeout: 600 },
          },
        ],
        1,
        { ...plan.features, scenarios_limit: 0 } as never,
      ),
    ).not.toThrow();
  });

  it('maintenance end --json shows the posted message', async () => {
    const item = {
      id: 7,
      started_at: new Date(Date.now() - 3_600_000).toISOString(),
      ended_at: new Date(Date.now() - 60_000).toISOString(),
      updates: [],
    };
    const result = await cli(
      (r) => ({
        body:
          r.method === 'GET'
            ? [item]
            : { ...item, updates: [{ id: 1, message: 'Done' }] },
      }),
      [
        'maintenance',
        'end',
        '7',
        '--page',
        '12',
        '--message',
        'Done',
        '--json',
      ],
    );
    expect(JSON.parse(result.stdout).updates).toEqual([
      { id: 1, message: 'Done' },
    ]);
  });
});

describe('fifth review round', () => {
  it('hides secret response headers in incidents get --json', async () => {
    const result = await cli(
      () => ({
        body: {
          id: 5,
          details: [
            { headers: { 'set-cookie': 'session=abc', server: 'nginx' } },
          ],
        },
      }),
      ['incidents', 'get', '5', '--json'],
    );
    expect(result.stdout).not.toContain('session=abc');
    expect(JSON.parse(result.stdout).details[0].headers.server).toBe('nginx');
  });
});

describe('sixth review round', () => {
  it('masks secret headers in the replay command', () => {
    const replay =
      "curl -X GET -H 'X-Auth:s3cr3t' -H Accept:text/html -H 'Authorization:Bearer abc' -H 'X-Note:it'\\''s' https://a.example.com/";
    const masked = redactReplay(replay);
    expect(masked).not.toContain('s3cr3t');
    expect(masked).not.toContain('abc');
    expect(masked).toContain("-H 'Authorization: Bearer ***'");
    expect(masked).toContain('-H Accept:text/html');
    expect(masked).toContain("-H 'X-Note:it'\\''s'");
  });

  it('reports a 5xx on apply as an unknown outcome', async () => {
    const config = join(tempDir(), 'statuser.json');
    writeFileSync(
      config,
      JSON.stringify({
        project_id: 100000,
        servers: [{ name: 'A', protocol: 'ping', host: '1.1.1.1' }],
      }),
    );
    const result = await cli(
      (r) => {
        if (r.path === '/v1/billing/current-plan') return { body: plan };
        if (r.method === 'GET') return { body: [] };
        return { status: 500, body: { message: 'boom' } };
      },
      ['apply', '-c', config, '--json'],
    );
    expect(JSON.parse(result.stdout).error.outcome_unknown).toBe(true);
  });

  it('updates a heartbeat by id without repeating its name', () => {
    expect(() =>
      parseServersSection(
        [{ id: 5, protocol: 'heartbeat', check_interval: 86400 }],
        {},
        fail,
      ),
    ).not.toThrow();
  });
});
