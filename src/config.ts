import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CliError, ExitCode } from './errors.js';
import { t } from './i18n.js';

export const DEFAULT_API_URL = 'https://api.statuser.cloud';

/** What `statuser login` writes. The key is bound to the origin it was checked against. */
interface SavedConfig {
  api_url: string;
  api_key: string;
}

export type KeySource = { kind: 'env' } | { kind: 'file'; path: string };

export interface ResolvedAuth {
  apiUrl: string;
  apiKey: string;
  source: KeySource;
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === 'win32' && env.APPDATA) {
    return join(env.APPDATA, 'statuser', 'config.json');
  }
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'statuser', 'config.json');
}

/**
 * http is allowed only for local development: anywhere else the key would
 * travel in clear text.
 */
export function normalizeApiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError(t.apiUrlInvalid(raw), ExitCode.Usage);
  }
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    throw new CliError(t.apiUrlInsecure(raw), ExitCode.Usage);
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export async function readSavedConfig(): Promise<SavedConfig | null> {
  let text: string;
  try {
    text = await readFile(configPath(), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<SavedConfig>;
    if (typeof parsed.api_key === 'string' && parsed.api_key) {
      return {
        api_key: parsed.api_key,
        api_url:
          typeof parsed.api_url === 'string' ? parsed.api_url : DEFAULT_API_URL,
      };
    }
  } catch {
    // A broken file is treated as absent; `login` overwrites it.
  }
  return null;
}

export async function saveConfig(config: SavedConfig): Promise<string> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // A fresh file renamed over the old one: writing into an existing file
  // would keep its permissions, and the new key would sit readable by others
  // until a chmod. The temporary name is random and removed only once this
  // call has created it.
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  try {
    if (process.platform !== 'win32') await chmod(temp, 0o600);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return path;
}

export async function removeConfig(): Promise<boolean> {
  const saved = await readSavedConfig();
  await rm(configPath(), { force: true });
  return saved !== null;
}

export async function resolveApiUrl(flag?: string): Promise<string> {
  const saved = await readSavedConfig();
  return normalizeApiUrl(
    flag || process.env.STATUSER_API_URL || saved?.api_url || DEFAULT_API_URL,
  );
}

export async function resolveAuth(flag?: string): Promise<ResolvedAuth> {
  const apiUrl = await resolveApiUrl(flag);
  const envKey = process.env.STATUSER_API_KEY?.trim();
  if (envKey) return { apiUrl, apiKey: envKey, source: { kind: 'env' } };

  const saved = await readSavedConfig();
  if (!saved) throw new CliError(t.noApiKey, ExitCode.Auth);
  const savedOrigin = new URL(normalizeApiUrl(saved.api_url)).origin;
  const currentOrigin = new URL(apiUrl).origin;
  if (savedOrigin !== currentOrigin) {
    throw new CliError(
      t.keyOtherOrigin(savedOrigin, currentOrigin),
      ExitCode.Auth,
    );
  }
  return {
    apiUrl,
    apiKey: saved.api_key,
    source: { kind: 'file', path: configPath() },
  };
}
