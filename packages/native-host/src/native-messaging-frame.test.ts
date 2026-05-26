import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  MAX_NATIVE_MESSAGE_OUTGOING_BYTES,
  NativeMessagingFrameError,
  NativeMessagingFrameReader,
  encodeNativeMessageFrame,
  writeNativeMessage,
} from "./native-messaging-frame.js";

describe("native messaging frames", () => {
  it("encodes JSON with a 32-bit little-endian byte length header", () => {
    const frame = encodeNativeMessageFrame({ ok: true });

    expect(frame.subarray(0, 4).readUInt32LE(0)).toBe(Buffer.byteLength('{"ok":true}'));
    expect(frame.subarray(4).toString("utf8")).toBe('{"ok":true}');
  });

  it("reads a complete frame", async () => {
    const input = new PassThrough();
    const reader = new NativeMessagingFrameReader(input);
    input.end(encodeNativeMessageFrame({ command: "noop" }));

    await expect(reader.read()).resolves.toEqual({ command: "noop" });
  });

  it("returns null on clean EOF before a header starts", async () => {
    const input = new PassThrough();
    const reader = new NativeMessagingFrameReader(input);
    input.end();

    await expect(reader.read()).resolves.toBeNull();
  });

  it("rejects EOF inside the length header", async () => {
    const input = new PassThrough();
    const reader = new NativeMessagingFrameReader(input);
    input.end(Buffer.from([1, 0, 0]));

    await expect(reader.read()).rejects.toMatchObject({ code: "TRUNCATED_HEADER" });
  });

  it("rejects EOF inside the message body", async () => {
    const input = new PassThrough();
    const reader = new NativeMessagingFrameReader(input);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(8, 0);
    input.end(Buffer.concat([header, Buffer.from("{}")]));

    await expect(reader.read()).rejects.toMatchObject({ code: "TRUNCATED_BODY" });
  });

  it("rejects incoming frames above the configured cap", async () => {
    const input = new PassThrough();
    const reader = new NativeMessagingFrameReader(input, { maxIncomingBytes: 4 });
    const header = Buffer.alloc(4);
    header.writeUInt32LE(5, 0);
    input.end(Buffer.concat([header, Buffer.from("12345")]));

    await expect(reader.read()).rejects.toMatchObject({ code: "MESSAGE_TOO_LARGE" });
  });

  it("rejects invalid JSON payloads", async () => {
    const input = new PassThrough();
    const reader = new NativeMessagingFrameReader(input);
    const payload = Buffer.from("{", "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.byteLength, 0);
    input.end(Buffer.concat([header, payload]));

    await expect(reader.read()).rejects.toMatchObject({ code: "INVALID_JSON" });
  });

  it("rejects outgoing frames above Firefox's 1 MiB native app limit", () => {
    const payload = "x".repeat(MAX_NATIVE_MESSAGE_OUTGOING_BYTES);

    expect(() => encodeNativeMessageFrame(payload)).toThrow(NativeMessagingFrameError);
    expect(() => encodeNativeMessageFrame(payload)).toThrow(/exceeds native messaging limit/);
  });

  it("writes only frame bytes to the supplied stdout stream", async () => {
    const chunks: Buffer[] = [];
    const stdout = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });

    await writeNativeMessage(stdout, { ok: true });

    expect(Buffer.concat(chunks)).toEqual(encodeNativeMessageFrame({ ok: true }));
  });
});
