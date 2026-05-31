import { LOG_RESULT_METADATA_PROTOCOL_VERSION, PROTOCOL_VERSION, type ConsoleResult, type ErrorsResult } from "@firefox-cli/protocol";
import { BoundedLogBuffer, type LogBufferSnapshot, type LogEntryStore } from "./log-buffer.js";

interface LogCaptureState {
  installed: boolean;
  globalRefCount: number;
  consoleEntries: LogEntryStore;
  errorEntries: LogEntryStore;
  capturedWindows: WeakSet<Window>;
  consolePatch?: ConsolePatch;
  errorListeners: WeakMap<object, ErrorListenerRegistration>;
}

const CONSOLE_LEVELS = ["log", "info", "warn", "error"] as const;
const LOG_CAPTURE_STATE_GLOBAL_KEY = "__firefoxCliContentSnapshotLogCaptureState";

declare global {
  var __firefoxCliContentSnapshotLogCaptureState: LogCaptureState | undefined;
}

interface ConsolePatch {
  restore(): void;
}

interface ErrorListenerTarget {
  readonly addEventListener?: (type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => void;
  readonly removeEventListener?: (type: string, listener: EventListener, options?: boolean | EventListenerOptions) => void;
}

interface ErrorListenerRegistration {
  refCount: number;
  restore(target: ErrorListenerTarget): void;
}

export interface LogCaptureHandle {
  dispose(): void;
}

export interface ContentLogCaptureService {
  installGlobal(): LogCaptureHandle;
  installWindow(view: Window | null): LogCaptureHandle;
  createConsoleResult(action: ConsoleResult["action"], protocolVersion?: number): ConsoleResult;
  createErrorsResult(action: ErrorsResult["action"], protocolVersion?: number): ErrorsResult;
}

function getLogCaptureState(): LogCaptureState {
  globalThis[LOG_CAPTURE_STATE_GLOBAL_KEY] ??= {
    installed: false,
    consoleEntries: new BoundedLogBuffer("entries"),
    errorEntries: new BoundedLogBuffer("errors"),
    capturedWindows: new WeakSet<Window>(),
    errorListeners: new WeakMap<object, ErrorListenerRegistration>(),
    globalRefCount: 0,
  };
  return globalThis[LOG_CAPTURE_STATE_GLOBAL_KEY];
}

export function createContentLogCaptureService(): ContentLogCaptureService {
  return {
    installGlobal: installLogCapture,
    installWindow: installWindowLogCapture,
    createConsoleResult,
    createErrorsResult,
  };
}

export function installLogCapture(): LogCaptureHandle {
  const state = getLogCaptureState();
  state.globalRefCount += 1;
  if (!state.installed) {
    state.installed = true;
    state.consolePatch ??= installConsolePatch(state);
    installErrorListeners(globalThis, state);
  }
  return createScopedHandle(() => {
    state.globalRefCount = Math.max(0, state.globalRefCount - 1);
    if (state.globalRefCount === 0) {
      restoreGlobalLogCapture(state);
    }
  });
}

export function installWindowLogCapture(view: Window | null): LogCaptureHandle {
  const state = getLogCaptureState();
  if (view === null) {
    return createScopedHandle(() => undefined);
  }
  const registration = installErrorListeners(view, state);
  state.capturedWindows.add(view);
  return createScopedHandle(() => {
    registration.refCount = Math.max(0, registration.refCount - 1);
    if (registration.refCount === 0) {
      restoreErrorListeners(view, state);
      state.capturedWindows.delete(view);
    }
  });
}

export function restoreLogCapture(): void {
  const state = getLogCaptureState();
  state.globalRefCount = 0;
  restoreGlobalLogCapture(state);
}

function restoreGlobalLogCapture(state: LogCaptureState): void {
  state.consolePatch?.restore();
  delete state.consolePatch;
  restoreErrorListeners(globalThis, state);
  state.installed = false;
}

export function restoreWindowLogCapture(view: Window | null): void {
  if (view === null) {
    return;
  }

  const state = getLogCaptureState();
  restoreErrorListeners(view, state);
  state.capturedWindows.delete(view);
}

function installConsolePatch(state: LogCaptureState): ConsolePatch {
  const targetConsole = globalThis.console;
  const patched = CONSOLE_LEVELS.map((level) => {
    const original = targetConsole[level];
    const originalCall = original.bind(targetConsole);
    const wrapper = (...args: unknown[]) => {
      state.consoleEntries.push({
        level,
        text: args.map(String).join(" "),
        timestamp: Date.now(),
      });
      originalCall(...args);
    };
    targetConsole[level] = wrapper;
    return { level, original, wrapper };
  });

  return {
    restore: () => {
      for (const { level, original, wrapper } of patched) {
        if (targetConsole[level] === wrapper) {
          targetConsole[level] = original;
        }
      }
    },
  };
}

function installErrorListeners(target: ErrorListenerTarget, state: LogCaptureState): ErrorListenerRegistration {
  const existing = state.errorListeners.get(target);
  if (existing !== undefined) {
    existing.refCount += 1;
    return existing;
  }

  const errorListener: EventListener = (event) => {
    state.errorEntries.push({
      level: "error",
      text: getErrorEventMessage(event),
      timestamp: Date.now(),
    });
  };
  const rejectionListener: EventListener = (event) => {
    state.errorEntries.push({
      level: "unhandledrejection",
      text: getPromiseRejectionReason(event),
      timestamp: Date.now(),
    });
  };
  target.addEventListener?.("error", errorListener);
  target.addEventListener?.("unhandledrejection", rejectionListener);
  const registration: ErrorListenerRegistration = {
    refCount: 1,
    restore: (restoreTarget) => {
      restoreTarget.removeEventListener?.("error", errorListener);
      restoreTarget.removeEventListener?.("unhandledrejection", rejectionListener);
    },
  };
  state.errorListeners.set(target, registration);
  return registration;
}

function getErrorEventMessage(event: Event): string {
  return "message" in event && typeof event.message === "string" ? event.message : "";
}

function getPromiseRejectionReason(event: Event): string {
  return "reason" in event ? String(event.reason) : "";
}

function restoreErrorListeners(target: ErrorListenerTarget, state: LogCaptureState): void {
  const registration = state.errorListeners.get(target);
  if (registration === undefined) {
    return;
  }
  registration.restore(target);
  state.errorListeners.delete(target);
}

function createScopedHandle(dispose: () => void): LogCaptureHandle {
  let disposed = false;
  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      dispose();
    },
  };
}

export function createConsoleResult(action: ConsoleResult["action"], protocolVersion: number = PROTOCOL_VERSION): ConsoleResult {
  const { consoleEntries } = getLogCaptureState();
  if (action === "clear") {
    consoleEntries.clear();
    return { action, ok: true };
  }
  const snapshot = consoleEntries.snapshot();
  return {
    action,
    ok: true,
    entries: [...snapshot.entries],
    ...metadataForProtocolVersion(snapshot, protocolVersion),
  };
}

export function createErrorsResult(action: ErrorsResult["action"], protocolVersion: number = PROTOCOL_VERSION): ErrorsResult {
  const { errorEntries } = getLogCaptureState();
  if (action === "clear") {
    errorEntries.clear();
    return { action, ok: true };
  }
  const snapshot = errorEntries.snapshot();
  return {
    action,
    ok: true,
    errors: [...snapshot.entries],
    ...metadataForProtocolVersion(snapshot, protocolVersion),
  };
}

function metadataForProtocolVersion(snapshot: LogBufferSnapshot, protocolVersion: number): Pick<ConsoleResult, "truncated" | "droppedEntries"> {
  return protocolVersion >= LOG_RESULT_METADATA_PROTOCOL_VERSION
    ? {
        truncated: snapshot.truncated,
        droppedEntries: snapshot.droppedEntries,
      }
    : {};
}
