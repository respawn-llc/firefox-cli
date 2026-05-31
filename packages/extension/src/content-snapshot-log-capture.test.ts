import { MAX_LOG_ENTRIES, MAX_LOG_RESULT_BYTES } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { BoundedLogBuffer } from "./content-snapshot/log-buffer.js";

describe("content log capture buffers", () => {
  it("bounds console capture by retained entry count and preserves newest order", () => {
    const buffer = new BoundedLogBuffer("entries");
    for (let index = 0; index < MAX_LOG_ENTRIES + 3; index += 1) {
      buffer.push({ level: "log", text: `bounded-log-${String(index)}`, timestamp: index });
    }
    const snapshot = buffer.snapshot();

    expect(snapshot.entries).toHaveLength(MAX_LOG_ENTRIES);
    expect(snapshot.entries[0]?.text).toBe("bounded-log-3");
    expect(snapshot.entries.at(-1)?.text).toBe(`bounded-log-${String(MAX_LOG_ENTRIES + 2)}`);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.droppedEntries).toBe(3);
  });

  it("bounds console capture by serialized result bytes and truncates oversized retained text", () => {
    const buffer = new BoundedLogBuffer("entries");

    buffer.push({ level: "log", text: "x".repeat(MAX_LOG_RESULT_BYTES * 2), timestamp: 1 });
    const snapshot = buffer.snapshot();

    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.text).toContain("[truncated]");
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.droppedEntries).toBe(0);
    expect(buffer.encodedResultBytes()).toBeLessThanOrEqual(MAX_LOG_RESULT_BYTES);
  });

  it("resets console buffer entries and truncation metadata on clear", () => {
    const buffer = new BoundedLogBuffer("entries");

    for (let index = 0; index < MAX_LOG_ENTRIES + 1; index += 1) {
      buffer.push({ level: "log", text: `clear-reset-${String(index)}`, timestamp: index });
    }
    buffer.clear();

    expect(buffer.snapshot()).toEqual({
      entries: [],
      truncated: false,
      droppedEntries: 0,
    });
  });

  it("drops entries that cannot fit even after text truncation", () => {
    const droppedOnlyBudget = encodedByteLength(
      JSON.stringify({
        action: "list",
        ok: true,
        entries: [],
        truncated: true,
        droppedEntries: 1,
      }),
    );
    const suffixEntryBudget = encodedByteLength(
      JSON.stringify({
        action: "list",
        ok: true,
        entries: [{ level: "log", text: "... [truncated]", timestamp: 1 }],
        truncated: true,
        droppedEntries: 0,
      }),
    );
    expect(suffixEntryBudget).toBeGreaterThan(droppedOnlyBudget);

    const buffer = new BoundedLogBuffer("entries", {
      maxEntries: 1,
      maxResultBytes: droppedOnlyBudget,
    });
    buffer.push({ level: "log", text: "x".repeat(1000), timestamp: 1 });

    expect(buffer.snapshot()).toEqual({
      entries: [],
      truncated: true,
      droppedEntries: 1,
    });
    expect(buffer.encodedResultBytes()).toBeLessThanOrEqual(droppedOnlyBudget);
  });
});

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
