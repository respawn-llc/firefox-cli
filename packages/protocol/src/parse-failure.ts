import type { ErrorCode, ParseResult } from "./core.js";

export function failure(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ParseResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}
