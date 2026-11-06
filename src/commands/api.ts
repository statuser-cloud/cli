import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import type { HttpMethod, QueryValue } from '../client.js';
import { authedClient, globalOptions } from '../context.js';
import { CliError, ExitCode } from '../errors.js';
import { t } from '../i18n.js';
import { printJson, printLine } from '../output.js';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

interface ApiOptions {
  method: string;
  field: string[];
  rawField: string[];
  input?: string;
}

const collect = (value: string, previous: string[]) => [...previous, value];

export function registerApiCommand(program: Command): void {
  program
    .command('api')
    .description(t.cmdApi)
    .argument('<path>', '/v1/…')
    .option('-X, --method <method>', 'GET, POST, PUT, PATCH, DELETE', 'GET')
    .option('-F, --field <key=value>', t.optField, collect, [])
    .option('-f, --raw-field <key=value>', t.optRawField, collect, [])
    .option('--input <file>', t.optInput)
    .action(async (path: string, opts: ApiOptions, command: Command) => {
      const method = opts.method.toUpperCase() as HttpMethod;
      if (!METHODS.includes(method)) {
        throw new CliError(t.apiMethodInvalid(opts.method), ExitCode.Usage);
      }
      const fields: Record<string, unknown> = {};
      for (const raw of opts.field) {
        const [key, value] = splitField(raw);
        fields[key] = parseTyped(value);
      }
      for (const raw of opts.rawField) {
        const [key, value] = splitField(raw);
        fields[key] = value;
      }
      const hasFields = Object.keys(fields).length > 0;
      if (hasFields && opts.input) {
        throw new CliError(t.apiFieldsWithInput, ExitCode.Usage);
      }

      // Like `gh api`: fields of a read request are query parameters.
      const fieldsAsQuery = method === 'GET' || method === 'DELETE';
      let body: unknown;
      let query: Record<string, QueryValue> | undefined;
      if (opts.input) {
        const text = await readInput(opts.input).catch(() => {
          throw new CliError(t.configNotFound(opts.input!), ExitCode.Usage);
        });
        try {
          body = JSON.parse(text);
        } catch (error) {
          throw new CliError(
            t.configInvalid(opts.input, t.cfgJson((error as Error).message)),
            ExitCode.Usage,
          );
        }
      } else if (hasFields && fieldsAsQuery) {
        query = Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [
            k,
            typeof v === 'object' ? JSON.stringify(v) : (v as QueryValue),
          ]),
        );
      } else if (hasFields) {
        body = fields;
      }

      const { client } = await authedClient(command);
      const result = await client.call<unknown>({ method, path, query, body });
      // With --json stdout is always one JSON value: text answers (CSV
      // exports) become a JSON string, an empty one becomes null.
      if (globalOptions(command).json) printJson(result);
      else if (result === null) return;
      else if (typeof result === 'string') printLine(result);
      else printJson(result);
    });
}

function splitField(raw: string): [string, string] {
  const index = raw.indexOf('=');
  if (index <= 0) throw new CliError(t.apiFieldInvalid(raw), ExitCode.Usage);
  return [raw.slice(0, index), raw.slice(index + 1)];
}

/** `-F count=3` sends a number, `-F on=true` a boolean, `-F ids=[1,2]` an array. */
function parseTyped(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readInput(source: string): Promise<string> {
  if (source !== '-') return readFile(source, 'utf8');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
