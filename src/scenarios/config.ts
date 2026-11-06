import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CliError, ExitCode } from '../errors.js';
import type { components } from '../generated/openapi.js';
import { t } from '../i18n.js';
import { jsonErrorPosition } from '../json-error.js';
import { textLength } from '../text-length.js';

// Mirrors the backend limits (`scenario.constants.ts`, `LocationCode`): the
// whole config is checked before the first write, so a typo in the fifth
// scenario does not leave the first four applied.
export const SCENARIO_TIMEOUTS = [15, 30, 45, 60, 120] as const;
export const SCENARIO_LOCATIONS = [
  'msk-1',
  'spb-1',
  'ala-1',
  'nyc-1',
  'ams-1',
] as const;

type PreviewBody = components['schemas']['ScenarioPreviewDto'];
type SameValues<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
// Hand-copied lists are pinned to the spec: a value the API adds or drops
// fails `tsc` on the next spec sync instead of silently falling behind.
const _timeoutsMatchApi: SameValues<
  (typeof SCENARIO_TIMEOUTS)[number],
  PreviewBody['request_timeout']
> = true;
const _locationsMatchApi: SameValues<
  (typeof SCENARIO_LOCATIONS)[number],
  NonNullable<PreviewBody['locations']>[number]
> = true;
void _timeoutsMatchApi;
void _locationsMatchApi;

export const SCENARIO_MIN_INTERVAL = 60;
export const SCENARIO_MAX_INTERVAL = 86_400;
export const SCENARIO_DEFAULT_TIMEOUT = 30;
export const SCENARIO_DEFAULT_INTERVAL = 300;
export const SCENARIO_DEFAULT_LOCATION = 'msk-1';

export const SCENARIO_SCRIPT_MAX_BYTES = 64 * 1024;
// `MaxLength` of a server name in the API.
const SCENARIO_NAME_MAX = 150;
// Same check as `assertScenarioScript` in the backend.
export const SCENARIO_HAS_TEST = /\btest(?:\.\w+)?\s*\(/;
const ENV_MAX_VARS = 20;
const ENV_VALUE_MAX_BYTES = 4 * 1024;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
// Names the sandbox sets itself or that Node and Playwright read.
const ENV_RESERVED_PREFIXES = [
  'PLAYWRIGHT_',
  'PW_',
  'PWTEST_',
  'PWDEBUG',
  'DEBUG',
  'NODE_',
  'LD_',
  'STATUSER_',
];
const ENV_RESERVED_NAMES = [
  'PATH',
  'HOME',
  'TMPDIR',
  'CI',
  'FORCE_COLOR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
];
const ENV_REFERENCE =
  /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/;

export interface DesiredScenario {
  /** Pins the server when the name changes; otherwise matched by name. */
  id?: number;
  name: string;
  file: string;
  script: string;
  interval: number;
  timeout: number;
  location: string;
  /** Undefined: leave the server's variables alone. Defined: the full set. */
  env?: Record<string, string>;
}

export interface DesiredConfig {
  projectId: number;
  scenarios: DesiredScenario[];
}

export async function loadScenarioConfig(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
  // `scenarios deploy` needs the section; `apply` leaves scenarios alone
  // when the file has none.
  options: { required: boolean } = { required: true },
): Promise<DesiredConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new CliError(t.configNotFound(path), ExitCode.Usage);
  }
  const fail = (problem: string): never => {
    throw new CliError(t.configInvalid(path, problem), ExitCode.Usage);
  };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return fail(t.cfgJson(jsonErrorPosition(error)));
  }
  if (!isObject(raw)) return fail(t.cfgObject);
  if (!isPositiveInt(raw.project_id)) {
    return fail(`project_id: ${t.cfgPositiveInt}`);
  }
  // Without `required`, a missing or empty section means "do not manage".
  if (
    !options.required &&
    (raw.scenarios === undefined ||
      (Array.isArray(raw.scenarios) && !raw.scenarios.length))
  ) {
    return { projectId: raw.project_id as number, scenarios: [] };
  }
  if (!Array.isArray(raw.scenarios) || !raw.scenarios.length) {
    return fail(`scenarios: ${t.cfgNonEmptyArray}`);
  }

  const baseDir = dirname(resolve(path));
  const names = new Set<string>();
  const scenarios: DesiredScenario[] = [];
  for (const [index, item] of raw.scenarios.entries()) {
    const at = `scenarios[${index}]`;
    if (!isObject(item)) return fail(`${at}: ${t.cfgObject}`);

    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) return fail(`${at}.name: ${t.cfgRequired}`);
    if (textLength(name) > SCENARIO_NAME_MAX) {
      return fail(`${at}.name: ${t.cfgMaxLength(SCENARIO_NAME_MAX)}`);
    }
    if (names.has(name)) return fail(`${at}.name: ${t.cfgDuplicate(name)}`);
    names.add(name);

    if (item.id !== undefined && !isPositiveInt(item.id)) {
      return fail(`${at}.id: ${t.cfgPositiveInt}`);
    }
    if (typeof item.file !== 'string' || !item.file) {
      return fail(`${at}.file: ${t.cfgRequired}`);
    }
    const timeout = item.timeout ?? SCENARIO_DEFAULT_TIMEOUT;
    if (!SCENARIO_TIMEOUTS.includes(timeout as never)) {
      return fail(`${at}.timeout: ${t.cfgOneOf(SCENARIO_TIMEOUTS.join(', '))}`);
    }
    const interval = item.interval ?? SCENARIO_DEFAULT_INTERVAL;
    if (
      !Number.isInteger(interval) ||
      (interval as number) < SCENARIO_MIN_INTERVAL ||
      (interval as number) > SCENARIO_MAX_INTERVAL
    ) {
      return fail(
        `${at}.interval: ${t.cfgRange(SCENARIO_MIN_INTERVAL, SCENARIO_MAX_INTERVAL)}`,
      );
    }
    if ((interval as number) < (timeout as number)) {
      return fail(`${at}.interval: ${t.cfgIntervalBelowTimeout}`);
    }
    const location = item.location ?? SCENARIO_DEFAULT_LOCATION;
    if (!SCENARIO_LOCATIONS.includes(location as never)) {
      return fail(
        `${at}.location: ${t.cfgOneOf(SCENARIO_LOCATIONS.join(', '))}`,
      );
    }

    const file = resolve(baseDir, item.file);
    let script: string;
    try {
      script = await readFile(file, 'utf8');
    } catch {
      return fail(`${at}.file: ${t.cfgCannotRead(item.file)}`);
    }
    if (!script.trim()) return fail(`${at}.file: ${t.cfgFileEmpty(item.file)}`);
    if (Buffer.byteLength(script, 'utf8') > SCENARIO_SCRIPT_MAX_BYTES) {
      return fail(`${at}.file: ${t.cfgFileTooLarge}`);
    }
    // The backend rejects a script without any test(): the runner would
    // report zero tests and the monitor stay green checking nothing.
    if (!SCENARIO_HAS_TEST.test(script)) {
      return fail(`${at}.file: ${t.cfgNoTest(item.file)}`);
    }

    let resolvedEnv: Record<string, string> | undefined;
    if (item.env !== undefined) {
      if (!isObject(item.env)) return fail(`${at}.env: ${t.cfgObject}`);
      // No prototype: `__proto__` from the file must stay a key and fail the
      // name check, not vanish — an empty env deletes every saved variable.
      resolvedEnv = Object.create(null) as Record<string, string>;
      for (const [key, value] of Object.entries(item.env)) {
        if (typeof value !== 'string') {
          return fail(`${at}.env.${key}: ${t.cfgString}`);
        }
        resolvedEnv[key] = resolveEnvValue(value, name, env);
      }
      const problem = scenarioEnvProblem(resolvedEnv);
      if (problem) return fail(`${at}.env: ${problem}`);
    }

    scenarios.push({
      id: item.id as number | undefined,
      name,
      file: item.file,
      script,
      interval: interval as number,
      timeout: timeout as number,
      location: location as string,
      env: resolvedEnv,
    });
  }
  return { projectId: raw.project_id as number, scenarios };
}

/**
 * The backend rules for scenario variables (`mergeScenarioEnv`). Checked
 * before any write: a rejected name mid-deploy would leave earlier scenarios
 * applied. Returns the problem or null.
 */
export function scenarioEnvProblem(env: Record<string, string>): string | null {
  const names = Object.keys(env);
  if (names.length > ENV_MAX_VARS) {
    return t.cfgEnvTooMany(ENV_MAX_VARS);
  }
  for (const name of names) {
    if (
      !ENV_NAME.test(name) ||
      ENV_RESERVED_NAMES.includes(name) ||
      ENV_RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      return t.cfgEnvName(name);
    }
    if (Buffer.byteLength(env[name] as string, 'utf8') > ENV_VALUE_MAX_BYTES) {
      return t.cfgEnvValue(name);
    }
  }
  return null;
}

/**
 * `"$NAME"` / `"${NAME}"` reads the CI environment; `"$$…"` is a literal
 * value starting with `$`; anything else is a
 * literal. Secrets belong in CI variables, not in the committed config.
 */
export function resolveEnvValue(
  value: string,
  scenario: string,
  env: NodeJS.ProcessEnv,
): string {
  if (value.startsWith('$$')) return value.slice(1);
  const match = ENV_REFERENCE.exec(value);
  if (!match) return value;
  const name = (match[1] ?? match[2]) as string;
  const resolved = env[name];
  if (resolved === undefined) {
    throw new CliError(t.envMissing(name, scenario), ExitCode.Usage);
  }
  return resolved;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}
