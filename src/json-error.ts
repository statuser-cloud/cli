/**
 * Where a JSON document broke, without quoting it: Node puts a fragment of
 * the input into the SyntaxError message, and the input may be a config or
 * a request body with passwords in it.
 */
export function jsonErrorPosition(error: unknown): string {
  const match = /position (\d+)/.exec(String((error as Error)?.message ?? ''));
  return match?.[1] ?? '';
}
