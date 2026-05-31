import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { createErrorResponse, type ProtocolError, type ResponseEnvelope } from "@firefox-cli/protocol";
import { BufferCursor } from "./buffer-cursor.js";
import { MAX_NATIVE_MESSAGE_OUTGOING_BYTES } from "./native-messaging-frame.js";

export const MAX_LOCAL_IPC_MESSAGE_BYTES = MAX_NATIVE_MESSAGE_OUTGOING_BYTES - 64 * 1024;

export type LocalIpcFrameErrorCode = "MESSAGE_TOO_LARGE" | "MISSING_NEWLINE" | "INVALID_JSON";

export class LocalIpcFrameError extends Error {
  readonly frameCode: LocalIpcFrameErrorCode;
  readonly rawLine: Buffer | undefined;
  readonly details: Record<string, unknown>;

  constructor(
    frameCode: LocalIpcFrameErrorCode,
    message: string,
    options: {
      readonly rawLine?: Buffer;
      readonly details?: Record<string, unknown>;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LocalIpcFrameError";
    this.frameCode = frameCode;
    this.rawLine = options.rawLine;
    this.details = options.details ?? {};
  }
}

export function encodeLocalIpcJsonLine(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.byteLength > MAX_LOCAL_IPC_MESSAGE_BYTES) {
    throw new LocalIpcFrameError(
      "MESSAGE_TOO_LARGE",
      `Local IPC message is ${String(payload.byteLength)} bytes, exceeding the ${String(MAX_LOCAL_IPC_MESSAGE_BYTES)} byte limit.`,
      {
        details: {
          actualBytes: payload.byteLength,
          maxBytes: MAX_LOCAL_IPC_MESSAGE_BYTES,
        },
      },
    );
  }

  return Buffer.concat([payload, Buffer.from("\n")]);
}

export async function endSocketWithResponse(socket: Socket, response: unknown, fallbackRequestId: string): Promise<void> {
  try {
    await endSocketWithJsonLine(socket, response);
    return;
  } catch (error) {
    if (!isMessageTooLargeError(error)) {
      throw error;
    }

    const oversizedResponse = createLocalIpcErrorResponse(
      fallbackRequestId,
      "OUTPUT_TOO_LARGE",
      `Local IPC response is ${String(error.details.actualBytes)} bytes, exceeding the ${String(MAX_LOCAL_IPC_MESSAGE_BYTES)} byte limit.`,
      error.details,
    );
    try {
      await endSocketWithJsonLine(socket, oversizedResponse);
    } catch (fallbackError) {
      if (!isMessageTooLargeError(fallbackError)) {
        throw fallbackError;
      }

      await endSocketWithJsonLine(
        socket,
        createLocalIpcErrorResponse(
          "invalid-request",
          "OUTPUT_TOO_LARGE",
          `Local IPC response is ${String(error.details.actualBytes)} bytes, exceeding the ${String(MAX_LOCAL_IPC_MESSAGE_BYTES)} byte limit.`,
          error.details,
        ),
      );
    }
  }
}

export async function writeSocketJsonLine(socket: Socket, message: unknown): Promise<void> {
  const line = encodeLocalIpcJsonLine(message);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      socket.off("error", onError);
      reject(error);
    };

    socket.once("error", onError);
    socket.resume();
    socket.write(line, (error) => {
      socket.off("error", onError);
      if (error !== undefined && error !== null) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function endSocketWithResponseSync(socket: Socket, response: unknown, fallbackRequestId: string): void {
  try {
    endSocketWithLineSync(socket, encodeLocalIpcJsonLine(response));
    return;
  } catch (error) {
    if (!isMessageTooLargeError(error)) {
      throw error;
    }

    const oversizedResponse = createLocalIpcErrorResponse(
      fallbackRequestId,
      "OUTPUT_TOO_LARGE",
      `Local IPC response is ${String(error.details.actualBytes)} bytes, exceeding the ${String(MAX_LOCAL_IPC_MESSAGE_BYTES)} byte limit.`,
      error.details,
    );
    try {
      endSocketWithLineSync(socket, encodeLocalIpcJsonLine(oversizedResponse));
    } catch (fallbackError) {
      if (!isMessageTooLargeError(fallbackError)) {
        throw fallbackError;
      }

      endSocketWithLineSync(
        socket,
        encodeLocalIpcJsonLine(
          createLocalIpcErrorResponse(
            "invalid-request",
            "OUTPUT_TOO_LARGE",
            `Local IPC response is ${String(error.details.actualBytes)} bytes, exceeding the ${String(MAX_LOCAL_IPC_MESSAGE_BYTES)} byte limit.`,
            error.details,
          ),
        ),
      );
    }
  }
}

export async function readOneJsonLine(
  socket: Duplex,
  options: {
    readonly timeoutMs?: number;
    readonly onFrameError?: (error: LocalIpcFrameError) => void;
  } = {},
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const buffer = new BufferCursor();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
    };
    const fail = (error: LocalIpcFrameError): void => {
      cleanup();
      socket.pause();
      options.onFrameError?.(error);
      reject(error);
    };
    const finish = (line: Buffer): void => {
      cleanup();
      try {
        resolve(JSON.parse(line.toString("utf8")));
      } catch (error) {
        fail(
          new LocalIpcFrameError("INVALID_JSON", "IPC message is not valid JSON.", {
            rawLine: line,
            cause: error,
          }),
        );
      }
    };
    const onData = (chunk: Buffer): void => {
      buffer.append(chunk);
      const newlineIndex = buffer.indexOf(0x0a);
      if (newlineIndex >= 0) {
        if (newlineIndex > MAX_LOCAL_IPC_MESSAGE_BYTES) {
          fail(
            new LocalIpcFrameError(
              "MESSAGE_TOO_LARGE",
              `Local IPC message is ${String(newlineIndex)} bytes, exceeding the ${String(MAX_LOCAL_IPC_MESSAGE_BYTES)} byte limit.`,
              {
                details: {
                  actualBytes: newlineIndex,
                  maxBytes: MAX_LOCAL_IPC_MESSAGE_BYTES,
                },
              },
            ),
          );
          return;
        }

        const line = buffer.read(newlineIndex);
        buffer.discard(1);
        finish(line);
        return;
      }

      if (buffer.availableBytes > MAX_LOCAL_IPC_MESSAGE_BYTES) {
        fail(
          new LocalIpcFrameError(
            "MESSAGE_TOO_LARGE",
            `Local IPC message exceeds the ${String(MAX_LOCAL_IPC_MESSAGE_BYTES)} byte limit before a newline delimiter.`,
            {
              details: {
                actualBytes: buffer.availableBytes,
                maxBytes: MAX_LOCAL_IPC_MESSAGE_BYTES,
              },
            },
          ),
        );
        return;
      }
    };
    const onEnd = (): void => {
      cleanup();
      failWithMissingNewline("IPC connection closed before a newline-delimited message was sent.");
    };
    const failWithMissingNewline = (message: string): void => {
      const error = new LocalIpcFrameError("MISSING_NEWLINE", message, {
        rawLine: buffer.snapshot(),
        details: {
          actualBytes: buffer.availableBytes,
          maxBytes: MAX_LOCAL_IPC_MESSAGE_BYTES,
        },
      });
      options.onFrameError?.(error);
      reject(error);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);

    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        cleanup();
        socket.pause();
        failWithMissingNewline(`IPC message did not include a newline delimiter within ${String(options.timeoutMs)}ms.`);
      }, options.timeoutMs);
    }
  });
}

export function frameErrorToProtocolError(error: LocalIpcFrameError): ProtocolError {
  if (error.frameCode === "MESSAGE_TOO_LARGE") {
    return {
      code: "OUTPUT_TOO_LARGE",
      message: error.message,
      details: error.details,
    };
  }

  return {
    code: "INVALID_ENVELOPE",
    message: error.message,
    ...(Object.keys(error.details).length === 0 ? {} : { details: error.details }),
  };
}

export function createLocalIpcErrorResponse(id: string, code: ProtocolError["code"], message: string, details?: Record<string, unknown>): ResponseEnvelope {
  return createErrorResponse(id, {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

export function isMessageTooLargeError(error: unknown): error is LocalIpcFrameError {
  return error instanceof LocalIpcFrameError && error.frameCode === "MESSAGE_TOO_LARGE";
}

async function endSocketWithJsonLine(socket: Socket, message: unknown): Promise<void> {
  await writeSocketJsonLine(socket, message);
  await new Promise<void>((resolve) => {
    socket.end(() => {
      socket.destroy();
      resolve();
    });
  });
}

function endSocketWithLineSync(socket: Socket, line: Buffer): void {
  socket.resume();
  socket.write(line);
  socket.end();
  socket.destroySoon();
  const destroyTimer = setTimeout(() => {
    if (!socket.destroyed) {
      socket.destroy();
    }
  }, 10);
  destroyTimer.unref();
}
