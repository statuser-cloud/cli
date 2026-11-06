import { CliError, ExitCode } from './errors.js';
import { t } from './i18n.js';

/** A century: longer windows and look-backs are typos. */
export const MAX_DURATION_MS = 100 * 365 * 86_400_000;

/** `30m`, `2h`, `1h30m`, `45s` → milliseconds. */
export function parseDuration(raw: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw.trim());
  if (!match || !raw.trim()) {
    throw new CliError(t.durationInvalid(raw), ExitCode.Usage);
  }
  const [, h = '0', m = '0', s = '0'] = match;
  const ms = ((+h * 60 + +m) * 60 + +s) * 1000;
  // A date beyond what Date can hold would fail later, outside the
  // argument check, with exit code 1.
  if (ms <= 0 || ms > MAX_DURATION_MS) {
    throw new CliError(t.durationInvalid(raw), ExitCode.Usage);
  }
  return ms;
}
