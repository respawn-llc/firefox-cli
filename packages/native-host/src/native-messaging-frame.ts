import type { Readable, Writable } from "node:stream";
import { BufferCursor } from "./buffer-cursor.js";

export const MAX_NATIVE_MESSAGE_OUTGOING_BYTES = 1024 * 1024;
export const DEFAULT_MAX_NATIVE_MESSAGE_INCOMING_BYTES = 16 * 1024 * 1024;

export type NativeMessagingFrameErrorCode =
  | "TRUNCATED_HEADER"
  | "TRUNCATED_BODY"
  | "MESSAGE_TOO_LARGE"
  | "INVALID_JSON"
  | "READ_TIMEOUT"
  | "WRITE_FAILED";

export class NativeMessagingFrameError extends Error {
  readonly code: NativeMessagingFrameErrorCode;
  readonly details: Record<string, unknown>;
  readonly recoverable: boolean;

  constructor(
    code: NativeMessagingFrameErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    options: { readonly recoverable?: boolean } = {},
  ) {
    super(message);
    this.name = "NativeMessagingFrameError";
    this.code = code;
    this.details = details;
    this.recoverable = options.recoverable ?? false;
  }
}

export type NativeMessagingFrameReaderOptions = {
  readonly maxIncomingBytes?: number;
  readonly partialFrameTimeoutMs?: number;
};

export class NativeMessagingFrameReader {
  readonly #iterator: AsyncIterator<Buffer>;
  readonly #maxIncomingBytes: number;
  readonly #partialFrameTimeoutMs: number | undefined;
  readonly #buffer = new BufferCursor();
  #ended = false;

  constructor(input: Readable, options: NativeMessagingFrameReaderOptions = {}) {
    this.#iterator = input[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
    this.#maxIncomingBytes = options.maxIncomingBytes ?? DEFAULT_MAX_NATIVE_MESSAGE_INCOMING_BYTES;
    this.#partialFrameTimeoutMs = options.partialFrameTimeoutMs;
  }

  async read(): Promise<unknown | null> {
    const hasHeader = await this.#fill(4, "header", { allowIdle: true });
    if (!hasHeader) {
      if (this.#buffer.availableBytes === 0) {
        return null;
      }

      throw new NativeMessagingFrameError(
        "TRUNCATED_HEADER",
        "Native messaging frame ended before the 4-byte length header was complete.",
        { availableBytes: this.#buffer.availableBytes },
      );
    }

    const payloadBytes = this.#buffer.read(4).readUInt32LE(0);

    if (payloadBytes > this.#maxIncomingBytes) {
      throw new NativeMessagingFrameError(
        "MESSAGE_TOO_LARGE",
        "Native messaging frame exceeds configured incoming limit.",
        {
          maxBytes: this.#maxIncomingBytes,
          receivedBytes: payloadBytes,
        },
      );
    }

    const hasBody = await this.#fill(payloadBytes, "body", { allowIdle: false });
    if (!hasBody) {
      throw new NativeMessagingFrameError(
        "TRUNCATED_BODY",
        "Native messaging frame ended before the JSON body was complete.",
        {
          expectedBytes: payloadBytes,
          availableBytes: this.#buffer.availableBytes,
        },
      );
    }

    const payload = this.#buffer.read(payloadBytes);
    const text = payload.toString("utf8");

    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new NativeMessagingFrameError(
        "INVALID_JSON",
        "Native messaging frame body is not valid JSON.",
        {
          error: error instanceof Error ? error.message : String(error),
        },
        { recoverable: true },
      );
    }
  }

  async #fill(
    requiredBytes: number,
    phase: "header" | "body",
    options: { readonly allowIdle: boolean },
  ): Promise<boolean> {
    while (this.#buffer.availableBytes < requiredBytes && !this.#ended) {
      const shouldApplyDeadline = !options.allowIdle || this.#buffer.availableBytes > 0;
      const next = await this.#readNext(phase, requiredBytes, shouldApplyDeadline);
      if (next.done === true) {
        this.#ended = true;
        break;
      }

      this.#buffer.append(next.value);
    }

    return this.#buffer.availableBytes >= requiredBytes;
  }

  async #readNext(
    phase: "header" | "body",
    expectedBytes: number,
    applyDeadline: boolean,
  ): Promise<IteratorResult<Buffer>> {
    const read = this.#iterator.next();
    if (!applyDeadline || this.#partialFrameTimeoutMs === undefined) {
      return read;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        read,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(
              new NativeMessagingFrameError(
                "READ_TIMEOUT",
                `Native messaging ${phase} did not complete within ${this.#partialFrameTimeoutMs}ms.`,
                {
                  phase,
                  expectedBytes,
                  availableBytes: this.#buffer.availableBytes,
                  timeoutMs: this.#partialFrameTimeoutMs,
                },
              ),
            );
          }, this.#partialFrameTimeoutMs);
        }),
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}

export function encodeNativeMessageFrame(
  message: unknown,
  maxOutgoingBytes = MAX_NATIVE_MESSAGE_OUTGOING_BYTES,
): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.byteLength > maxOutgoingBytes) {
    throw new NativeMessagingFrameError(
      "MESSAGE_TOO_LARGE",
      "Outgoing message exceeds native messaging limit.",
      {
        maxBytes: maxOutgoingBytes,
        actualBytes: payload.byteLength,
      },
    );
  }

  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.byteLength, 0);
  return Buffer.concat([header, payload]);
}

export async function writeNativeMessage(output: Writable, message: unknown): Promise<void> {
  const frame = encodeNativeMessageFrame(message);
  await new Promise<void>((resolve, reject) => {
    output.write(frame, (error) => {
      if (error === null || error === undefined) {
        resolve();
        return;
      }

      reject(
        new NativeMessagingFrameError("WRITE_FAILED", "Failed to write native message frame.", {
          error: error.message,
        }),
      );
    });
  });
}
