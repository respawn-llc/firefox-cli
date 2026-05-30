import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, stat, unlink } from "node:fs/promises";
import { createServer, createConnection, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import {
  createErrorResponse,
  createLocalComponentIdentity,
  createProtocolSession,
  createRequest,
  createRequestProtocolMismatchError,
  getRequestProtocolCompatibility,
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
import {
  NativeHostReliabilityError,
  createLocalIpcEndpointScope,
  withDeadline,
  withFileLock,
  writeFileAtomically,
} from "./reliability.js";

export { MAX_LOCAL_IPC_MESSAGE_BYTES } from "./local-ipc-frame.js";
const DEFAULT_LOCAL_IPC_REQUEST_LINE_TIMEOUT_MS = 5_000;
const DEFAULT_LOCAL_IPC_CLIENT_TIMEOUT_MS = 660_000;
const DEFAULT_LOCAL_IPC_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_LOCAL_IPC_STARTUP_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_SOCKET_PROBE_TIMEOUT_MS = 100;

export type LocalIpcEndpoint =
  | {
      readonly kind: "unix-socket";
      readonly path: string;
    }
  | {
      readonly kind: "windows-named-pipe";
      readonly path: string;
    };

type Win32LocalIpcEndpointOptions = {
  readonly platform: "win32";
  readonly rootDir: string;
  readonly name?: string;
  readonly endpointScope: string;
};

type UnixLocalIpcEndpointOptions = {
  readonly platform: Exclude<NodeJS.Platform, "win32">;
  readonly rootDir: string;
  readonly name?: string;
};

export type LocalIpcEndpointOptions =
  | Win32LocalIpcEndpointOptions
  | UnixLocalIpcEndpointOptions
  | {
      readonly platform: NodeJS.Platform;
      readonly rootDir: string;
      readonly name?: string;
      readonly endpointScope: string;
    };

export type LocalIpcServerOptions = {
  readonly endpoint: LocalIpcEndpoint;
  readonly authToken?: string;
  readonly enableProtocolNegotiation?: boolean;
  readonly requestLineTimeoutMs?: number;
  readonly startupLockTimeoutMs?: number;
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
  readonly #startupLockTimeoutMs: number;
  readonly #handleMessage: LocalIpcServerOptions["handleMessage"];
  #server: Server | null = null;
  #socketIdentity: PathIdentity | undefined;

  constructor(options: LocalIpcServerOptions) {
    this.#endpoint = options.endpoint;
    this.#authToken = options.authToken;
    this.#enableProtocolNegotiation = options.enableProtocolNegotiation ?? false;
    this.#requestLineTimeoutMs =
      options.requestLineTimeoutMs ?? DEFAULT_LOCAL_IPC_REQUEST_LINE_TIMEOUT_MS;
    this.#startupLockTimeoutMs =
      options.startupLockTimeoutMs ?? DEFAULT_LOCAL_IPC_STARTUP_LOCK_TIMEOUT_MS;
    this.#handleMessage = options.handleMessage;
  }

  async start(): Promise<void> {
    if (this.#server !== null) {
      return;
    }

    if (this.#endpoint.kind === "unix-socket") {
      await withFileLock(
        `${this.#endpoint.path}.startup.lock`,
        async () => {
          await prepareUnixSocketParent(this.#endpoint.path);
          await this.#listenOnEndpoint({ retryStaleUnixSocket: true });
        },
        { timeoutMs: this.#startupLockTimeoutMs },
      );
      return;
    }

    await this.#listenOnEndpoint({ retryStaleUnixSocket: false });
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

    if (this.#endpoint.kind === "unix-socket" && this.#socketIdentity !== undefined) {
      await unlinkOwnedSocket(this.#endpoint.path, this.#socketIdentity);
      this.#socketIdentity = undefined;
    }
  }

  async #listenOnEndpoint(options: { readonly retryStaleUnixSocket: boolean }): Promise<void> {
    try {
      await this.#listenWithNewServer();
    } catch (error) {
      if (
        !options.retryStaleUnixSocket ||
        this.#endpoint.kind !== "unix-socket" ||
        !isNodeError(error, "EADDRINUSE")
      ) {
        throw error;
      }

      await unlinkStaleUnixSocketAfterProbe(this.#endpoint.path);
      await this.#listenWithNewServer();
    }

    if (this.#endpoint.kind === "unix-socket") {
      await chmod(this.#endpoint.path, 0o600);
      this.#socketIdentity = await readPathIdentity(this.#endpoint.path);
    }
  }

  async #listenWithNewServer(): Promise<void> {
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      socket.allowHalfOpen = true;
      void this.#handleSocket(socket);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(this.#endpoint.path);
      });
    } catch (error) {
      try {
        server.close();
      } catch {
        // The server may not have reached the listening state.
      }
      throw error;
    }

    this.#server = server;
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
    const endpointScope = "endpointScope" in options ? options.endpointScope : undefined;
    if (endpointScope === undefined || endpointScope.length === 0) {
      throw new LocalIpcError(
        "SOCKET_FAILED",
        "Windows local IPC endpoints require an auth-token-derived scope.",
      );
    }
    return {
      kind: "windows-named-pipe",
      path: `\\\\.\\pipe\\firefox-cli-${name}-${endpointScope}`,
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
  options: {
    readonly authToken?: string | null;
    readonly timeoutMs?: number;
    readonly connectTimeoutMs?: number;
  } = {},
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

  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCAL_IPC_CLIENT_TIMEOUT_MS;
  const socket = await connectLocalIpcSocket(endpoint, {
    timeoutMs:
      options.connectTimeoutMs ?? Math.min(timeoutMs, DEFAULT_LOCAL_IPC_CONNECT_TIMEOUT_MS),
  });
  const rawResponse = await writeAndReadLocalIpcResponse(
    socket,
    encodedRequest,
    request.id,
    timeoutMs,
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
    readonly timeoutMs?: number;
    readonly connectTimeoutMs?: number;
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

  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCAL_IPC_CLIENT_TIMEOUT_MS;
  const socket = await connectLocalIpcSocket(endpoint, {
    timeoutMs:
      options.connectTimeoutMs ?? Math.min(timeoutMs, DEFAULT_LOCAL_IPC_CONNECT_TIMEOUT_MS),
  });
  let destroySocketOnReturn = true;
  try {
    const rawHelloResponse = await writeAndReadLocalIpcResponse(
      socket,
      encodedHello,
      request.id,
      timeoutMs,
    );
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
    const compatibility = getRequestProtocolCompatibility(request, protocolSession.protocolVersion);
    if (!compatibility.compatible) {
      destroySocketOnReturn = false;
      // The host is waiting for the second frame on this negotiated socket. End the write side
      // cleanly and let the host close after its frame-error response so it does not race a
      // client-side destroy with an EPIPE.
      socket.once("error", () => undefined);
      socket.end();
      return protocolSession.createErrorResponse(
        request.id,
        createRequestProtocolMismatchError(request, protocolSession.protocolVersion),
      ) as ResponseEnvelope<C>;
    }

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
    const rawResponse = await readLocalIpcResponse(socket, request.id, timeoutMs);
    const parsed = protocolSession.parseResponse("cli-to-host", request.command, rawResponse);
    if (!parsed.ok) {
      throw new LocalIpcError("INVALID_IPC_RESPONSE", parsed.error.message);
    }

    return parsed.value as ResponseEnvelope<C>;
  } finally {
    if (destroySocketOnReturn) {
      socket.destroy();
    }
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
    await mkdir(dirname(this.filePath), { recursive: true });
    if (process.platform !== "win32") {
      await chmod(dirname(this.filePath), 0o700);
    }
    await writeFileAtomically(this.filePath, `${token}\n`, { mode: 0o600 });
  }
}

export async function getOrCreateLocalIpcAuthToken(store: LocalIpcAuthTokenStore): Promise<string> {
  return withFileLock(`${store.filePath}.lock`, async () => {
    const stored = await store.read();
    if (stored !== null) {
      return stored;
    }

    const token = randomBytes(32).toString("base64url");
    await store.write(token);
    return token;
  });
}

export { createLocalIpcEndpointScope };

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

function connectLocalIpcSocket(
  endpoint: LocalIpcEndpoint,
  options: { readonly timeoutMs: number },
): Promise<Socket> {
  const socket = createConnection(endpoint.path);
  return withDeadline(
    new Promise<Socket>((resolve, reject) => {
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
    }),
    {
      timeoutMs: options.timeoutMs,
      message: "Timed out connecting to firefox-cli native host.",
      onTimeout: () => socket.destroy(),
    },
  ).catch((error: unknown) => {
    if (error instanceof NativeHostReliabilityError && error.code === "TRANSPORT_TIMEOUT") {
      throw new LocalIpcError("CONNECTION_FAILED", error.message, { cause: error });
    }
    throw error;
  });
}

async function writeAndReadLocalIpcResponse(
  socket: Socket,
  message: Buffer,
  fallbackRequestId: string,
  timeoutMs: number,
): Promise<unknown> {
  socket.write(message);
  return readLocalIpcResponse(socket, fallbackRequestId, timeoutMs);
}

async function readLocalIpcResponse(
  socket: Socket,
  fallbackRequestId: string,
  timeoutMs: number,
): Promise<unknown> {
  try {
    return await withDeadline(readOneJsonLine(socket), {
      timeoutMs,
      message: `Timed out waiting for firefox-cli native host response within ${timeoutMs}ms.`,
      onTimeout: () => socket.destroy(),
    });
  } catch (error) {
    if (error instanceof NativeHostReliabilityError && error.code === "TRANSPORT_TIMEOUT") {
      return createLocalIpcErrorResponse(fallbackRequestId, "TIMEOUT", error.message);
    }
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

type PathIdentity = {
  readonly dev: number;
  readonly ino: number;
};

async function prepareUnixSocketParent(socketPath: string): Promise<void> {
  const directory = dirname(socketPath);
  await mkdir(directory, { mode: 0o700, recursive: true });
  await validateCurrentUserDirectory(directory);
  await chmod(directory, 0o700);
  await validateCurrentUserDirectory(directory);
}

async function validateCurrentUserDirectory(directory: string): Promise<void> {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new LocalIpcError("SOCKET_FAILED", `IPC directory is not a real directory: ${directory}`);
  }
  validateCurrentUserOwner(
    stats.uid,
    `IPC directory is not owned by the current user: ${directory}`,
  );
  if (process.platform !== "win32" && (stats.mode & 0o777) !== 0o700) {
    await chmod(directory, 0o700);
  }
}

async function unlinkStaleUnixSocketAfterProbe(socketPath: string): Promise<void> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(socketPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  if (!stats.isSocket() || stats.isSymbolicLink()) {
    throw new LocalIpcError(
      "SOCKET_FAILED",
      `IPC endpoint exists but is not a socket: ${socketPath}`,
    );
  }
  validateCurrentUserOwner(
    stats.uid,
    `IPC endpoint is not owned by the current user: ${socketPath}`,
  );

  const probe = await probeUnixSocket(socketPath);
  if (probe === "active") {
    throw new LocalIpcError("SOCKET_FAILED", "A firefox-cli native host is already listening.");
  }

  await unlink(socketPath).catch((error: unknown) => {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  });
}

function probeUnixSocket(socketPath: string): Promise<"active" | "stale"> {
  const socket = createConnection(socketPath);
  return withDeadline(
    new Promise<"active" | "stale">((resolve) => {
      const cleanup = (): void => {
        socket.off("connect", onConnect);
        socket.off("error", onError);
      };
      const onConnect = (): void => {
        cleanup();
        socket.destroy();
        resolve("active");
      };
      const onError = (error: NodeJS.ErrnoException): void => {
        cleanup();
        socket.destroy();
        resolve(error.code === "ECONNREFUSED" || error.code === "ENOENT" ? "stale" : "active");
      };
      socket.once("connect", onConnect);
      socket.once("error", onError);
    }),
    {
      timeoutMs: DEFAULT_STALE_SOCKET_PROBE_TIMEOUT_MS,
      message: "Timed out probing existing IPC socket.",
      onTimeout: () => socket.destroy(),
    },
  ).catch(() => "active");
}

async function readPathIdentity(path: string): Promise<PathIdentity> {
  const stats = await stat(path);
  return { dev: stats.dev, ino: stats.ino };
}

async function unlinkOwnedSocket(path: string, identity: PathIdentity): Promise<void> {
  try {
    const current = await readPathIdentity(path);
    if (current.dev === identity.dev && current.ino === identity.ino) {
      await unlink(path);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function validateCurrentUserOwner(uid: number, message: string): void {
  if (typeof process.getuid !== "function") {
    return;
  }

  if (uid !== process.getuid()) {
    throw new LocalIpcError("SOCKET_FAILED", message);
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
