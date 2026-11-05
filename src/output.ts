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
