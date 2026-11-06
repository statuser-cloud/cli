import {
  ExitCode,
  NotSentError,
  StatuserApiError,
  type ExitCodeValue,
} from './errors.js';
import { t } from './i18n.js';

/** Why a write of `apply` or `deploy` stopped, and whether it may have landed. */
export interface WriteFailure {
  name: string;
  message: string;
  exitCode: ExitCodeValue;
  outcome_unknown: boolean;
}

/**
 * A request that never left and a 4xx refusal are known outcomes. After a
 * dropped connection, a timeout or a 5xx the write may have been stored
 * before the answer failed, so the outcome is unknown.
 */
export function describeWriteFailure(
  name: string,
  error: unknown,
): WriteFailure {
  if (error instanceof NotSentError) {
    return {
      name,
      message: t.deployStopped(name, error.message),
      exitCode: ExitCode.Failure,
      outcome_unknown: false,
    };
  }
  if (error instanceof StatuserApiError && error.status < 500) {
    return {
      name,
      message: t.deployStopped(name, error.format()),
      exitCode: error.exitCode,
      outcome_unknown: false,
    };
  }
  const detail =
    error instanceof StatuserApiError
      ? error.format()
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    name,
    message: t.applyUnknownOutcome(name, detail),
    exitCode: ExitCode.Failure,
    outcome_unknown: true,
  };
}
