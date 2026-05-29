import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, createConnection, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import {
  createErrorResponse,
  createLocalComponentIdentity,
  createProtocolSession,
  createRequest,
  localProtocolVersionRange,
  parseBoundaryResponse,
  type ProtocolSession,
  type ProtocolVersionRange,
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
  writeSocketJsonLine,
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
  readonly enableProtocolNegotiation?: boolean;
  readonly requestLineTimeoutMs?: number;
  handleMessage(
    message: unknown,
    context?: { readonly protocolSession?: ProtocolSession },
  ): Promise<unknown> | unknown;
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
  readonly #enableProtocolNegotiation: boolean;
  readonly #requestLineTimeoutMs: number;
  readonly #handleMessage: LocalIpcServerOptions["handleMessage"];
  #server: Server | null = null;

  constructor(options: LocalIpcServerOptions) {
    this.#endpoint = options.endpoint;
    this.#authToken = options.authToken;
    this.#enableProtocolNegotiation = options.enableProtocolNegotiation ?? false;
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

      if (this.#enableProtocolNegotiation && isHelloRequestLike(authorizedMessage.message)) {
        await this.#handleNegotiatedSocket(socket, authorizedMessage.message);
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

  async #handleNegotiatedSocket(socket: Socket, helloMessage: unknown): Promise<void> {
    const helloResponse = await this.#handleMessage(helloMessage);
    try {
      await writeSocketJsonLine(socket, helloResponse);
    } catch (error) {
      if (!isMessageTooLargeError(error)) {
        throw error;
      }
      await endSocketWithResponse(socket, helloResponse, getRequestId(helloMessage));
      return;
    }

    const hello = parseBoundaryResponse("cli-to-host", "hello", helloResponse, {
      hello: {
        local: localProtocolVersionRange,
        expectedPeerComponent: "native-host",
      },
    });
    if (!hello.ok || !hello.value.ok) {
      socket.end();
      socket.destroySoon();
      return;
    }

    const protocolSession = createProtocolSession(hello.value.protocolVersion);
    let readErrorHandled = false;
    try {
      const message = await readOneJsonLine(socket, {
        timeoutMs: this.#requestLineTimeoutMs,
        onFrameError: (error) => {
          readErrorHandled = true;
          const protocolError = frameErrorToProtocolError(error);
          endSocketWithResponseSync(
            socket,
            protocolSession.createErrorResponse(getRequestIdFromFrameError(error), protocolError),
            getRequestIdFromFrameError(error),
          );
        },
      });
      const requestId = getRequestId(message);
      const authorizedMessage = unwrapAuthorizedMessage(
        message,
        this.#authToken,
        protocolSession.protocolVersion,
      );
      if (!authorizedMessage.ok) {
        await endSocketWithResponse(socket, authorizedMessage.response, requestId);
        return;
      }

      const response = await this.#handleMessage(authorizedMessage.message, { protocolSession });
      await endSocketWithResponse(socket, response, getRequestId(authorizedMessage.message));
    } catch (error) {
      if (error instanceof LocalIpcFrameError) {
        if (readErrorHandled) {
          return;
        }

        const protocolError = frameErrorToProtocolError(error);
        await endSocketWithResponse(
          socket,
          protocolSession.createErrorResponse(getRequestIdFromFrameError(error), protocolError),
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
  let encodedRequest: Buffer;
  try {
    encodedRequest = encodeLocalIpcJsonLine(wrapAuthorizedMessage(request, options.authToken));
  } catch (error) {
    if (isMessageTooLargeError(error)) {
      return createLocalIpcErrorResponse(request.id, "OUTPUT_TOO_LARGE", error.message, {
        ...error.details,
      }) as ResponseEnvelope<C>;
    }
    throw error;
  }

  const socket = await connectLocalIpcSocket(endpoint);
  const rawResponse = await writeAndReadLocalIpcResponse(
    socket,
    encodedRequest,
    request.id,
  ).finally(() => {
    socket.destroy();
  });

  const parsed = parseBoundaryResponse("cli-to-host", request.command, rawResponse);
  if (!parsed.ok) {
    throw new LocalIpcError("INVALID_IPC_RESPONSE", parsed.error.message);
  }

  return parsed.value as ResponseEnvelope<C>;
}

export async function sendNegotiatedLocalIpcRequest<C extends RequestEnvelope["command"]>(
  endpoint: LocalIpcEndpoint,
  request: RequestEnvelope<C>,
  options: {
    readonly authToken?: string | null;
    readonly productVersion?: string;
    readonly protocolRange?: ProtocolVersionRange;
  } = {},
): Promise<ResponseEnvelope<C>> {
  const protocolRange = options.protocolRange ?? localProtocolVersionRange;
  const hello = createRequest(
    "hello",
    {
      ...createLocalComponentIdentity("cli", options.productVersion ?? "0.0.0"),
      protocolMin: protocolRange.protocolMin,
      protocolMax: protocolRange.protocolMax,
    },
    `${request.id}:hello`,
    protocolRange.protocolMin,
  );
  let encodedHello: Buffer;
  try {
    encodedHello = encodeLocalIpcJsonLine(wrapAuthorizedMessage(hello, options.authToken));
  } catch (error) {
    if (isMessageTooLargeError(error)) {
      return createLocalIpcErrorResponse(request.id, "OUTPUT_TOO_LARGE", error.message, {
        ...error.details,
      }) as ResponseEnvelope<C>;
    }
    throw error;
  }

  const socket = await connectLocalIpcSocket(endpoint);
  try {
    const rawHelloResponse = await writeAndReadLocalIpcResponse(socket, encodedHello, hello.id);
    const parsedHello = parseBoundaryResponse("cli-to-host", "hello", rawHelloResponse, {
      hello: {
        local: protocolRange,
        expectedPeerComponent: "native-host",
      },
    });
    if (!parsedHello.ok) {
      throw new LocalIpcError("INVALID_IPC_RESPONSE", parsedHello.error.message);
    }
    if (!parsedHello.value.ok) {
      return createErrorResponse(
        request.id,
        parsedHello.value.error,
        parsedHello.value.protocolVersion,
      ) as ResponseEnvelope<C>;
    }

    const protocolSession = createProtocolSession(parsedHello.value.protocolVersion);
    let encodedRequest: Buffer;
    try {
      encodedRequest = encodeLocalIpcJsonLine(
        wrapAuthorizedMessage(protocolSession.withRequestVersion(request), options.authToken),
      );
    } catch (error) {
      if (isMessageTooLargeError(error)) {
        return protocolSession.createErrorResponse(request.id, {
          code: "OUTPUT_TOO_LARGE",
          message: error.message,
          details: { ...error.details },
        }) as ResponseEnvelope<C>;
      }
      throw error;
    }

    socket.write(encodedRequest);
    const rawResponse = await readLocalIpcResponse(socket, request.id);
    const parsed = protocolSession.parseResponse("cli-to-host", request.command, rawResponse);
    if (!parsed.ok) {
      throw new LocalIpcError("INVALID_IPC_RESPONSE", parsed.error.message);
    }

    return parsed.value as ResponseEnvelope<C>;
  } finally {
    socket.destroy();
  }
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
  protocolVersion = localProtocolVersionRange.protocolMax,
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
    response: createErrorResponse(
      getRequestId(raw),
      {
        code: "PERMISSION_DENIED",
        message: "Local IPC authentication failed.",
      },
      protocolVersion,
    ),
  };
}

function wrapAuthorizedMessage(message: unknown, authToken: string | null | undefined): unknown {
  return authToken === undefined || authToken === null ? message : { authToken, message };
}

function isHelloRequestLike(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && "command" in raw && raw.command === "hello";
}

function connectLocalIpcSocket(endpoint: LocalIpcEndpoint): Promise<Socket> {
  const socket = createConnection(endpoint.path);
  return new Promise<Socket>((resolve, reject) => {
    const onError = (error: Error): void => {
      socket.off("connect", onConnect);
      reject(
        new LocalIpcError("CONNECTION_FAILED", "Failed to connect to firefox-cli native host.", {
          cause: error,
        }),
      );
    };
    const onConnect = (): void => {
      socket.off("error", onError);
      resolve(socket);
    };

    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}

async function writeAndReadLocalIpcResponse(
  socket: Socket,
  message: Buffer,
  fallbackRequestId: string,
): Promise<unknown> {
  socket.write(message);
  return readLocalIpcResponse(socket, fallbackRequestId);
}

async function readLocalIpcResponse(socket: Socket, fallbackRequestId: string): Promise<unknown> {
  try {
    return await readOneJsonLine(socket);
  } catch (error) {
    if (error instanceof LocalIpcFrameError) {
      const protocolError = frameErrorToProtocolError(error);
      return createLocalIpcErrorResponse(
        fallbackRequestId,
        protocolError.code,
        protocolError.message,
        protocolError.details,
      );
    }

    throw error;
  }
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
