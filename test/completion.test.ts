import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli, tempDir } from './helpers/fake-api.js';

const has = (shell: string) =>
  spawnSync('sh', ['-c', `command -v ${shell}`]).status === 0;

async function script(shell: string): Promise<string> {
  const result = await runCli(['completion', shell]);
  expect(result.code).toBe(0);
  const file = join(tempDir(), `statuser.${shell}`);
  writeFileSync(file, result.stdout);
  return file;
}

/** What bash offers for the words typed so far ('' — a new word). */
function bash(file: string, line: string): string[] {
  const out = execFileSync(
    'bash',
    [
      '-c',
      `source "$1"; COMP_WORDS=($2); COMP_CWORD=$(( \${#COMP_WORDS[@]} - 1 )); _statuser; printf '%s\\n' "\${COMPREPLY[@]}"`,
      'bash',
      file,
      line,
    ],
    { encoding: 'utf8' },
  );
  return out.split('\n').filter(Boolean);
}

describe('statuser completion', { timeout: 30_000 }, () => {
  it('refuses an unknown shell', async () => {
    expect((await runCli(['completion', 'tcsh'])).code).toBe(2);
  });

  it('completes commands, subcommands and flag values in bash', async () => {
    const file = await script('bash');
    expect(bash(file, 'statuser ser')).toEqual(['servers']);
    expect(bash(file, 'statuser servers u')).toEqual(['update']);
    expect(bash(file, 'statuser --json servers li')).toEqual(['list']);
    expect(bash(file, 'statuser servers add --protocol h')).toEqual([
      'http',
      'heartbeat',
    ]);
    // A flag value is not taken for a subcommand on the way.
    expect(bash(file, 'statuser servers update --project 100 --dry')).toEqual([
      '--dry-run',
    ]);
  });

  it.runIf(has('zsh'))('is valid zsh', async () => {
    const file = await script('zsh');
    expect(spawnSync('zsh', ['-n', file]).status).toBe(0);
  });

  it.runIf(has('fish'))('completes in fish', async () => {
    const file = await script('fish');
    const out = execFileSync(
      'fish',
      ['-c', `source ${file}; complete -C 'statuser servers u'`],
      { encoding: 'utf8' },
    );
    expect(out.split('\n')[0]).toMatch(/^update\t/);
  });
});
