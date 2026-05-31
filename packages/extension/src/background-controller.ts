import {
  type CommandId,
  createErrorResponse,
  createErrorResponseForRequest,
  createLocalComponentIdentity,
  createRequest,
  localProtocolVersionRange,
  NATIVE_HOST_NAME,
  PendingRequestTracker,
  PROTOCOL_VERSION,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import type { BackgroundRuntimeAdapter, BackgroundStorageAdapter, ExtensionStatus } from "./background-controller-types.js";
import { createUnconfiguredBrowserAdapter } from "./background-default-browser-adapter.js";
import { NativeConnectionManager } from "./background-native-connection.js";
import { isResponseLike } from "./background-native-protocol-state.js";
import { NativeSessionService } from "./background-native-session.js";
import { PairingStateService } from "./background-pairing-service.js";
import { BackgroundRequestForwarder } from "./background-request-forwarder.js";
import type { BackgroundBrowserAdapter, BrowserWindowSnapshot } from "./browser-commands.js";

export type {
  BackgroundRuntimeAdapter,
  BackgroundStorageAdapter,
  ExtensionStatus,
  NativePortLike,
} from "./background-controller-types.js";
export type { BackgroundBrowserAdapter, BrowserWindowSnapshot };

const DEFAULT_PENDING_REQUEST_TIMEOUT_MS = 660_000;

export class FirefoxCliBackgroundController {
  readonly #connection: NativeConnectionManager;
  readonly #pairing: PairingStateService;
  readonly #nativeSession = new NativeSessionService();
  readonly #requestForwarder: BackgroundRequestForwarder;
  readonly #productVersion: string;
  readonly #pendingCommands: PendingRequestTracker<CommandId, ResponseEnvelope>;
  #lastError: string | undefined;

  constructor(options: {
    readonly connectNative: BackgroundRuntimeAdapter["connectNative"];
    readonly browserAdapter?: BackgroundBrowserAdapter;
    readonly storageAdapter?: BackgroundStorageAdapter;
    readonly productVersion: string;
    readonly reconnectDelaysMs?: readonly number[];
    readonly scheduleTimer?: (callback: () => void, delayMs: number) => void;
    readonly requestTimeoutMs?: number;
  }) {
    const browserAdapter = options.browserAdapter ?? createUnconfiguredBrowserAdapter();
    const storageAdapter = options.storageAdapter ?? {
      getPairToken: async () => null,
      setPairToken: async () => undefined,
    };
    this.#productVersion = options.productVersion;
    this.#pairing = new PairingStateService(storageAdapter);
    this.#requestForwarder = new BackgroundRequestForwarder({
      browserAdapter,
      productVersion: this.#productVersion,
    });
    this.#connection = new NativeConnectionManager({
      connectNative: options.connectNative,
      reconnectDelaysMs: options.reconnectDelaysMs ?? [250, 1000, 5000, 10_000],
      scheduleTimer:
        options.scheduleTimer ??
        ((callback, delayMs) => {
          setTimeout(callback, delayMs);
        }),
      events: {
        onConnect: () => {
          this.#nativeSession.beginNegotiation();
          this.#lastError = undefined;
          this.#postHello();
        },
        onMessage: (message) => {
          void this.#handleNativeMessage(message);
        },
        onDisconnect: (message) => {
          this.#nativeSession.markDisconnected();
          this.#lastError = message;
          this.#drainPendingOnDisconnect();
        },
        onConnectError: (message) => {
          this.#nativeSession.markDisconnected();
          this.#lastError = message;
        },
      },
    });

    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_PENDING_REQUEST_TIMEOUT_MS;
    this.#pendingCommands = new PendingRequestTracker<CommandId, ResponseEnvelope>({
      timeoutMs: requestTimeoutMs,
      onDuplicate: (request) =>
        createErrorResponse(
          request.id,
          {
            code: "INVALID_ENVELOPE",
            message: `Request ID is already pending: ${request.id}`,
          },
          request.protocolVersion ?? localProtocolVersionRange.protocolMax,
        ),
      onTimeout: (request) =>
        createErrorResponse(
          request.id,
          {
            code: "TIMEOUT",
            message: `Timed out waiting for native host response to ${request.command}.`,
          },
          request.protocolVersion ?? localProtocolVersionRange.protocolMax,
        ),
    });
  }

  start(): void {
    if (this.#connection.stopped) {
      return;
    }
    void this.#pairing
      .loadStoredPairToken()
      .then(({ applied, pairToken }) => {
        if (applied && pairToken !== null && this.#connection.connected) {
          this.#postHello();
        }
      })
      .catch((error: unknown) => {
        this.#lastError = error instanceof Error ? error.message : String(error);
      });

    this.#connection.start();
  }

  getStatus(): ExtensionStatus {
    return {
      connected: this.#connection.connected,
      approved: this.#pairing.approved,
      ...(this.#lastError === undefined ? {} : { lastError: this.#lastError }),
      diagnostics: JSON.stringify(
        {
          connected: this.#connection.connected,
          approved: this.#pairing.approved,
          lastError: this.#lastError,
          nativeHostName: NATIVE_HOST_NAME,
          protocolVersion: PROTOCOL_VERSION,
          nativeProtocolState: this.#nativeSession.stateName,
        },
        null,
        2,
      ),
    };
  }

  async handleRuntimeMessage(message: { readonly type?: string }): Promise<unknown> {
    if (message.type === "firefox-cli:get-status") {
      return this.getStatus();
    }

    if (message.type === "firefox-cli:approve") {
      this.#pairing.beginMutation();
      const request = createRequest("pair.approve", {});
      const response = await this.#sendNativeRequest(request);
      if (response.ok) {
        await this.#pairing.approve(response.result.token);
        this.#lastError = undefined;
      } else {
        this.#pairing.markRejected();
        this.#lastError = response.error.message;
      }
      return this.getStatus();
    }

    if (message.type === "firefox-cli:reset") {
      this.#pairing.beginMutation();
      if (this.#connection.connected) {
        const response = await this.#sendNativeRequest(createRequest("pair.reset", {}));
        if (!response.ok) {
          this.#lastError = response.error.message;
          return this.getStatus();
        }
      }
      await this.#pairing.reset();
      this.#lastError = undefined;
      return this.getStatus();
    }

    return undefined;
  }

  stop(): void {
    if (this.#connection.stopped) {
      return;
    }
    this.#connection.stop();
    this.#pairing.beginMutation();
    this.#nativeSession.markDisconnected();
    this.#lastError = "Extension background stopped.";
    this.#pendingCommands.drain((request) =>
      createErrorResponse(
        request.id,
        {
          code: "NATIVE_HOST_UNAVAILABLE",
          message: "Extension background stopped before the native host responded.",
        },
        request.protocolVersion ?? localProtocolVersionRange.protocolMax,
      ),
    );
  }

  #postHello(): void {
    const request = createRequest(
      "hello",
      {
        ...createLocalComponentIdentity("extension", this.#productVersion),
        productVersion: this.#productVersion,
        protocolMin: localProtocolVersionRange.protocolMin,
        protocolMax: localProtocolVersionRange.protocolMax,
        ...(this.#pairing.pairToken === null ? {} : { pairToken: this.#pairing.pairToken }),
      },
      undefined,
      localProtocolVersionRange.protocolMin,
    );
    this.#nativeSession.beginNegotiation();
    this.#sendNativeRequest(request)
      .then((response) => {
        if (!response.ok) {
          this.#lastError = response.error.message;
        }
      })
      .catch((error: unknown) => {
        this.#lastError = error instanceof Error ? error.message : String(error);
      });
  }

  async #sendNativeRequest(request: RequestEnvelope<"hello">): Promise<ResponseEnvelope<"hello">>;
  async #sendNativeRequest(request: RequestEnvelope<"pair.approve">): Promise<ResponseEnvelope<"pair.approve">>;
  async #sendNativeRequest(request: RequestEnvelope<"pair.reset">): Promise<ResponseEnvelope<"pair.reset">>;
  async #sendNativeRequest(request: RequestEnvelope): Promise<ResponseEnvelope> {
    if (this.#connection.stopped) {
      return createErrorResponseForRequest(request, {
        code: "NATIVE_HOST_UNAVAILABLE",
        message: "Extension background is stopped.",
      });
    }

    if (!this.#connection.connected) {
      return createErrorResponseForRequest(request, {
        code: "EXTENSION_NOT_CONNECTED",
        message: "Native host is not connected.",
      });
    }

    const session = request.command === "hello" ? undefined : this.#nativeSession.getNegotiatedSession();
    if (session !== undefined && !session.ok) {
      return createErrorResponseForRequest(request, session.error);
    }

    const wireRequest = session === undefined ? request : session.value.withRequestVersion(request);
    const tracked = this.#pendingCommands.track(wireRequest);
    if (!tracked.ok) {
      return tracked.value;
    }

    if (!this.#connection.postMessage(wireRequest)) {
      this.#pendingCommands.settle(
        wireRequest.id,
        createErrorResponse(
          wireRequest.id,
          {
            code: "NATIVE_HOST_UNAVAILABLE",
            message: "Failed to send request to the native host.",
          },
          wireRequest.protocolVersion,
        ),
      );
    }

    return tracked.promise;
  }

  async #handleNativeMessage(message: unknown): Promise<void> {
    if (this.#connection.stopped) {
      return;
    }
    if (isResponseLike(message)) {
      await this.#handleNativeResponse(message);
      return;
    }

    await this.#handleNativeRequest(message);
  }

  async #handleNativeResponse(message: { readonly id: string }): Promise<void> {
    const command = this.#pendingCommands.getCommand(message.id);
    if (command === undefined) {
      return;
    }
    const response = this.#nativeSession.parseResponse(command, message);
    if (!response.ok) {
      this.#lastError = response.error.message;
      this.#nativeSession.applyResponseParseFailure(command, response.error);
      this.#pendingCommands.settle(message.id, createErrorResponse(message.id, response.error, this.#nativeSession.getMessageProtocolVersion(message)));
      return;
    }

    let helloPairingError: string | undefined;
    if (command === "hello") {
      if (isHelloResponse(command, response.value)) {
        this.#nativeSession.applyHelloResponse(response.value);
        if (response.value.ok) {
          helloPairingError = await this.#pairing.applyHelloPairing(response.value.result.pairing);
        }
      }
    }
    this.#pendingCommands.settle(message.id, response.value);
    this.#lastError = helloPairingError;
  }

  async #handleNativeRequest(message: unknown): Promise<void> {
    const request = this.#nativeSession.parseRequest(message);
    if (!request.ok) {
      const response = this.#nativeSession.createStateErrorResponse(message, request.error);
      this.#nativeSession.markRequestIncompatibleIfNeeded(message, request.error.code, request.error);
      this.#connection.postMessage(response);
      return;
    }

    const prepared = this.#nativeSession.prepareRequest(request.value);
    if (!prepared.ok) {
      this.#connection.postMessage(prepared.response);
      return;
    }

    this.#connection.postMessage(await this.#requestForwarder.forward(request.value, this.#pairing.approved, prepared.protocolSession));
  }

  #drainPendingOnDisconnect(): void {
    this.#pendingCommands.drain((request) =>
      createErrorResponse(
        request.id,
        {
          code: "NATIVE_HOST_UNAVAILABLE",
          message: "Native host disconnected before responding.",
        },
        request.protocolVersion ?? localProtocolVersionRange.protocolMax,
      ),
    );
  }
}

function isHelloResponse(command: CommandId, response: ResponseEnvelope): response is ResponseEnvelope<"hello"> {
  return command === "hello" && (!response.ok || ("accepted" in response.result && "peer" in response.result));
}
