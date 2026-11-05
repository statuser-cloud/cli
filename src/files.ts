import { link, rename, rm, writeFile } from 'node:fs/promises';
import { CliError, ExitCode } from './errors.js';
import { t } from './i18n.js';

/**
 * Writes a file the CLI produced (exported config, PDF report) readable by
 * the owner only: both can hold data the account would not publish. An
 * existing file is replaced only with `force`, and always atomically, so an
 * interrupted run never leaves half a file in place of a good one.
 */
export async function writeOwnFile(
  path: string,
  data: string | Buffer,
  force: boolean,
): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, data, { mode: 0o600, flag: 'wx' });
    if (force) {
      await rename(temp, path);
      return;
    }
    // Unlike `rename`, `link` fails when the target exists.
    try {
      await link(temp, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new CliError(t.fileExists(path), ExitCode.Usage);
      }
      throw error;
    }
  } finally {
    await rm(temp, { force: true });
  }
}
