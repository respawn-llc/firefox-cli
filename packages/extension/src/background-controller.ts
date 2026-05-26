import {
  NATIVE_HOST_NAME,
  PROTOCOL_VERSION,
  createErrorResponse,
  createOkResponse,
  createRequest,
  kernelCapabilities,
  parseBoundaryRequest,
  parseBoundaryResponse,
  type CommandId,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import {
  handleBrowserRequest,
  type BackgroundBrowserAdapter,
  type BrowserWindowSnapshot,
} from "./browser-commands.js";

export type { BackgroundBrowserAdapter, BrowserWindowSnapshot };

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
  #port: NativePortLike | null = null;
  #connected = false;
  #approved = false;
  #pairToken: string | null = null;
  #approvalRevision = 0;
  #reconnectAttempt = 0;
  #reconnectScheduled = false;
  #lastError: string | undefined;
  readonly #pendingCommands = new Map<
    string,
    {
      readonly command: CommandId;
      resolve?(response: ResponseEnvelope): void;
    }
  >();

  constructor(options: {
    readonly connectNative: BackgroundRuntimeAdapter["connectNative"];
    readonly browserAdapter?: BackgroundBrowserAdapter;
    readonly storageAdapter?: BackgroundStorageAdapter;
    readonly productVersion: string;
    readonly reconnectDelaysMs?: readonly number[];
    readonly scheduleTimer?: (callback: () => void, delayMs: number) => void;
  }) {
    this.#runtime = {
      connectNative: options.connectNative,
    };
    this.#browserAdapter = options.browserAdapter ?? {
      listWindows: async () => [],
      createTab: async () => {
        throw new Error("Browser adapter is not configured.");
      },
      selectTab: async () => {
        throw new Error("Browser adapter is not configured.");
      },
      closeTab: async () => {
        throw new Error("Browser adapter is not configured.");
      },
      createWindow: async () => {
        throw new Error("Browser adapter is not configured.");
      },
      focusWindow: async () => {
        throw new Error("Browser adapter is not configured.");
      },
      closeWindow: async () => {
        throw new Error("Browser adapter is not configured.");
      },
      navigateTab: async () => {
        throw new Error("Browser adapter is not configured.");
      },
      goBack: async () => {
        throw new Error("Browser adapter is not configured.");
      },
      goForward: async () => {
        throw new Error("Browser adapter is not configured.");
      },
      reload: async () => {
        throw new Error("Browser adapter is not configured.");
      },
      sendContentRequest: async () => {
        throw new Error("Browser adapter is not configured.");
      },
      executeEval: async () => {
        throw new Error("Browser adapter is not configured.");
      },
    };
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
  }

  start(): void {
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

  #postHello(): void {
    const request = createRequest("hello", {
      component: "extension",
      productName: "firefox-cli",
      productVersion: this.#productVersion,
      protocolMin: PROTOCOL_VERSION,
      protocolMax: PROTOCOL_VERSION,
      features: [],
      ...(this.#pairToken === null ? {} : { pairToken: this.#pairToken }),
    });
    this.#sendNativeRequest(request).catch((error: unknown) => {
      this.#lastError = error instanceof Error ? error.message : String(error);
    });
  }

  #connectNative(): void {
    try {
      this.#port = this.#runtime.connectNative(NATIVE_HOST_NAME);
      this.#connected = true;
      this.#reconnectAttempt = 0;
      this.#reconnectScheduled = false;
      this.#lastError = undefined;
      this.#port.onMessage.addListener((message) => {
        void this.#handleNativeMessage(message);
      });
      this.#port.onDisconnect.addListener((error) => {
        this.#connected = false;
        this.#port = null;
        this.#lastError = error?.message ?? "Native host disconnected.";
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
    if (this.#reconnectScheduled || this.#reconnectDelaysMs.length === 0) {
      return;
    }

    const delay =
      this.#reconnectDelaysMs[Math.min(this.#reconnectAttempt, this.#reconnectDelaysMs.length - 1)];
    this.#reconnectAttempt += 1;
    this.#reconnectScheduled = true;
    this.#scheduleTimer(() => {
      this.#reconnectScheduled = false;
      this.#connectNative();
    }, delay ?? 0);
  }

  #sendNativeRequest<C extends CommandId>(
    request: RequestEnvelope<C>,
  ): Promise<ResponseEnvelope<C>> {
    if (this.#port === null || !this.#connected) {
      return Promise.resolve(
        createErrorResponse(request.id, {
          code: "EXTENSION_NOT_CONNECTED",
          message: "Native host is not connected.",
        }),
      ) as Promise<ResponseEnvelope<C>>;
    }

    return new Promise<ResponseEnvelope<C>>((resolve) => {
      this.#pendingCommands.set(request.id, {
        command: request.command,
        resolve: (response) => resolve(response as ResponseEnvelope<C>),
      });
      this.#port?.postMessage(request);
    });
  }

  async #handleNativeMessage(message: unknown): Promise<void> {
    if (isResponseLike(message)) {
      const pending = this.#pendingCommands.get(message.id);
      if (pending === undefined) {
        this.#lastError = `Native host returned a response for unknown request ID: ${message.id}`;
        return;
      }
      this.#pendingCommands.delete(message.id);
      const response = parseBoundaryResponse("host-to-extension", pending.command, message);
      if (!response.ok) {
        this.#lastError = response.error.message;
        pending.resolve?.(createErrorResponse(message.id, response.error));
        return;
      }
      if (pending.command === "hello" && response.value.ok) {
        const helloResponse = response.value as Extract<ResponseEnvelope<"hello">, { ok: true }>;
        const pairing = helloResponse.result.pairing;
        if (pairing !== undefined) {
          this.#approved = pairing.approved;
          if (!pairing.approved && this.#pairToken !== null) {
            this.#pairToken = null;
            await this.#storageAdapter.setPairToken(null);
          }
        }
      }
      pending.resolve?.(response.value);
      this.#lastError = undefined;
      return;
    }

    const request = parseBoundaryRequest("host-to-extension", message);
    if (!request.ok) {
      this.#port?.postMessage(createErrorResponse("invalid-request", request.error));
      return;
    }

    this.#port?.postMessage(
      await handleRequest(
        request.value,
        this.#productVersion,
        this.#approved,
        this.#browserAdapter,
      ),
    );
  }
}

function handleRequest(
  request: RequestEnvelope,
  productVersion: string,
  approved: boolean,
  browserAdapter: BackgroundBrowserAdapter,
): Promise<ResponseEnvelope> | ResponseEnvelope {
  if (request.command === "hello") {
    return createOkResponse(request, {
      accepted: true,
      negotiatedProtocolVersion: PROTOCOL_VERSION,
      peer: {
        component: "extension",
        productName: "firefox-cli",
        productVersion,
        protocolMin: PROTOCOL_VERSION,
        protocolMax: PROTOCOL_VERSION,
        features: [],
      },
    });
  }

  if (request.command === "pair.approve" || request.command === "pair.reset") {
    return createErrorResponse(request.id, {
      code: "UNSUPPORTED_CAPABILITY",
      message: "Pairing commands are handled by the native host.",
    });
  }

  if (!approved) {
    return createErrorResponse(request.id, {
      code: "NOT_APPROVED",
      message: "Approve firefox-cli in the extension popup before running CLI commands.",
    });
  }

  if (request.command === "capabilities") {
    return createOkResponse(request, { capabilities: [...kernelCapabilities] });
  }

  if (request.command === "noop") {
    return createOkResponse(request, { ok: true });
  }

  return handleBrowserRequest(request, browserAdapter);
}

function isResponseLike(message: unknown): message is { readonly id: string } {
  return (
    typeof message === "object" &&
    message !== null &&
    "id" in message &&
    "ok" in message &&
    typeof message.id === "string"
  );
}
