import { t } from './i18n.js';

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printLine(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/** Progress and diagnostics go to stderr so `--json` stdout stays parseable. */
export function printErr(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function printTable(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const cells = rows.map((row) => row.map((cell) => cleanCell(cell)));
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...cells.map((row) => row[i]?.length ?? 0)),
  );
  const format = (row: string[]) =>
    row
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();
  printLine(format(headers));
  for (const row of cells) printLine(format(row));
}

/** Names are free text: a newline in one would break the table. */
function cleanCell(cell: string | number | null | undefined): string {
  if (cell === null || cell === undefined) return '';
  return String(cell).replace(/\s+/g, ' ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local time without seconds: a table cell, not a log timestamp. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** From start to end, or to now while still going. */
export function formatDuration(
  startIso: string,
  endIso: string | null,
  now = Date.now(),
): string {
  const end = endIso ? Date.parse(endIso) : now;
  const minutes = Math.max(
    0,
    Math.round((end - Date.parse(startIso)) / 60_000),
  );
  return t.duration(
    Math.floor(minutes / 1440),
    Math.floor((minutes % 1440) / 60),
    minutes % 60,
  );
}
