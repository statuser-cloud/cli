import { Help, type Command } from 'commander';
import { t } from './i18n.js';

// Commander prints its help headings and parse errors in English only. The
// help text is post-processed and the errors are rewritten through the
// dictionary, so a Russian terminal does not get half of the CLI in English.
const HEADINGS: Array<[RegExp, () => string]> = [
  [/^Usage:/gm, () => t.helpUsage],
  [/^Arguments:/gm, () => t.helpArguments],
  [/^Global Options:/gm, () => t.helpGlobalOptions],
  [/^Options:/gm, () => t.helpOptions],
  [/^Commands:/gm, () => t.helpCommands],
  // A wrapped line puts a newline after the colon, not a space.
  [/\(default:(?=\s)/g, () => `(${t.helpDefault}:`],
];

const ERRORS: Array<[RegExp, (...groups: string[]) => string]> = [
  [/^error: unknown option '([^']+)'(.*)$/s, (o) => t.errUnknownOption(o)],
  [/^error: unknown command '([^']+)'(.*)$/s, (c) => t.errUnknownCommand(c)],
  [
    /^error: required option '([^']+)' not specified/,
    (o) => t.errMissingOption(o),
  ],
  [
    /^error: missing required argument '([^']+)'/,
    (a) => t.errMissingArgument(a),
  ],
  [/^error: option '([^']+)' argument missing/, (o) => t.errOptionValue(o)],
  [/^error: too many arguments/, () => t.errTooManyArguments],
];

export function localizeHelp(text: string): string {
  return HEADINGS.reduce(
    (acc, [pattern, label]) => acc.replace(pattern, label()),
    text,
  );
}

export function localizeError(text: string): string {
  for (const [pattern, message] of ERRORS) {
    const match = pattern.exec(text.trim());
    if (match) return `${message(...match.slice(1))}\n`;
  }
  return text;
}

/** Call before subcommands are added: they inherit these settings. */
export function localizeCommander(program: Command): void {
  program
    .configureHelp({
      formatHelp: (cmd, helper) =>
        localizeHelp(Help.prototype.formatHelp.call(helper, cmd, helper)),
    })
    .configureOutput({
      outputError: (text, write) => write(localizeError(text)),
    })
    .helpOption('-h, --help', t.helpOption)
    .helpCommand('help [command]', t.helpCommand);
}
