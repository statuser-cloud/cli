/**
 * Exit codes are part of the CLI contract: CI pipelines branch on them.
 */
export const ExitCode = {
  Ok: 0,
  Failure: 1,
  Usage: 2,
  Auth: 3,
  ScenarioFailed: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** An error whose message is already meant for the user. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCodeValue = ExitCode.Failure,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export class StatuserApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errorCode?: string,
    readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'StatuserApiError';
  }

  get exitCode(): ExitCodeValue {
    return this.status === 401 ? ExitCode.Auth : ExitCode.Failure;
  }

  format(): string {
    const code = this.errorCode ? ` (${this.errorCode})` : '';
    return `API ${this.status}${code}: ${this.message}`;
  }
}

/**
 * The backend answers with `message: string | string[]` (validation errors
 * come as a list), `error_code`, `status_code` and sometimes `meta`.
 */
export function parseApiErrorBody(
  status: number,
  text: string,
): StatuserApiError {
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === 'object') {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON — fall back to the raw text below.
  }
  const rawMessage = body?.message;
  const message = Array.isArray(rawMessage)
    ? rawMessage.map(String).join('; ')
    : typeof rawMessage === 'string'
      ? rawMessage
      : text.slice(0, 500) || `HTTP ${status}`;
  const errorCode =
    typeof body?.error_code === 'string' ? body.error_code : undefined;
  const meta =
    body?.meta && typeof body.meta === 'object'
      ? (body.meta as Record<string, unknown>)
      : undefined;
  return new StatuserApiError(status, message, errorCode, meta);
}
