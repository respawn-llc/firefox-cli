import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, createConnection, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import {
  parseBoundaryResponse,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import { NATIVE_HOST_NAME } from "./host-launch.js";
import {
  createLocalIpcErrorResponse,
  encodeLocalIpcJsonLine,
  endSocketWithResponse,
  endSocketWithResponseSync,
  frameErrorToProtocolError,
  isMessageTooLargeError,
  LocalIpcFrameError,
  readOneJsonLine,
} from "./local-ipc-frame.js";

export { MAX_LOCAL_IPC_MESSAGE_BYTES } from "./local-ipc-frame.js";
const DEFAULT_LOCAL_IPC_REQUEST_LINE_TIMEOUT_MS = 5_000;

export type LocalIpcEndpoint =
  | {
      readonly kind: "unix-socket";
      readonly path: string;
    }
  | {
      readonly kind: "windows-named-pipe";
      readonly path: string;
    };

export type LocalIpcEndpointOptions = {
  readonly platform: NodeJS.Platform;
  readonly rootDir: string;
  readonly name?: string;
};

export type LocalIpcServerOptions = {
  readonly endpoint: LocalIpcEndpoint;
  readonly authToken?: string;
  readonly requestLineTimeoutMs?: number;
  handleMessage(message: unknown): Promise<unknown> | unknown;
};

export type LocalIpcAuthTokenStore = {
  readonly filePath: string;
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
};

export class LocalIpcError extends Error {
  readonly code: "INVALID_IPC_RESPONSE" | "CONNECTION_FAILED" | "SOCKET_FAILED" | "REQUEST_FAILED";

  constructor(
    code: LocalIpcError["code"],
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "LocalIpcError";
    this.code = code;
  }
}

export class LocalIpcServer {
  readonly #endpoint: LocalIpcEndpoint;
  readonly #authToken: string | undefined;
  readonly #requestLineTimeoutMs: number;
  readonly #handleMessage: LocalIpcServerOptions["handleMessage"];
  #server: Server | null = null;

  constructor(options: LocalIpcServerOptions) {
    this.#endpoint = options.endpoint;
    this.#authToken = options.authToken;
    this.#requestLineTimeoutMs =
      options.requestLineTimeoutMs ?? DEFAULT_LOCAL_IPC_REQUEST_LINE_TIMEOUT_MS;
    this.#handleMessage = options.handleMessage;
  }

  async start(): Promise<void> {
    if (this.#server !== null) {
      return;
    }

    if (this.#endpoint.kind === "unix-socket") {
      await mkdir(dirname(this.#endpoint.path), { mode: 0o700, recursive: true });
      await chmod(dirname(this.#endpoint.path), 0o700);
      await unlinkStaleSocket(this.#endpoint.path);
    }

    this.#server = createServer({ allowHalfOpen: true }, (socket) => {
      socket.allowHalfOpen = true;
      void this.#handleSocket(socket);
    });

    await new Promise<void>((resolve, reject) => {
      if (this.#server === null) {
        reject(new LocalIpcError("SOCKET_FAILED", "IPC server was not initialized."));
        return;
      }

      this.#server.once("error", reject);
      this.#server.listen(this.#endpoint.path, () => {
        this.#server?.off("error", reject);
        resolve();
      });
    });

    if (this.#endpoint.kind === "unix-socket") {
      await chmod(this.#endpoint.path, 0o600);
    }
  }

  async stop(): Promise<void> {
    if (this.#server === null) {
      return;
    }

    const server = this.#server;
    this.#server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
          return;
        }
        reject(error);
      });
    });

    if (this.#endpoint.kind === "unix-socket") {
      await unlinkStaleSocket(this.#endpoint.path);
    }
  }

  async #handleSocket(socket: Socket): Promise<void> {
    let readErrorHandled = false;
    try {
      const message = await readOneJsonLine(socket, {
        timeoutMs: this.#requestLineTimeoutMs,
        onFrameError: (error) => {
          readErrorHandled = true;
          const requestId = getRequestIdFromFrameError(error);
          const protocolError = frameErrorToProtocolError(error);
          endSocketWithResponseSync(
            socket,
            createLocalIpcErrorResponse(
              requestId,
              protocolError.code,
              protocolError.message,
              protocolError.details,
            ),
            requestId,
          );
        },
      });
      const requestId = getRequestId(message);
      const authorizedMessage = unwrapAuthorizedMessage(message, this.#authToken);
      if (!authorizedMessage.ok) {
        await endSocketWithResponse(socket, authorizedMessage.response, requestId);
        return;
      }

      const response = await this.#handleMessage(authorizedMessage.message);
      await endSocketWithResponse(socket, response, getRequestId(authorizedMessage.message));
    } catch (error) {
      if (error instanceof LocalIpcFrameError) {
        if (readErrorHandled) {
          return;
        }

        const protocolError = frameErrorToProtocolError(error);
        await endSocketWithResponse(
          socket,
          createLocalIpcErrorResponse(
            getRequestIdFromFrameError(error),
            protocolError.code,
            protocolError.message,
            protocolError.details,
          ),
          getRequestIdFromFrameError(error),
        );
        return;
      }

      socket.destroy(error instanceof Error ? error : undefined);
    }
  }
}

export function planLocalIpcEndpoint(options: LocalIpcEndpointOptions): LocalIpcEndpoint {
  const name = options.name ?? NATIVE_HOST_NAME;
  if (options.platform === "win32") {
    return {
      kind: "windows-named-pipe",
      path: `\\\\.\\pipe\\firefox-cli-${name}`,
    };
  }

  return {
    kind: "unix-socket",
    path: join(options.rootDir, "ipc", `${name}.sock`),
  };
}

export async function sendLocalIpcRequest<C extends RequestEnvelope["command"]>(
  endpoint: LocalIpcEndpoint,
  request: RequestEnvelope<C>,
  options: { readonly authToken?: string | null } = {},
): Promise<ResponseEnvelope<C>> {
  const wireMessage =
    options.authToken === undefined || options.authToken === null
      ? request
      : {
          authToken: options.authToken,
          message: request,
        };

  let encodedRequest: Buffer;
  try {
    encodedRequest = encodeLocalIpcJsonLine(wireMessage);
  } catch (error) {
    if (isMessageTooLargeError(error)) {
      return createLocalIpcErrorResponse(request.id, "OUTPUT_TOO_LARGE", error.message, {
        ...error.details,
      }) as ResponseEnvelope<C>;
    }
    throw error;
  }

  const socket = createConnection(endpoint.path);
  const rawResponse = await new Promise<unknown>((resolve, reject) => {
    socket.once("error", (error) => {
      reject(
        new LocalIpcError("CONNECTION_FAILED", "Failed to connect to firefox-cli native host.", {
          cause: error,
        }),
      );
    });
    socket.once("connect", () => {
      socket.write(encodedRequest);
    });
    readOneJsonLine(socket).then(resolve, (error: unknown) => {
      if (error instanceof LocalIpcFrameError) {
        socket.destroy();
        const protocolError = frameErrorToProtocolError(error);
        resolve(
          createLocalIpcErrorResponse(
            request.id,
            protocolError.code,
            protocolError.message,
            protocolError.details,
          ),
        );
        return;
      }

      reject(error);
    });
  });

  const parsed = parseBoundaryResponse("cli-to-host", request.command, rawResponse);
  if (!parsed.ok) {
    throw new LocalIpcError("INVALID_IPC_RESPONSE", parsed.error.message);
  }

  return parsed.value as ResponseEnvelope<C>;
}

export class FileLocalIpcAuthTokenStore implements LocalIpcAuthTokenStore {
  readonly filePath: string;

  constructor(options: { readonly stateRoot: string }) {
    this.filePath = join(options.stateRoot, "ipc", "auth-token");
  }

  async read(): Promise<string | null> {
    try {
      return (await readFile(this.filePath, "utf8")).trim() || null;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async write(token: string): Promise<void> {
    await mkdir(dirname(this.filePath), { mode: 0o700, recursive: true });
    await writeFile(this.filePath, `${token}\n`, { mode: 0o600 });
    if (process.platform !== "win32") {
      await chmod(dirname(this.filePath), 0o700);
      await chmod(this.filePath, 0o600);
    }
  }
}

export async function getOrCreateLocalIpcAuthToken(store: LocalIpcAuthTokenStore): Promise<string> {
  const stored = await store.read();
  if (stored !== null) {
    return stored;
  }

  const token = randomBytes(32).toString("base64url");
  await store.write(token);
  return token;
}

function unwrapAuthorizedMessage(
  raw: unknown,
  expectedAuthToken: string | undefined,
):
  | {
      readonly ok: true;
      readonly message: unknown;
    }
  | {
      readonly ok: false;
      readonly response: ResponseEnvelope;
    } {
  if (expectedAuthToken === undefined) {
    return { ok: true, message: raw };
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "authToken" in raw &&
    "message" in raw &&
    raw.authToken === expectedAuthToken
  ) {
    return { ok: true, message: raw.message };
  }

  return {
    ok: false,
    response: {
      protocolVersion: 1,
      id: getRequestId(raw),
      ok: false,
      error: {
        code: "PERMISSION_DENIED",
        message: "Local IPC authentication failed.",
      },
    },
  };
}

function getRequestId(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) {
    return "invalid-request";
  }

  if ("id" in raw && typeof raw.id === "string") {
    return raw.id;
  }

  if (
    "message" in raw &&
    typeof raw.message === "object" &&
    raw.message !== null &&
    "id" in raw.message &&
    typeof raw.message.id === "string"
  ) {
    return raw.message.id;
  }

  return "invalid-request";
}

function getRequestIdFromFrameError(error: LocalIpcFrameError): string {
  if (error.rawLine === undefined || error.frameCode === "MESSAGE_TOO_LARGE") {
    return "invalid-request";
  }

  try {
    return getRequestId(JSON.parse(error.rawLine.toString("utf8")) as unknown);
  } catch {
    return "invalid-request";
  }
}

async function unlinkStaleSocket(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
