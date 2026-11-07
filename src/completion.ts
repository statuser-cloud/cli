import type { Command } from 'commander';
import { SCENARIO_LOCATIONS, SCENARIO_TIMEOUTS } from './scenarios/config.js';
import { MANAGED_PROTOCOLS } from './servers-config/fields.js';

export const SHELLS = ['bash', 'zsh', 'fish'] as const;
export type Shell = (typeof SHELLS)[number];

interface Flag {
  names: string[];
  takesValue: boolean;
  description: string;
}

/** One command of the tree, addressed by its path: `servers update`. */
interface Node {
  path: string;
  commands: Array<{ name: string; description: string }>;
  flags: Flag[];
}

// Values worth offering after a flag, by `<path> <flag>` or by the flag
// alone. Ids are not looked up: that would be an API call on every Tab.
const STATUSES = ['ongoing', 'resolved'];
const VALUES: Record<string, string[]> = {
  '--protocol': [...MANAGED_PROTOCOLS, 'scenario'],
  'servers add --protocol': [...MANAGED_PROTOCOLS].filter((p) => p !== 'llm'),
  '--regions': [...SCENARIO_LOCATIONS],
  '--location': [...SCENARIO_LOCATIONS],
  'scenarios test --timeout': SCENARIO_TIMEOUTS.map(String),
  'incidents list --status': STATUSES,
  'reports create --status': ['downtime', 'degraded'],
};

/**
 * The completion script for a shell, built from the live command tree, so
 * a new command or flag is completed without touching this file. Commands,
 * flags and the values above are completed; the language of descriptions
 * is the one the CLI runs in.
 */
export function completionScript(program: Command, shell: Shell): string {
  const nodes = collect(program);
  switch (shell) {
    case 'bash':
      return bash(nodes);
    case 'zsh':
      return zsh(nodes);
    case 'fish':
      return fish(nodes);
  }
}

function collect(program: Command): Node[] {
  const global = flagsOf(program);
  const nodes: Node[] = [];
  const walk = (command: Command, path: string) => {
    const children = command.commands.filter(
      (c) => !(c as unknown as { _hidden?: boolean })._hidden,
    );
    nodes.push({
      path,
      commands: children.map((c) => ({
        name: c.name(),
        description: c.description(),
      })),
      flags: path ? merge(flagsOf(command), global) : global,
    });
    for (const child of children) {
      walk(child, path ? `${path} ${child.name()}` : child.name());
    }
  };
  walk(program, '');
  return nodes;
}

/** The command's own flags first; a global one it repeats (`--help`) once. */
function merge(own: Flag[], global: Flag[]): Flag[] {
  const seen = new Set(own.flatMap((f) => f.names));
  return [...own, ...global.filter((f) => !f.names.some((n) => seen.has(n)))];
}

function flagsOf(command: Command): Flag[] {
  const flags: Flag[] = command.options.map((option) => ({
    names: [option.short, option.long].filter((n): n is string => !!n),
    takesValue: option.required || option.optional,
    description: option.description,
  }));
  flags.push({ names: ['-h', '--help'], takesValue: false, description: '' });
  return flags;
}

function valuesFor(path: string, flag: string): string[] {
  return VALUES[`${path} ${flag}`] ?? VALUES[flag] ?? [];
}

/** Single-quoted for any POSIX-like shell. */
const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

// The path of the command being typed: walk the words before the cursor,
// stepping into a subcommand when the word names one and skipping flags and
// the value of a flag that takes one.
function pathCases(nodes: Node[], indent: string): string {
  return nodes
    .filter((n) => n.commands.length)
    .map(
      (n) =>
        `${indent}${quote(n.path)}) case "$w" in ${n.commands
          .map((c) => c.name)
          .join('|')}) cmdpath="\${cmdpath:+$cmdpath }$w"; continue ;; esac ;;`,
    )
    .join('\n');
}

function valueFlagCases(nodes: Node[], indent: string): string {
  const keys = nodes.flatMap((n) =>
    n.flags
      .filter((f) => f.takesValue)
      .flatMap((f) => f.names.map((name) => `${n.path}|${name}`)),
  );
  return keys.length ? `${indent}${keys.map(quote).join('|')}) skip=1 ;;` : '';
}

function bash(nodes: Node[]): string {
  const words = nodes
    .map((n) => {
      const items = [
        ...n.commands.map((c) => c.name),
        ...n.flags.flatMap((f) => f.names),
      ];
      return `    ${quote(n.path)}) words=${quote(items.join(' '))} ;;`;
    })
    .join('\n');
  const values = nodes
    .flatMap((n) =>
      n.flags
        .filter((f) => f.takesValue)
        .flatMap((f) =>
          f.names.map((name) => ({ name, values: valuesFor(n.path, name) })),
        )
        .filter((v) => v.values.length)
        .map(
          (v) =>
            `    ${quote(`${n.path}|${v.name}`)}) COMPREPLY=($(compgen -W ${quote(v.values.join(' '))} -- "$cur")); return ;;`,
        ),
    )
    .join('\n');
  return `# bash completion for statuser
_statuser() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local cmdpath="" skip=0 i w words
  for ((i = 1; i < COMP_CWORD; i++)); do
    w="\${COMP_WORDS[i]}"
    if [ "$skip" = 1 ]; then skip=0; continue; fi
    case "$w" in -*)
      case "$cmdpath|$w" in
${valueFlagCases(nodes, '        ')}
      esac
      continue ;;
    esac
    case "$cmdpath" in
${pathCases(nodes, '      ')}
    esac
    break
  done
  case "$cmdpath|$prev" in
${values}
  esac
  case "$cmdpath" in
${words}
  esac
  COMPREPLY=($(compgen -W "$words" -- "$cur"))
}
complete -o default -F _statuser statuser
`;
}

function zsh(nodes: Node[]): string {
  const describe = (items: Array<{ name: string; description: string }>) =>
    items
      .map((i) => quote(`${i.name.replace(/:/g, '\\:')}:${i.description}`))
      .join(' ');
  const lists = nodes
    .map((n) => {
      const items = [
        ...n.commands,
        ...n.flags.flatMap((f) =>
          f.names.map((name) => ({ name, description: f.description })),
        ),
      ];
      return `    ${quote(n.path)}) items=(${describe(items)}) ;;`;
    })
    .join('\n');
  const values = nodes
    .flatMap((n) =>
      n.flags
        .filter((f) => f.takesValue)
        .flatMap((f) =>
          f.names.map((name) => ({ name, values: valuesFor(n.path, name) })),
        )
        .filter((v) => v.values.length)
        .map(
          (v) =>
            `    ${quote(`${n.path}|${v.name}`)}) compadd -- ${v.values.map(quote).join(' ')}; return ;;`,
        ),
    )
    .join('\n');
  return `#compdef statuser
# zsh completion for statuser
_statuser() {
  local cmdpath="" skip=0 i w prev="\${words[CURRENT-1]}"
  local -a items
  for ((i = 2; i < CURRENT; i++)); do
    w="\${words[i]}"
    if [[ $skip == 1 ]]; then skip=0; continue; fi
    case "$w" in -*)
      case "$cmdpath|$w" in
${valueFlagCases(nodes, '        ')}
      esac
      continue ;;
    esac
    case "$cmdpath" in
${pathCases(nodes, '      ')}
    esac
    break
  done
  case "$cmdpath|$prev" in
${values}
  esac
  case "$cmdpath" in
${lists}
  esac
  _describe 'statuser' items
}
# As a file in $fpath (how Homebrew installs it) the first call runs this
# file; sourced, it registers the function.
if [ "$funcstack[1]" = "_statuser" ]; then
  _statuser "$@"
else
  compdef _statuser statuser
fi
`;
}

function fish(nodes: Node[]): string {
  const valueFlags = nodes.flatMap((n) =>
    n.flags
      .filter((f) => f.takesValue)
      .flatMap((f) => f.names.map((name) => `${n.path}|${name}`)),
  );
  const lines = [
    '# fish completion for statuser',
    'complete -c statuser -f',
    // The path of the command being typed, as in the other shells.
    'function __statuser_path',
    '  set -l words (commandline -opc)',
    '  set -l cmdpath ""',
    '  set -l skip 0',
    '  for w in $words[2..-1]',
    '    if test $skip = 1; set skip 0; continue; end',
    '    if string match -q -- "-*" $w',
    '      switch "$cmdpath|$w"',
    ...(valueFlags.length
      ? [
          `        case ${valueFlags.map(quote).join(' ')}`,
          '          set skip 1',
        ]
      : []),
    '      end',
    '      continue',
    '    end',
    '    set -l next ""',
    '    switch "$cmdpath"',
    ...nodes
      .filter((n) => n.commands.length)
      .flatMap((n) => [
        `      case ${quote(n.path)}`,
        `        if contains -- $w ${n.commands.map((c) => c.name).join(' ')}; set next $w; end`,
      ]),
    '    end',
    '    test -z "$next"; and break',
    '    set cmdpath (string trim -- "$cmdpath $next")',
    '  end',
    '  echo $cmdpath',
    'end',
  ];
  for (const n of nodes) {
    // Paths are command names and spaces only: safe in double quotes.
    const when = quote(`test (__statuser_path) = "${n.path}"`);
    for (const c of n.commands) {
      lines.push(
        `complete -c statuser -n ${when} -a ${quote(c.name)} -d ${quote(c.description)}`,
      );
    }
    for (const f of n.flags) {
      const short = f.names.find((x) => /^-[^-]/.test(x));
      const long = f.names.find((x) => x.startsWith('--'));
      const parts = [`complete -c statuser -n ${when}`];
      if (short) parts.push(`-s ${short.slice(1)}`);
      if (long) parts.push(`-l ${long.slice(2)}`);
      if (f.takesValue) {
        const values = valuesFor(n.path, long ?? short ?? '');
        parts.push(values.length ? `-x -a ${quote(values.join(' '))}` : '-r');
      }
      if (f.description) parts.push(`-d ${quote(f.description)}`);
      lines.push(parts.join(' '));
    }
  }
  return `${lines.join('\n')}\n`;
}
