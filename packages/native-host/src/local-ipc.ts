import { chmod } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import {
  createProtocolSession,
  localProtocolVersionRange,
  parseBoundaryResponse,
} from "@firefox-cli/protocol";
import {
  getRequestId,
  getRequestIdFromFrameError,
  isHelloRequestLike,
  unwrapAuthorizedMessage,
} from "./local-ipc-auth.js";
import {
  createLocalIpcErrorResponse,
  endSocketWithResponse,
  endSocketWithResponseSync,
  frameErrorToProtocolError,
  isMessageTooLargeError,
  LocalIpcFrameError,
  readOneJsonLine,
  writeSocketJsonLine,
} from "./local-ipc-frame.js";
import { withFileLock } from "./reliability.js";
import type { LocalIpcEndpoint, LocalIpcServerOptions } from "./local-ipc-types.js";
import {
  isNodeError,
  prepareUnixSocketParent,
  readPathIdentity,
  unlinkOwnedSocket,
  unlinkStaleUnixSocketAfterProbe,
  type PathIdentity,
} from "./local-ipc-unix.js";

export { MAX_LOCAL_IPC_MESSAGE_BYTES } from "./local-ipc-frame.js";
export {
  FileLocalIpcAuthTokenStore,
  getOrCreateLocalIpcAuthToken,
} from "./local-ipc-auth.js";
export { sendLocalIpcRequest, sendNegotiatedLocalIpcRequest } from "./local-ipc-client.js";
export { createLocalIpcEndpointScope, planLocalIpcEndpoint } from "./local-ipc-endpoint.js";
export { LocalIpcError } from "./local-ipc-types.js";
export type {
  LocalIpcAuthTokenStore,
  LocalIpcEndpoint,
  LocalIpcEndpointOptions,
  LocalIpcServerOptions,
} from "./local-ipc-types.js";

const DEFAULT_LOCAL_IPC_REQUEST_LINE_TIMEOUT_MS = 5_000;
const DEFAULT_LOCAL_IPC_STARTUP_LOCK_TIMEOUT_MS = 5_000;

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
