/**
 * Structured tool errors. Tools return these instead of throwing bare Errors:
 *
 *   return {
 *     ok: false,
 *     error: {
 *       code: "RATE_LIMITED",
 *       message: "Email provider rate limit reached.",
 *       retryable: true,
 *     },
 *   };
 */
export type ToolErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "TIMEOUT"
  | "APPROVAL_DENIED"
  | "UNKNOWN";

export type ToolError = {
  code: ToolErrorCode | string;
  message: string;
  retryable?: boolean;
  details?: unknown;
};

export type ToolFailure = {
  ok: false;
  error: ToolError;
};

export type ToolSuccess<O> = {
  ok: true;
  value: O;
};

/** Normalized result of running a tool (produced by runTool). */
export type ToolOutcome<O> = ToolSuccess<O> | ToolFailure;

/**
 * What a tool's execute() returns: the raw value on success, or a structured
 * ToolFailure on failure. runTool() normalizes this into ToolOutcome.
 */
export type ToolResult<O> = O | ToolFailure;

export function ok<O>(value: O): ToolSuccess<O> {
  return { ok: true, value };
}

export function failure(
  code: ToolErrorCode | string,
  message: string,
  extra?: { retryable?: boolean; details?: unknown }
): ToolFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(extra?.retryable !== undefined ? { retryable: extra.retryable } : {}),
      ...(extra?.details !== undefined ? { details: extra.details } : {}),
    },
  };
}

export function isFailure(value: unknown): value is ToolFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ToolFailure).ok === false &&
    typeof (value as ToolFailure).error === "object" &&
    (value as ToolFailure).error !== null
  );
}

/** True when a failed outcome is worth retrying (defaults to retryable). */
export function isRetryable(value: ToolFailure): boolean {
  return value.error.retryable !== false;
}