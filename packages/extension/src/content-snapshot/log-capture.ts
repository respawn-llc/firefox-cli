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
  consoleEntries: LogEntryStore;
  errorEntries: LogEntryStore;
  capturedWindows: WeakSet<Window>;
};

const LOG_CAPTURE_STATE_KEY = Symbol.for("firefox-cli.contentSnapshot.logCaptureState");
const TRUNCATED_TEXT_SUFFIX = "... [truncated]";

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
  };
  const state = global[LOG_CAPTURE_STATE_KEY];
  state.consoleEntries = normalizeLogEntryStore("entries", state.consoleEntries);
  state.errorEntries = normalizeLogEntryStore("errors", state.errorEntries);
  state.capturedWindows ??= new WeakSet<Window>();
  state.installed ??= false;
  return state as LogCaptureState;
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
