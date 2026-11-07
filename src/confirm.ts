import { createInterface } from 'node:readline';
import { CliError, ExitCode } from './errors.js';
import { t } from './i18n.js';

/**
 * Asks before a deletion, like `gh repo delete`. `--yes` skips the
 * question; without a terminal there is no one to answer, so the command
 * refuses instead of deleting silently. A refusal at the prompt is not an
 * error, but nothing was done, so it ends with exit code 1.
 */
export async function confirmDeletion(
  question: string,
  yes: boolean | undefined,
): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY) {
    throw new CliError(t.confirmNeedsYes, ExitCode.Usage);
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => {
    let answered = false;
    rl.question(question, (text) => {
      answered = true;
      rl.close();
      resolve(text);
    });
    // Ctrl+D closes the prompt without an answer: that is a no.
    rl.on('close', () => {
      if (!answered) resolve('');
    });
  });
  if (!/^(y|yes|д|да)$/i.test(answer.trim())) {
    throw new CliError(t.cancelled, ExitCode.Failure);
  }
}
