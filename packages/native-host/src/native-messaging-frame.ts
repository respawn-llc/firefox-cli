import type { Readable, Writable } from "node:stream";

export const MAX_NATIVE_MESSAGE_OUTGOING_BYTES = 1024 * 1024;
export const DEFAULT_MAX_NATIVE_MESSAGE_INCOMING_BYTES = 16 * 1024 * 1024;

export type NativeMessagingFrameErrorCode =
  | "TRUNCATED_HEADER"
  | "TRUNCATED_BODY"
  | "MESSAGE_TOO_LARGE"
  | "INVALID_JSON"
  | "WRITE_FAILED";

export class NativeMessagingFrameError extends Error {
  readonly code: NativeMessagingFrameErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: NativeMessagingFrameErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "NativeMessagingFrameError";
    this.code = code;
    this.details = details;
  }
}

export type NativeMessagingFrameReaderOptions = {
  readonly maxIncomingBytes?: number;
};

export class NativeMessagingFrameReader {
  readonly #iterator: AsyncIterator<Buffer>;
  readonly #maxIncomingBytes: number;
  #buffer = Buffer.alloc(0);
  #ended = false;

  constructor(input: Readable, options: NativeMessagingFrameReaderOptions = {}) {
    this.#iterator = input[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
    this.#maxIncomingBytes = options.maxIncomingBytes ?? DEFAULT_MAX_NATIVE_MESSAGE_INCOMING_BYTES;
  }

  async read(): Promise<unknown | null> {
    const hasHeader = await this.#fill(4);
    if (!hasHeader) {
      if (this.#buffer.byteLength === 0) {
        return null;
      }

      throw new NativeMessagingFrameError(
        "TRUNCATED_HEADER",
        "Native messaging frame ended before the 4-byte length header was complete.",
        { availableBytes: this.#buffer.byteLength },
      );
    }

    const payloadBytes = this.#buffer.readUInt32LE(0);
    this.#buffer = this.#buffer.subarray(4);

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

    const hasBody = await this.#fill(payloadBytes);
    if (!hasBody) {
      throw new NativeMessagingFrameError(
        "TRUNCATED_BODY",
        "Native messaging frame ended before the JSON body was complete.",
        {
          expectedBytes: payloadBytes,
          availableBytes: this.#buffer.byteLength,
        },
      );
    }

    const payload = this.#buffer.subarray(0, payloadBytes);
    this.#buffer = this.#buffer.subarray(payloadBytes);
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
      );
    }
  }

  async #fill(requiredBytes: number): Promise<boolean> {
    while (this.#buffer.byteLength < requiredBytes && !this.#ended) {
      const next = await this.#iterator.next();
      if (next.done === true) {
        this.#ended = true;
        break;
      }

      this.#buffer = Buffer.concat([this.#buffer, Buffer.from(next.value)]);
    }

    return this.#buffer.byteLength >= requiredBytes;
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
