import {
  NATIVE_HOST_NAME,
  PendingRequestTracker,
  PROTOCOL_VERSION,
  createLocalComponentIdentity,
  createErrorResponse,
  createProtocolSession,
  createRequest,
  localProtocolVersionRange,
  parseBoundaryRequest,
  parseBoundaryResponse,
  type CommandId,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import type { BackgroundBrowserAdapter, BrowserWindowSnapshot } from "./browser-commands.js";
import { createUnconfiguredBrowserAdapter } from "./background-default-browser-adapter.js";
import {
  createProtocolStateErrorResponse,
  getMessageId,
  getMessageProtocolVersion,
  getNegotiatedNativeSession,
  isRequestCommand,
  isResponseLike,
  type NativeProtocolState,
} from "./background-native-protocol-state.js";
import { handleRequest } from "./background-request-handler.js";

export type { BackgroundBrowserAdapter, BrowserWindowSnapshot };

const DEFAULT_PENDING_REQUEST_TIMEOUT_MS = 660_000;

export type NativePortLike = {
  readonly onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
  readonly onDisconnect: {
    addListener(listener: (error?: { readonly message?: string }) => void): void;
  };
  postMessage(message: unknown): void;
};

export type BackgroundRuntimeAdapter = {
  connectNative(name: string): NativePortLike;
};

export type BackgroundStorageAdapter = {
  getPairToken(): Promise<string | null>;
  setPairToken(token: string | null): Promise<void>;
};

export type ExtensionStatus = {
  readonly connected: boolean;
  readonly approved: boolean;
  readonly lastError?: string;
  readonly diagnostics: string;
};

export class FirefoxCliBackgroundController {
  readonly #runtime: BackgroundRuntimeAdapter;
  readonly #browserAdapter: BackgroundBrowserAdapter;
  readonly #storageAdapter: BackgroundStorageAdapter;
  readonly #productVersion: string;
  readonly #reconnectDelaysMs: readonly number[];
  readonly #scheduleTimer: (callback: () => void, delayMs: number) => void;
  readonly #pendingCommands: PendingRequestTracker<CommandId, ResponseEnvelope>;
  #port: NativePortLike | null = null;
  #connected = false;
  #approved = false;
  #pairToken: string | null = null;
  #approvalRevision = 0;
  #reconnectAttempt = 0;
  #reconnectScheduled = false;
  #lastError: string | undefined;
  #nativeProtocolState: NativeProtocolState = { state: "disconnected" };
  #stopped = false;
  constructor(options: {
    readonly connectNative: BackgroundRuntimeAdapter["connectNative"];
    readonly browserAdapter?: BackgroundBrowserAdapter;
    readonly storageAdapter?: BackgroundStorageAdapter;
    readonly productVersion: string;
    readonly reconnectDelaysMs?: readonly number[];
    readonly scheduleTimer?: (callback: () => void, delayMs: number) => void;
    readonly requestTimeoutMs?: number;
  }) {
    this.#runtime = {
      connectNative: options.connectNative,
    };
    this.#browserAdapter = options.browserAdapter ?? createUnconfiguredBrowserAdapter();
    this.#storageAdapter = options.storageAdapter ?? {
      getPairToken: async () => null,
      setPairToken: async () => undefined,
    };
    this.#productVersion = options.productVersion;
    this.#reconnectDelaysMs = options.reconnectDelaysMs ?? [250, 1000, 5000, 10_000];
    this.#scheduleTimer =
      options.scheduleTimer ??
      ((callback, delayMs) => {
        setTimeout(callback, delayMs);
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
    if (this.#stopped) {
      return;
    }
    const approvalLoadRevision = this.#approvalRevision;
    void this.#storageAdapter
      .getPairToken()
      .then((pairToken) => {
        if (this.#approvalRevision === approvalLoadRevision) {
          this.#pairToken = pairToken;
          this.#approved = pairToken !== null;
          if (pairToken !== null && this.#connected) {
            this.#postHello();
          }
        }
      })
      .catch((error: unknown) => {
        this.#lastError = error instanceof Error ? error.message : String(error);
      });

    this.#connectNative();
  }

  getStatus(): ExtensionStatus {
    return {
      connected: this.#connected,
      approved: this.#approved,
      ...(this.#lastError === undefined ? {} : { lastError: this.#lastError }),
      diagnostics: JSON.stringify(
        {
          connected: this.#connected,
          approved: this.#approved,
          lastError: this.#lastError,
          nativeHostName: NATIVE_HOST_NAME,
          protocolVersion: PROTOCOL_VERSION,
          nativeProtocolState: this.#nativeProtocolState.state,
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
      this.#approvalRevision += 1;
      const request = createRequest("pair.approve", {});
      const response = await this.#sendNativeRequest(request);
      if (response.ok) {
        this.#pairToken = response.result.token;
        this.#approved = true;
        this.#lastError = undefined;
        await this.#storageAdapter.setPairToken(response.result.token);
      } else {
        this.#approved = false;
        this.#lastError = response.error.message;
      }
      return this.getStatus();
    }

    if (message.type === "firefox-cli:reset") {
      this.#approvalRevision += 1;
      if (this.#connected) {
        const response = await this.#sendNativeRequest(createRequest("pair.reset", {}));
        if (!response.ok) {
          this.#lastError = response.error.message;
          return this.getStatus();
        }
      }
      this.#pairToken = null;
      this.#approved = false;
      this.#lastError = undefined;
      await this.#storageAdapter.setPairToken(null);
      return this.getStatus();
    }

    return undefined;
  }

  stop(): void {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    this.#approvalRevision += 1;
    this.#connected = false;
    this.#port = null;
    this.#reconnectScheduled = false;
    this.#nativeProtocolState = { state: "disconnected" };
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
        ...(this.#pairToken === null ? {} : { pairToken: this.#pairToken }),
      },
      undefined,
      localProtocolVersionRange.protocolMin,
    );
    this.#nativeProtocolState = { state: "negotiating" };
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

  #connectNative(): void {
    if (this.#stopped) {
      return;
    }
    try {
      this.#port = this.#runtime.connectNative(NATIVE_HOST_NAME);
      this.#connected = true;
      this.#nativeProtocolState = { state: "negotiating" };
      this.#reconnectAttempt = 0;
      this.#reconnectScheduled = false;
      this.#lastError = undefined;
      this.#port.onMessage.addListener((message) => {
        if (this.#stopped) {
          return;
        }
        void this.#handleNativeMessage(message);
      });
      this.#port.onDisconnect.addListener((error) => {
        if (this.#stopped) {
          return;
        }
        this.#connected = false;
        this.#port = null;
        this.#nativeProtocolState = { state: "disconnected" };
        this.#lastError = error?.message ?? "Native host disconnected.";
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
        this.#scheduleReconnect();
      });
      this.#postHello();
    } catch (error) {
      this.#connected = false;
      this.#port = null;
      this.#lastError = error instanceof Error ? error.message : String(error);
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectScheduled || this.#reconnectDelaysMs.length === 0) {
      return;
    }

    const delay =
      this.#reconnectDelaysMs[Math.min(this.#reconnectAttempt, this.#reconnectDelaysMs.length - 1)];
    this.#reconnectAttempt += 1;
    this.#reconnectScheduled = true;
    this.#scheduleTimer(() => {
      if (this.#stopped) {
        return;
      }
      this.#reconnectScheduled = false;
      this.#connectNative();
    }, delay ?? 0);
  }

  #sendNativeRequest<C extends CommandId>(
    request: RequestEnvelope<C>,
  ): Promise<ResponseEnvelope<C>> {
    if (this.#stopped) {
      return Promise.resolve(
        createErrorResponse(
          request.id,
          {
            code: "NATIVE_HOST_UNAVAILABLE",
            message: "Extension background is stopped.",
          },
          request.protocolVersion,
        ),
      ) as Promise<ResponseEnvelope<C>>;
    }

    if (this.#port === null || !this.#connected) {
      return Promise.resolve(
        createErrorResponse(
          request.id,
          {
            code: "EXTENSION_NOT_CONNECTED",
            message: "Native host is not connected.",
          },
          request.protocolVersion,
        ),
      ) as Promise<ResponseEnvelope<C>>;
    }

    const session =
      request.command === "hello"
        ? undefined
        : getNegotiatedNativeSession(this.#nativeProtocolState);
    if (session !== undefined && !session.ok) {
      return Promise.resolve(
        createErrorResponse(request.id, session.error, request.protocolVersion),
      ) as Promise<ResponseEnvelope<C>>;
    }

    const wireRequest = session === undefined ? request : session.value.withRequestVersion(request);
    const tracked = this.#pendingCommands.track(wireRequest);
    if (!tracked.ok) {
      return Promise.resolve(tracked.value as ResponseEnvelope<C>);
    }

    try {
      this.#port.postMessage(wireRequest);
    } catch {
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

    return tracked.promise as Promise<ResponseEnvelope<C>>;
  }

  async #handleNativeMessage(message: unknown): Promise<void> {
    if (this.#stopped) {
      return;
    }
    if (isResponseLike(message)) {
      const command = this.#pendingCommands.getCommand(message.id);
      if (command === undefined) {
        return;
      }
      const response =
        command === "hello"
          ? parseBoundaryResponse("host-to-extension", command, message, {
              hello: {
                local: localProtocolVersionRange,
                expectedPeerComponent: "native-host",
              },
            })
          : parseBoundaryResponse("host-to-extension", command, message, {
              protocolVersion:
                this.#nativeProtocolState.state === "negotiated"
                  ? this.#nativeProtocolState.session.protocolVersion
                  : localProtocolVersionRange.protocolMax,
            });
      if (!response.ok) {
        this.#lastError = response.error.message;
        if (command === "hello") {
          this.#nativeProtocolState = { state: "incompatible", error: response.error };
        }
        this.#pendingCommands.settle(
          message.id,
          createErrorResponse(message.id, response.error, getMessageProtocolVersion(message)),
        );
        return;
      }
      let helloPairingError: string | undefined;
      if (command === "hello") {
        if (response.value.ok) {
          this.#nativeProtocolState = {
            state: "negotiated",
            session: createProtocolSession(response.value.protocolVersion),
          };
          const helloResponse = response.value as Extract<ResponseEnvelope<"hello">, { ok: true }>;
          const pairing = helloResponse.result.pairing;
          if (pairing !== undefined) {
            this.#approved = pairing.approved;
            if (
              !pairing.approved &&
              pairing.status !== "invalid-pair-state" &&
              this.#pairToken !== null
            ) {
              this.#pairToken = null;
              await this.#storageAdapter.setPairToken(null);
            }
            if (!pairing.approved && pairing.status === "invalid-pair-state") {
              helloPairingError = pairing.message ?? "Native host pair state is invalid.";
            }
          }
        } else {
          this.#nativeProtocolState = {
            state: "incompatible",
            error: response.value.error,
          };
        }
      }
      this.#pendingCommands.settle(message.id, response.value);
      this.#lastError = helloPairingError;
      return;
    }

    const request = parseBoundaryRequest("host-to-extension", message, {
      ...(this.#nativeProtocolState.state === "negotiated"
        ? { protocolVersion: this.#nativeProtocolState.session.protocolVersion }
        : {}),
      hello: {
        local: localProtocolVersionRange,
        expectedPeerComponent: "native-host",
      },
    });
    if (!request.ok) {
      const response = createProtocolStateErrorResponse(
        this.#nativeProtocolState,
        getMessageId(message),
        request.error,
      );
      if (isRequestCommand(message, "hello") || request.error.code === "VERSION_MISMATCH") {
        this.#nativeProtocolState = { state: "incompatible", error: request.error };
      }
      this.#port?.postMessage(response);
      return;
    }

    const protocolSession = createProtocolSession(request.value.protocolVersion);
    if (request.value.command === "hello") {
      this.#nativeProtocolState = { state: "negotiated", session: protocolSession };
    } else if (this.#nativeProtocolState.state === "incompatible") {
      this.#port?.postMessage(
        protocolSession.createErrorResponse(request.value.id, this.#nativeProtocolState.error),
      );
      return;
    } else if (this.#nativeProtocolState.state !== "negotiated") {
      this.#port?.postMessage(
        protocolSession.createErrorResponse(request.value.id, {
          code: "NATIVE_HOST_UNAVAILABLE",
          message: "Native host protocol negotiation has not completed.",
        }),
      );
      return;
    }

    this.#port?.postMessage(
      await handleRequest(
        request.value,
        this.#productVersion,
        this.#approved,
        this.#browserAdapter,
        protocolSession,
      ),
    );
  }
}
