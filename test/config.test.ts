import { statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configPath,
  normalizeApiUrl,
  resolveAuth,
  saveConfig,
} from '../src/config.js';
import { CliError, ExitCode } from '../src/errors.js';
import { tempDir } from './helpers/fake-api.js';

const saved = { ...process.env };
beforeEach(() => {
  process.env.XDG_CONFIG_HOME = tempDir();
  delete process.env.STATUSER_API_KEY;
  delete process.env.STATUSER_API_URL;
});
afterEach(() => {
  process.env = { ...saved };
});

const mode = (path: string) => statSync(path).mode & 0o777;

describe('saveConfig', () => {
  it('writes the key readable by the owner only', async () => {
    const path = await saveConfig({
      api_url: 'https://api.statuser.cloud',
      api_key: 'k1',
    });
    expect(mode(path)).toBe(0o600);
  });

  it('tightens an existing world-readable file', async () => {
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{}', { mode: 0o644 });
    await saveConfig({ api_url: 'https://api.statuser.cloud', api_key: 'k2' });
    expect(mode(path)).toBe(0o600);
  });
});

describe('resolveAuth', () => {
  it('prefers STATUSER_API_KEY over the saved key', async () => {
    await saveConfig({
      api_url: 'https://api.statuser.cloud',
      api_key: 'file',
    });
    process.env.STATUSER_API_KEY = 'env';
    const auth = await resolveAuth();
    expect(auth.apiKey).toBe('env');
    expect(auth.source.kind).toBe('env');
  });

  it('does not send a saved key to another API address', async () => {
    await saveConfig({ api_url: 'https://api.statuser.cloud', api_key: 'k1' });
    const error = await resolveAuth('https://other.example').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(ExitCode.Auth);
  });

  it('fails with the auth exit code when there is no key', async () => {
    const error = await resolveAuth().catch((e: unknown) => e);
    expect((error as CliError).exitCode).toBe(ExitCode.Auth);
  });
});

describe('normalizeApiUrl', () => {
  it('allows http only for localhost', () => {
    expect(normalizeApiUrl('http://127.0.0.1:3000/')).toBe(
      'http://127.0.0.1:3000',
    );
    expect(() => normalizeApiUrl('http://api.example.com')).toThrow(CliError);
  });
});
