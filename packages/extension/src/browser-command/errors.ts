export class BrowserCommandError extends Error {
  readonly code:
    | "NO_ACTIVE_TAB"
    | "INVALID_TARGET"
    | "UNSUPPORTED_CAPABILITY"
    | "PERMISSION_DENIED"
    | "NAVIGATION_FAILED"
    | "SCRIPT_INJECTION_FAILED"
    | "TIMEOUT"
    | "CAPTURE_FAILED"
    | "OUTPUT_TOO_LARGE"
    | "RESULT_TOO_LARGE";

  readonly details: Record<string, unknown> | undefined;

  constructor(code: BrowserCommandError["code"], message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "BrowserCommandError";
    this.code = code;
    this.details = details;
  }
}
