import {
  LOG_RESULT_METADATA_PROTOCOL_VERSION,
  MAX_LOG_ENTRIES,
  MAX_LOG_RESULT_BYTES,
  PROTOCOL_VERSION,
  type ConsoleResult,
  type ErrorsResult,
} from "@firefox-cli/protocol";

export type CapturedLogEntry = { level: string; text: string; timestamp: number };

type LogResultEntryKey = "entries" | "errors";

type LogBufferSnapshot = {
  readonly entries: readonly CapturedLogEntry[];
  readonly truncated: boolean;
  readonly droppedEntries: number;
};

type LogEntryStore = {
  push(entry: CapturedLogEntry): number;
  clear(): void;
  snapshot(): LogBufferSnapshot;
  readonly [Symbol.iterator]: () => Iterator<CapturedLogEntry>;
  length: number;
};

type LogCaptureState = {
  installed: boolean;
  globalRefCount: number;
  consoleEntries: LogEntryStore;
  errorEntries: LogEntryStore;
  capturedWindows: WeakSet<Window>;
  consolePatch?: ConsolePatch;
  errorListeners: WeakMap<object, ErrorListenerRegistration>;
};

const LOG_CAPTURE_STATE_KEY = Symbol.for("firefox-cli.contentSnapshot.logCaptureState");
const TRUNCATED_TEXT_SUFFIX = "... [truncated]";
const CONSOLE_LEVELS = ["log", "info", "warn", "error"] as const;

type ConsolePatch = {
  restore(): void;
};

type ErrorListenerTarget = {
  readonly addEventListener?: (
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  readonly removeEventListener?: (
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ) => void;
};

type ErrorListenerRegistration = {
  refCount: number;
  restore(target: ErrorListenerTarget): void;
};

export type LogCaptureHandle = {
  dispose(): void;
};

export type ContentLogCaptureService = {
  installGlobal(): LogCaptureHandle;
  installWindow(view: Window | null): LogCaptureHandle;
  createConsoleResult(action: ConsoleResult["action"], protocolVersion?: number): ConsoleResult;
  createErrorsResult(action: ErrorsResult["action"], protocolVersion?: number): ErrorsResult;
};

export class BoundedLogBuffer implements LogEntryStore {
  readonly #entryKey: LogResultEntryKey;
  readonly #maxEntries: number;
  readonly #maxResultBytes: number;
  readonly #entries: CapturedLogEntry[] = [];
  #truncated = false;
  #droppedEntries = 0;

  constructor(
    entryKey: LogResultEntryKey,
    options: {
      readonly maxEntries?: number;
      readonly maxResultBytes?: number;
      readonly initialEntries?: readonly CapturedLogEntry[];
    } = {},
  ) {
    this.#entryKey = entryKey;
    this.#maxEntries = options.maxEntries ?? MAX_LOG_ENTRIES;
    this.#maxResultBytes = options.maxResultBytes ?? MAX_LOG_RESULT_BYTES;
    for (const entry of options.initialEntries ?? []) {
      this.push(entry);
    }
  }

  get length(): number {
    return this.#entries.length;
  }

  set length(nextLength: number) {
    if (nextLength === 0) {
      this.clear();
      return;
    }

    if (Number.isInteger(nextLength) && nextLength >= 0 && nextLength < this.#entries.length) {
      const removed = this.#entries.length - nextLength;
      this.#entries.splice(nextLength);
      this.#droppedEntries += removed;
      this.#truncated = true;
    }
  }

  [Symbol.iterator](): Iterator<CapturedLogEntry> {
    return this.#entries[Symbol.iterator]();
  }

  push(entry: CapturedLogEntry): number {
    this.#entries.push({ ...entry });
    this.#enforceEntryCount();
    this.#enforceResultBytes();
    return this.length;
  }

  clear(): void {
    this.#entries.length = 0;
    this.#truncated = false;
    this.#droppedEntries = 0;
  }

  snapshot(): LogBufferSnapshot {
    return {
      entries: this.#entries.map((entry) => ({ ...entry })),
      truncated: this.#truncated,
      droppedEntries: this.#droppedEntries,
    };
  }

  encodedResultBytes(entries: readonly CapturedLogEntry[] = this.#entries): number {
    return this.#encodedResultBytes(entries, {
      truncated: this.#truncated,
      droppedEntries: this.#droppedEntries,
    });
  }

  #enforceEntryCount(): void {
    while (this.#entries.length > this.#maxEntries) {
      this.#dropOldestEntry();
    }
  }

  #enforceResultBytes(): void {
    while (this.#entries.length > 0 && this.encodedResultBytes() > this.#maxResultBytes) {
      if (this.#entries.length > 1) {
        this.#dropOldestEntry();
        continue;
      }

      if (!this.#truncateSingleEntryToFit()) {
        this.#dropOldestEntry();
      }
      return;
    }
  }

  #dropOldestEntry(): void {
    this.#entries.shift();
    this.#droppedEntries += 1;
    this.#truncated = true;
  }

  #truncateSingleEntryToFit(): boolean {
    const entry = this.#entries[0];
    if (entry === undefined) {
      return true;
    }

    const chars = Array.from(entry.text);
    if (chars.length === 0) {
      return false;
    }

    const truncatedMetadata = {
      truncated: true,
      droppedEntries: this.#droppedEntries,
    };
    const suffixOnly = { ...entry, text: TRUNCATED_TEXT_SUFFIX };
    if (this.#encodedResultBytes([suffixOnly], truncatedMetadata) > this.#maxResultBytes) {
      return false;
    }

    let low = 0;
    let high = chars.length;
    let bestText = TRUNCATED_TEXT_SUFFIX;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const text = `${chars.slice(0, middle).join("")}${TRUNCATED_TEXT_SUFFIX}`;
      if (
        this.#encodedResultBytes([{ ...entry, text }], truncatedMetadata) <= this.#maxResultBytes
      ) {
        bestText = text;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    this.#entries[0] = { ...entry, text: bestText };
    this.#truncated = true;
    return true;
  }

  #encodedResultBytes(
    entries: readonly CapturedLogEntry[],
    metadata: { readonly truncated: boolean; readonly droppedEntries: number },
  ): number {
    return encodedByteLength(JSON.stringify(this.#listResult(entries, metadata)));
  }

  #listResult(
    entries: readonly CapturedLogEntry[],
    metadata: { readonly truncated: boolean; readonly droppedEntries: number },
  ) {
    return {
      action: "list",
      ok: true,
      [this.#entryKey]: entries,
      truncated: metadata.truncated,
      droppedEntries: metadata.droppedEntries,
    };
  }
}

function getLogCaptureState(): LogCaptureState {
  const global = globalThis as typeof globalThis & {
    [LOG_CAPTURE_STATE_KEY]?: Partial<LogCaptureState>;
  };
  global[LOG_CAPTURE_STATE_KEY] ??= {
    installed: false,
    consoleEntries: new BoundedLogBuffer("entries"),
    errorEntries: new BoundedLogBuffer("errors"),
    capturedWindows: new WeakSet<Window>(),
    errorListeners: new WeakMap<object, ErrorListenerRegistration>(),
    globalRefCount: 0,
  };
  const state = global[LOG_CAPTURE_STATE_KEY];
  state.consoleEntries = normalizeLogEntryStore("entries", state.consoleEntries);
  state.errorEntries = normalizeLogEntryStore("errors", state.errorEntries);
  state.capturedWindows ??= new WeakSet<Window>();
  state.errorListeners ??= new WeakMap<object, ErrorListenerRegistration>();
  state.installed ??= false;
  state.globalRefCount ??= state.installed ? 1 : 0;
  return state as LogCaptureState;
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
  const global = globalThis as typeof globalThis & {
    readonly addEventListener?: typeof addEventListener;
  };
  state.globalRefCount += 1;
  if (!state.installed) {
    state.installed = true;
    state.consolePatch ??= installConsolePatch(state);
    installErrorListeners(global, state);
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
  const global = globalThis as typeof globalThis & ErrorListenerTarget;
  state.consolePatch?.restore();
  delete state.consolePatch;
  restoreErrorListeners(global, state);
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
  const patched = CONSOLE_LEVELS.map((level) => {
    const original = console[level];
    const originalCall = original?.bind(console);
    const wrapper = (...args: unknown[]) => {
      state.consoleEntries.push({
        level,
        text: args.map(String).join(" "),
        timestamp: Date.now(),
      });
      originalCall?.(...args);
    };
    console[level] = wrapper;
    return { level, original, wrapper };
  });

  return {
    restore: () => {
      for (const { level, original, wrapper } of patched) {
        if (console[level] === wrapper) {
          console[level] = original;
        }
      }
    },
  };
}

function installErrorListeners(
  target: ErrorListenerTarget,
  state: LogCaptureState,
): ErrorListenerRegistration {
  const existing = state.errorListeners.get(target);
  if (existing !== undefined) {
    existing.refCount += 1;
    return existing;
  }

  const errorListener: EventListener = (event) => {
    const error = event as ErrorEvent;
    state.errorEntries.push({
      level: "error",
      text: error.message,
      timestamp: Date.now(),
    });
  };
  const rejectionListener: EventListener = (event) => {
    const rejection = event as PromiseRejectionEvent;
    state.errorEntries.push({
      level: "unhandledrejection",
      text: String(rejection.reason),
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

export function createConsoleResult(
  action: ConsoleResult["action"],
  protocolVersion: number = PROTOCOL_VERSION,
): ConsoleResult {
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

export function createErrorsResult(
  action: ErrorsResult["action"],
  protocolVersion: number = PROTOCOL_VERSION,
): ErrorsResult {
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

function normalizeLogEntryStore(entryKey: LogResultEntryKey, value: unknown): LogEntryStore {
  if (isLogEntryStore(value)) {
    return value;
  }
  return new BoundedLogBuffer(entryKey, {
    initialEntries: Array.isArray(value) ? value : [],
  });
}

function isLogEntryStore(value: unknown): value is LogEntryStore {
  return (
    typeof value === "object" &&
    value !== null &&
    "push" in value &&
    "clear" in value &&
    "snapshot" in value &&
    typeof value.push === "function" &&
    typeof value.clear === "function" &&
    typeof value.snapshot === "function" &&
    Symbol.iterator in value
  );
}

function metadataForProtocolVersion(
  snapshot: LogBufferSnapshot,
  protocolVersion: number,
): Pick<ConsoleResult, "truncated" | "droppedEntries"> {
  return protocolVersion >= LOG_RESULT_METADATA_PROTOCOL_VERSION
    ? {
        truncated: snapshot.truncated,
        droppedEntries: snapshot.droppedEntries,
      }
    : {};
}

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
