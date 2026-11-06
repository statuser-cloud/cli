import { describe, expect, it } from 'vitest';
import type { Server } from '../src/commands/servers.js';
import { CliError } from '../src/errors.js';
import { exportServers } from '../src/servers-config/export.js';
import { parseServersSection } from '../src/servers-config/parse.js';
import { buildServersPlan } from '../src/servers-config/plan.js';
import { planServerPatch } from '../src/servers-update.js';

const server = (over: Partial<Server> = {}): Server =>
  ({
    id: 1,
    project_id: 100000,
    name: 'Site',
    host: 'https://shop.example.com',
    protocol: 'http',
    status: 'online',
    heartbeat_token: null,
    port: null,
    http_method: 'head',
    body: null,
    keyword: null,
    keyword_mode: null,
    headers: [],
    http_auth_type: 'none',
    http_auth_username: null,
    http_auth_secret_masked: null,
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
    dns_record_types: null,
    llm_provider: null,
    llm_model: null,
    llm_api_key_masked: null,
    scenario_script: null,
    scenario_env_keys: null,
    description: null,
    ...over,
  }) as unknown as Server;

const features = {
  servers_limit: 50,
  min_check_interval_seconds: 60,
  available_locations: ['msk-1', 'spb-1', 'ams-1'],
} as never;

const fail = (problem: string): never => {
  throw new CliError(problem);
};

const parse = (entries: unknown[], env: NodeJS.ProcessEnv = {}) =>
  parseServersSection(entries, env, fail);

describe('planServerPatch', () => {
  it('sends only what changes', () => {
    const plan = planServerPatch(server(), { interval: 300, ssl: true });
    expect(plan.body).toEqual({ is_ssl_check: true });
    expect(plan.fields).toEqual(['ssl']);
  });

  it('reports fields the protocol does not use instead of sending them', () => {
    const plan = planServerPatch(server({ protocol: 'tcp' }), {
      ssl: true,
      interval: 120,
    });
    expect(plan.body).toEqual({ check_interval: 120 });
    expect(plan.notApplicable).toEqual(['ssl']);
  });

  it('keeps scenarios at exactly one location', () => {
    const plan = planServerPatch(server({ protocol: 'scenario' }), {
      regions: ['msk-1', 'spb-1'],
    });
    expect(plan.body).toEqual({});
    expect(plan.notApplicable).toEqual(['regions']);
  });

  it('compares regions as a set', () => {
    const plan = planServerPatch(server({ locations: ['spb-1', 'msk-1'] }), {
      regions: ['msk-1', 'spb-1'],
    });
    expect(plan.fields).toEqual([]);
  });

  it('turns the latency alert on with its threshold', () => {
    const plan = planServerPatch(server(), { latency: 800 });
    expect(plan.body).toEqual({
      is_latency_alert_enabled: true,
      latency_trigger_ms: 800,
    });
  });
});

describe('exportServers', () => {
  it('writes only fields the protocol uses', () => {
    const { entries } = exportServers([
      server({ protocol: 'ping', port: 443, http_method: 'get' }),
    ]);
    expect(entries[0]).not.toHaveProperty('port');
    expect(entries[0]).not.toHaveProperty('http_method');
    expect(entries[0]).toMatchObject({ id: 1, protocol: 'ping' });
  });

  it('never exports the heartbeat token', () => {
    const { entries } = exportServers([
      server({ protocol: 'heartbeat', heartbeat_token: 'secret-token' }),
    ]);
    expect(JSON.stringify(entries)).not.toContain('secret-token');
    expect(entries[0]).not.toHaveProperty('host');
  });

  it('replaces secret header values with per-server variables', () => {
    const result = exportServers([
      server({
        headers: [
          { key: 'Authorization', value: 'Bearer abc' },
          { key: 'X-Env', value: '$literal' },
        ] as never,
      }),
    ]);
    const headers = result.entries[0]!.headers as Array<{ value: string }>;
    expect(headers[0]!.value).toBe('$STATUSER_1_0_AUTHORIZATION');
    expect(headers[1]!.value).toBe('$$literal');
    expect(JSON.stringify(result.entries)).not.toContain('Bearer abc');
  });

  it('skips scenarios and counts paused servers', () => {
    const result = exportServers([
      server({ id: 1, status: 'paused' }),
      server({ id: 2, protocol: 'scenario' }),
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.pausedCount).toBe(1);
    expect(result.scenarioCount).toBe(1);
  });
});

describe('parseServersSection', () => {
  it('rejects a field the protocol does not use', () => {
    expect(() =>
      parse([{ name: 'A', protocol: 'ping', host: 'x.example.com', port: 80 }]),
    ).toThrow(/port/);
  });

  it('rejects an empty location list', () => {
    expect(() =>
      parse([
        { name: 'A', protocol: 'ping', host: 'x.example.com', locations: [] },
      ]),
    ).toThrow(/locations/);
  });

  it('resolves header and secret variables, keeping $$ literal', () => {
    const [entry] = parse(
      [
        {
          name: 'A',
          protocol: 'http',
          host: 'https://a.example.com',
          http_auth_type: 'bearer',
          http_auth_token: '$TOKEN',
          headers: [{ key: 'X', value: '$$raw' }],
        },
      ],
      { TOKEN: 't0k' },
    );
    expect(entry!.secrets).toEqual({ http_auth_token: 't0k' });
    expect(entry!.fields.headers).toEqual([{ key: 'X', value: '$raw' }]);
  });
});

describe('buildServersPlan', () => {
  it('leaves an identical server alone and lists unmanaged ones', () => {
    const desired = parse([
      {
        id: 1,
        name: 'Site',
        protocol: 'http',
        host: 'https://shop.example.com',
      },
    ]);
    const plan = buildServersPlan(
      desired,
      100000,
      [
        server(),
        server({ id: 2, name: 'Other', host: 'https://b.example.com' }),
      ],
      features,
    );
    expect(plan.steps[0]!.kind).toBe('unchanged');
    expect(plan.unmanaged).toEqual([{ id: 2, name: 'Other' }]);
  });

  it('treats an empty body and null as equal', () => {
    const desired = parse([
      {
        id: 1,
        name: 'Site',
        protocol: 'http',
        host: 'https://shop.example.com',
        body: '',
      },
    ]);
    const plan = buildServersPlan(
      desired,
      100000,
      [server({ body: null })],
      features,
    );
    expect(plan.steps[0]!.kind).toBe('unchanged');
  });

  it('refuses to change the protocol', () => {
    const desired = parse([
      { id: 1, name: 'Site', protocol: 'ping', host: 'x.example.com' },
    ]);
    expect(() =>
      buildServersPlan(desired, 100000, [server()], features),
    ).toThrow(CliError);
  });

  it('refuses a duplicate of a server elsewhere in the account', () => {
    const desired = parse([
      {
        name: 'Copy',
        protocol: 'http',
        host: 'https://shop.example.com',
        http_method: 'head',
      },
    ]);
    expect(() =>
      buildServersPlan(
        desired,
        100000,
        [server({ project_id: 200000 })],
        features,
      ),
    ).toThrow(CliError);
  });

  it('builds a create with the fields the API requires', () => {
    const desired = parse([
      { name: 'Ping', protocol: 'ping', host: '1.1.1.1' },
    ]);
    const plan = buildServersPlan(desired, 100000, [], features);
    const step = plan.steps[0]!;
    if (step.kind !== 'create') throw new Error('expected create');
    expect(step.body).toMatchObject({
      project_id: 100000,
      protocol: 'ping',
      host: '1.1.1.1',
      is_follow_redirects: false,
      request_timeout: 30,
      check_interval: 300,
      is_ssl_check: false,
      is_domain_check: false,
    });
  });

  it('requires the password to create basic auth', () => {
    const desired = parse([
      {
        name: 'A',
        protocol: 'http',
        host: 'https://a.example.com',
        http_auth_type: 'basic',
        http_auth_username: 'u',
      },
    ]);
    expect(() => buildServersPlan(desired, 100000, [], features)).toThrow(
      /http_auth_password/,
    );
  });

  it('checks plan limits before any write', () => {
    const desired = parse([
      { name: 'Slow', protocol: 'ping', host: '1.1.1.1', check_interval: 90 },
    ]);
    expect(() =>
      buildServersPlan(desired, 100000, [], {
        ...(features as object),
        min_check_interval_seconds: 120,
      } as never),
    ).toThrow(/120/);
    const tooMany = parse([{ name: 'B', protocol: 'ping', host: '2.2.2.2' }]);
    expect(() =>
      buildServersPlan(tooMany, 100000, [], {
        ...(features as object),
        servers_limit: 0,
      } as never),
    ).toThrow(CliError);
  });

  it('rejects values outside the API range while parsing', () => {
    expect(() =>
      parse([
        {
          name: 'A',
          protocol: 'ping',
          host: 'x.example.com',
          request_timeout: 0,
        },
      ]),
    ).toThrow(/request_timeout/);
  });

  it('refuses names that would make the next run ambiguous', () => {
    const desired = parse([
      { name: 'Same', protocol: 'ping', host: '1.1.1.1' },
      { name: 'Same', protocol: 'ping', host: '2.2.2.2' },
    ]).slice(0, 2);
    expect(() => buildServersPlan(desired, 100000, [], features)).toThrow(
      CliError,
    );
  });

  it('requires a username for basic auth on update', () => {
    const desired = parse([
      {
        id: 1,
        name: 'Site',
        protocol: 'http',
        host: 'https://shop.example.com',
        http_auth_type: 'basic',
        http_auth_password: 'p',
      },
    ]);
    expect(() =>
      buildServersPlan(desired, 100000, [server()], features),
    ).toThrow(/http_auth_username/);
  });

  it('lets an existing duplicate be edited without changing identity', () => {
    const desired = parse([
      {
        id: 1,
        name: 'Site',
        protocol: 'http',
        host: 'https://shop.example.com',
        check_interval: 120,
      },
    ]);
    const plan = buildServersPlan(
      desired,
      100000,
      [server(), server({ id: 2, name: 'Twin' })],
      features,
    );
    expect(plan.steps[0]!.kind).toBe('update');
  });

  it('fails on a pinned id that is gone instead of creating a copy', () => {
    const desired = parse([
      { id: 99, name: 'Gone', protocol: 'ping', host: 'x.example.com' },
    ]);
    expect(() => buildServersPlan(desired, 100000, [], features)).toThrow(
      CliError,
    );
  });
});

describe('buildServersPlan after review', () => {
  it('refuses a swap of addresses that would collide on the first write', () => {
    const desired = parse([
      { id: 1, name: 'A', protocol: 'http', host: 'https://b.example.com' },
      { id: 2, name: 'B', protocol: 'http', host: 'https://a.example.com' },
    ]);
    expect(() =>
      buildServersPlan(
        desired,
        100000,
        [
          server({ id: 1, name: 'A', host: 'https://a.example.com' }),
          server({ id: 2, name: 'B', host: 'https://b.example.com' }),
        ],
        features,
      ),
    ).toThrow(CliError);
  });

  it('fills the panel defaults the API requires on create', () => {
    const desired = parse([
      {
        name: 'Word',
        protocol: 'keyword',
        host: 'https://a.example.com',
        keyword: 'OK',
      },
    ]);
    const plan = buildServersPlan(desired, 100000, [], {
      ...(features as object),
      keyword_monitoring_enabled: true,
    } as never);
    const step = plan.steps[0]!;
    if (step.kind !== 'create') throw new Error('expected create');
    expect(step.body).toMatchObject({
      http_method: 'get',
      keyword_mode: 'present',
    });
  });

  it('lets an account over its limit edit existing servers', () => {
    const desired = parse([
      {
        id: 1,
        name: 'Site',
        protocol: 'http',
        host: 'https://shop.example.com',
        description: 'x',
      },
    ]);
    const plan = buildServersPlan(
      desired,
      100000,
      [
        server(),
        server({ id: 2, name: 'Other', host: 'https://b.example.com' }),
      ],
      {
        ...(features as object),
        servers_limit: 1,
      } as never,
    );
    expect(plan.steps[0]!.kind).toBe('update');
  });

  it('refuses a feature the plan does not have', () => {
    const desired = parse([
      {
        id: 1,
        name: 'Site',
        protocol: 'http',
        host: 'https://shop.example.com',
        is_ssl_check: true,
      },
    ]);
    expect(() =>
      buildServersPlan(desired, 100000, [server()], features),
    ).toThrow(/ssl_monitoring_enabled/);
  });
});

describe('third review round', () => {
  it('refuses an internal host only when it is set or changed', () => {
    for (const host of [
      '127.0.0.1',
      'http://10.1.2.3:8080/x',
      '[::1]',
      'http://app.localhost',
    ]) {
      const desired = parse([{ name: 'A', protocol: 'ping', host }]);
      expect(() => buildServersPlan(desired, 100000, [], features)).toThrow(
        /host/,
      );
    }
    // A server created before the rule stays in the file untouched.
    const old = server({
      id: 5,
      name: 'Old',
      protocol: 'ping',
      host: '10.0.0.1',
    });
    const kept = parse([
      { id: 5, name: 'Old', protocol: 'ping', host: '10.0.0.1' },
    ]);
    expect(buildServersPlan(kept, 100000, [old], features).steps[0]!.kind).toBe(
      'unchanged',
    );
  });

  it('refuses a login without Basic authorization', () => {
    const desired = parse([
      {
        name: 'B',
        protocol: 'http',
        host: 'https://a.example.com',
        http_auth_username: 'monitor',
      },
    ]);
    expect(() => buildServersPlan(desired, 100000, [], features)).toThrow(
      /http_auth_username/,
    );
  });

  it('clears the name of a pinned server with name: null', () => {
    const desired = parse([{ id: 1, name: null, protocol: 'http' }]);
    const plan = buildServersPlan(desired, 100000, [server()], features);
    expect(plan.steps[0]).toMatchObject({
      kind: 'update',
      body: { name: null },
    });
  });

  it('keeps a pinned entry next to an unmanaged server of the same name', () => {
    const inProject = [
      server(),
      server({ id: 2, host: 'https://b.example.com' }),
    ];
    const { entries } = exportServers([inProject[0]!]);
    const plan = buildServersPlan(parse(entries), 100000, inProject, features);
    expect(plan.steps[0]!.kind).toBe('unchanged');
  });

  it('refuses blank required strings the API trims to empty', () => {
    expect(() =>
      parse([
        {
          name: 'W',
          protocol: 'keyword',
          host: 'https://a.example.com',
          keyword: '  ',
        },
      ]),
    ).toThrow(/keyword/);
    expect(() =>
      parse(
        [
          {
            name: 'L',
            protocol: 'llm',
            host: 'https://api.example.com',
            llm_model: 'm',
            llm_api_key: '$KEY',
          },
        ],
        { KEY: '   ' },
      ),
    ).toThrow(/llm_api_key/);
    const desired = parse([
      {
        name: 'B',
        protocol: 'http',
        host: 'https://a.example.com',
        http_auth_type: 'basic',
        http_auth_username: '   ',
        http_auth_password: 'p',
      },
    ]);
    expect(() => buildServersPlan(desired, 100000, [], features)).toThrow(
      /http_auth_username/,
    );
  });

  it('treats 2XX as the default success code, not a paid feature', () => {
    const desired = parse([
      {
        name: 'A',
        protocol: 'http',
        host: 'https://a.example.com',
        success_http_codes: [' 2XX '],
      },
    ]);
    expect(() => buildServersPlan(desired, 100000, [], features)).not.toThrow();
  });

  it('applies its own export with two servers of one name', () => {
    const inProject = [
      server(),
      server({ id: 2, host: 'https://b.example.com' }),
    ];
    const { entries } = exportServers(inProject);
    const desired = parse(entries);
    const plan = buildServersPlan(desired, 100000, inProject, features);
    expect(plan.steps.map((s) => s.kind)).toEqual(['unchanged', 'unchanged']);
  });
});
