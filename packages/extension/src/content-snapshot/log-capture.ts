import type { ConsoleResult, ErrorsResult } from "@firefox-cli/protocol";

type CapturedLogEntry = { level: string; text: string; timestamp: number };

type LogCaptureState = {
  installed: boolean;
  consoleEntries: CapturedLogEntry[];
  errorEntries: CapturedLogEntry[];
  capturedWindows: WeakSet<Window>;
};

const LOG_CAPTURE_STATE_KEY = Symbol.for("firefox-cli.contentSnapshot.logCaptureState");

function getLogCaptureState(): LogCaptureState {
  const global = globalThis as typeof globalThis & {
    [LOG_CAPTURE_STATE_KEY]?: LogCaptureState;
  };
  global[LOG_CAPTURE_STATE_KEY] ??= {
    installed: false,
    consoleEntries: [],
    errorEntries: [],
    capturedWindows: new WeakSet<Window>(),
  };
  return global[LOG_CAPTURE_STATE_KEY];
}

export function installLogCapture(): void {
  const state = getLogCaptureState();
  const global = globalThis as typeof globalThis & {
    readonly addEventListener?: typeof addEventListener;
  };
  if (state.installed) {
    return;
  }
  state.installed = true;

  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console[level]?.bind(console);
    console[level] = (...args: unknown[]) => {
      state.consoleEntries.push({
        level,
        text: args.map(String).join(" "),
        timestamp: Date.now(),
      });
      original?.(...args);
    };
  }
  installErrorListeners(global, state);
}

export function installWindowLogCapture(view: Window | null): void {
  const state = getLogCaptureState();
  if (view === null || state.capturedWindows.has(view)) {
    return;
  }
  state.capturedWindows.add(view);
  installErrorListeners(view, state);
}

function installErrorListeners(
  target: {
    readonly addEventListener?: typeof addEventListener;
  },
  state: LogCaptureState,
): void {
  target.addEventListener?.("error", (event) => {
    state.errorEntries.push({
      level: "error",
      text: event.message,
      timestamp: Date.now(),
    });
  });
  target.addEventListener?.("unhandledrejection", (event) => {
    state.errorEntries.push({
      level: "unhandledrejection",
      text: String(event.reason),
      timestamp: Date.now(),
    });
  });
}

export function createConsoleResult(action: ConsoleResult["action"]): ConsoleResult {
  const { consoleEntries } = getLogCaptureState();
  if (action === "clear") {
    consoleEntries.length = 0;
    return { action, ok: true };
  }
  return { action, ok: true, entries: [...consoleEntries] };
}

export function createErrorsResult(action: ErrorsResult["action"]): ErrorsResult {
  const { errorEntries } = getLogCaptureState();
  if (action === "clear") {
    errorEntries.length = 0;
    return { action, ok: true };
  }
  return { action, ok: true, errors: [...errorEntries] };
}
