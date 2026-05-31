import { MAX_LOG_ENTRIES, MAX_LOG_RESULT_BYTES } from "@firefox-cli/protocol";

export interface CapturedLogEntry {
  readonly level: string;
  readonly text: string;
  readonly timestamp: number;
}

export type LogResultEntryKey = "entries" | "errors";

export interface LogBufferSnapshot {
  readonly entries: readonly CapturedLogEntry[];
  readonly truncated: boolean;
  readonly droppedEntries: number;
}

export interface LogEntryStore {
  push(entry: CapturedLogEntry): number;
  clear(): void;
  snapshot(): LogBufferSnapshot;
  readonly [Symbol.iterator]: () => Iterator<CapturedLogEntry>;
  length: number;
}

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
      if (this.#encodedResultBytes([{ ...entry, text }], truncatedMetadata) <= this.#maxResultBytes) {
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

  #encodedResultBytes(entries: readonly CapturedLogEntry[], metadata: { readonly truncated: boolean; readonly droppedEntries: number }): number {
    return encodedByteLength(JSON.stringify(this.#listResult(entries, metadata)));
  }

  #listResult(entries: readonly CapturedLogEntry[], metadata: { readonly truncated: boolean; readonly droppedEntries: number }) {
    return {
      action: "list",
      ok: true,
      [this.#entryKey]: entries,
      truncated: metadata.truncated,
      droppedEntries: metadata.droppedEntries,
    };
  }
}

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
