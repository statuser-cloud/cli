import { afterEach, describe, expect, it } from 'vitest';
import { StatuserClient } from '../src/client.js';
import { CliError, ExitCode, StatuserApiError } from '../src/errors.js';
import { startFakeApi, type FakeApi } from './helpers/fake-api.js';

const apis: FakeApi[] = [];
afterEach(async () => {
  await Promise.all(apis.splice(0).map((api) => api.close()));
});

async function api(...args: Parameters<typeof startFakeApi>) {
  const started = await startFakeApi(...args);
  apis.push(started);
  return started;
}

describe('StatuserClient', () => {
  it('sends the key as a bearer token to the API', async () => {
    const server = await api(() => ({ body: { id: 1 } }));
    const client = new StatuserClient({ apiUrl: server.url, apiKey: 'k1' });
    await expect(
      client.call({ method: 'GET', path: '/v1/account' }),
    ).resolves.toEqual({ id: 1 });
    expect(server.requests[0]?.headers.authorization).toBe('Bearer k1');
  });

  it('keeps a protocol-relative path on the API host', async () => {
    const server = await api(() => ({ body: {} }));
    const client = new StatuserClient({ apiUrl: server.url, apiKey: 'k1' });
    await client.call({ method: 'GET', path: '//evil.example/x' });
    expect(server.requests).toHaveLength(1);
  });

  it('does not follow a redirect to another host', async () => {
    const other = await api(() => ({ body: {} }));
    const server = await api(() => ({
      status: 302,
      headers: { location: `${other.url}/steal` },
    }));
    const client = new StatuserClient({ apiUrl: server.url, apiKey: 'k1' });
    await expect(
      client.call({ method: 'GET', path: '/v1/account' }),
    ).rejects.toBeInstanceOf(StatuserApiError);
    expect(other.requests).toHaveLength(0);
  });

  it('retries a 429 after Retry-After', async () => {
    let calls = 0;
    const server = await api(() =>
      ++calls === 1
        ? { status: 429, headers: { 'retry-after': '0' }, body: {} }
        : { body: { ok: true } },
    );
    const client = new StatuserClient({ apiUrl: server.url, apiKey: 'k1' });
    await expect(
      client.call({ method: 'GET', path: '/v1/servers' }),
    ).resolves.toEqual({ ok: true });
    expect(server.requests).toHaveLength(2);
  });

  it('rejects a key with whitespace before any request', async () => {
    const server = await api(() => ({ body: {} }));
    const client = new StatuserClient({
      apiUrl: server.url,
      apiKey: 'part1\npart2',
    });
    const error = await client
      .call({ method: 'GET', path: '/v1/account' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(ExitCode.Auth);
    expect((error as Error).message).not.toContain('part1');
    expect(server.requests).toHaveLength(0);
  });

  it('sends anonymous requests without the key', async () => {
    const server = await api(() => ({ status: 204 }));
    const client = new StatuserClient({ apiUrl: server.url, apiKey: 'k1' });
    await client.call({
      method: 'POST',
      path: '/v1/heartbeat/t',
      anonymous: true,
    });
    expect(server.requests[0]?.headers.authorization).toBeUndefined();
  });

  it('maps 401 to the auth exit code with the API error code', async () => {
    const server = await api(() => ({
      status: 401,
      body: { message: 'Invalid token', error_code: 'auth_invalid_token' },
    }));
    const client = new StatuserClient({ apiUrl: server.url, apiKey: 'k1' });
    const error = (await client
      .call({ method: 'GET', path: '/v1/account' })
      .catch((e: unknown) => e)) as StatuserApiError;
    expect(error.exitCode).toBe(ExitCode.Auth);
    expect(error.errorCode).toBe('auth_invalid_token');
  });
});
