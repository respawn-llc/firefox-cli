import {
  createOkResponse,
  createRequest,
  isPrivilegeSensitiveRequest,
  kernelCapabilities,
} from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import {
  FirefoxCliBackgroundController,
  type BackgroundBrowserAdapter,
  type BrowserWindowSnapshot,
  type NativePortLike,
} from "./background-controller.js";

describe("FirefoxCliBackgroundController", () => {
  it("connects to the native host and sends hello", () => {
    const port = new FakeNativePort();
    const controller = new FirefoxCliBackgroundController({
      connectNative: (name) => {
        expect(name).toBe("firefox_cli");
        return port;
      },
      productVersion: "0.0.0",
    });

    controller.start();

    expect(controller.getStatus()).toMatchObject({ connected: true, approved: false });
    expect(port.messages[0]).toMatchObject({
      command: "hello",
      params: {
        component: "extension",
      },
    });
  });

  it("accepts valid hello responses regardless of request ID shape", async () => {
    const port = new FakeNativePort();
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
    });
    controller.start();
    const hello = port.messages[0] as ReturnType<typeof createRequest<"hello">>;

    port.emitMessage(
      createOkResponse(hello, {
        accepted: true,
        negotiatedProtocolVersion: 1,
        peer: {
          component: "native-host",
          productName: "firefox-cli",
          productVersion: "0.0.0",
          protocolMin: 1,
          protocolMax: 1,
          features: [],
        },
      }),
    );
    await Promise.resolve();

    expect(controller.getStatus().lastError).toBeUndefined();
  });

  it("answers native-host capability and no-op requests", async () => {
    const port = new FakeNativePort();
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
    });
    controller.start();
    await approveWithNativeHost(controller, port);

    const capabilities = createRequest("capabilities", {}, "request-1");
    port.emitMessage(capabilities);
    const noop = createRequest("noop", {}, "request-2");
    port.emitMessage(noop);
    await Promise.resolve();

    expect(port.messages.slice(2)).toEqual([
      {
        protocolVersion: capabilities.protocolVersion,
        id: "request-1",
        ok: true,
        result: {
          capabilities: [...kernelCapabilities],
        },
      },
      {
        protocolVersion: noop.protocolVersion,
        id: "request-2",
        ok: true,
        result: {
          ok: true,
        },
      },
    ]);
  });

  it("lists tabs through the injected Firefox browser adapter", async () => {
    const port = new FakeNativePort();
    const controller = new FirefoxCliBackgroundController({
      browserAdapter: {
        ...createTestBrowserAdapter([
          {
            id: 7,
            focused: true,
            private: false,
            tabs: [
              {
                id: 42,
                index: 0,
                active: true,
                title: "Example",
                url: "https://example.com/",
                windowId: 7,
                private: false,
              },
            ],
          },
        ]),
      },
      connectNative: () => port,
      productVersion: "0.0.0",
    });
    controller.start();
    await approveWithNativeHost(controller, port);

    const request = createRequest("tabs.list", {}, "request-1");
    port.emitMessage(request);
    await flushPromises();

    expect(port.messages[2]).toMatchObject({
      protocolVersion: request.protocolVersion,
      id: "request-1",
      ok: true,
      result: {
        target: {
          windowId: 7,
          tabId: 42,
        },
        tabs: [
          {
            id: 42,
            index: 0,
            active: true,
            title: "Example",
            url: "https://example.com/",
            windowId: 7,
            private: false,
          },
        ],
      },
    });
  });

  it("rejects native-host requests before popup approval", async () => {
    const port = new FakeNativePort();
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
    });
    controller.start();
    await completeNativeHello(port);

    const noop = createRequest("noop", {}, "request-1");
    port.emitMessage(noop);
    await Promise.resolve();

    expect(port.messages[1]).toEqual({
      protocolVersion: noop.protocolVersion,
      id: "request-1",
      ok: false,
      error: {
        code: "NOT_APPROVED",
        message: "Approve firefox-cli in the extension popup before running CLI commands.",
      },
    });
  });

  it("gates unapproved privilege-sensitive native-host requests before browser handlers", async () => {
    const port = new FakeNativePort();
    const browserCalls: string[] = [];
    const controller = new FirefoxCliBackgroundController({
      browserAdapter: createTestBrowserAdapter(
        [
          {
            id: 7,
            focused: true,
            private: false,
            tabs: [
              {
                id: 42,
                index: 0,
                active: true,
                title: "Example",
                url: "https://example.com/",
                windowId: 7,
                private: false,
              },
            ],
          },
        ],
        {
          listWindows: async () => {
            browserCalls.push("listWindows");
            return [];
          },
          executeEval: async () => {
            browserCalls.push("executeEval");
            return {
              ok: true,
              value: { type: "json", value: "unreachable" },
              elapsedMs: 1,
            };
          },
        },
      ),
      connectNative: () => port,
      productVersion: "0.0.0",
    });
    controller.start();
    await completeNativeHello(port);

    const request = createRequest("eval", { script: "document.title", source: "argv" }, "sensitive-request");
    expect(isPrivilegeSensitiveRequest(request)).toBe(true);
    port.emitMessage(request);
    await flushPromises();

    expect(port.messages[1]).toEqual({
      protocolVersion: request.protocolVersion,
      id: "sensitive-request",
      ok: false,
      error: {
        code: "NOT_APPROVED",
        message: "Approve firefox-cli in the extension popup before running CLI commands.",
      },
    });
    expect(browserCalls).toEqual([]);
  });

  it("rejects malformed sensitive native-host requests before browser handlers", async () => {
    const port = new FakeNativePort();
    const browserCalls: string[] = [];
    const controller = new FirefoxCliBackgroundController({
      browserAdapter: createTestBrowserAdapter([], {
        listWindows: async () => {
          browserCalls.push("listWindows");
          return [];
        },
        executeEval: async () => {
          browserCalls.push("executeEval");
          return {
            ok: true,
            value: { type: "json", value: "unreachable" },
            elapsedMs: 1,
          };
        },
      }),
      connectNative: () => port,
      productVersion: "0.0.0",
    });
    controller.start();
    await approveWithNativeHost(controller, port);

    const malformedEval = {
      ...createRequest("eval", { script: "document.title", source: "argv" }, "malformed-eval"),
      params: { script: 42, source: "argv" },
    };
    port.emitMessage(malformedEval);
    await flushPromises();

    expect(port.messages[2]).toMatchObject({
      protocolVersion: malformedEval.protocolVersion,
      id: "malformed-eval",
      ok: false,
      error: {
        code: "INVALID_ENVELOPE",
      },
    });
    expect(browserCalls).toEqual([]);
  });

  it("preserves approved privilege-sensitive native-host command execution", async () => {
    const port = new FakeNativePort();
    const browserCalls: string[] = [];
    const controller = new FirefoxCliBackgroundController({
      browserAdapter: createTestBrowserAdapter(
        [
          {
            id: 7,
            focused: true,
            private: false,
            tabs: [
              {
                id: 42,
                index: 0,
                active: true,
                title: "Example",
                url: "https://example.com/",
                windowId: 7,
                private: false,
              },
            ],
          },
        ],
        {
          listWindows: async () => {
            browserCalls.push("listWindows");
            return [
              {
                id: 7,
                focused: true,
                private: false,
                tabs: [
                  {
                    id: 42,
                    index: 0,
                    active: true,
                    title: "Example",
                    url: "https://example.com/",
                    windowId: 7,
                    private: false,
                  },
                ],
              },
            ];
          },
          executeEval: async (tabId, payload) => {
            browserCalls.push(`executeEval:${tabId}:${payload.script}`);
            return {
              ok: true,
              value: { type: "json", value: "Example" },
              elapsedMs: 2,
            };
          },
        },
      ),
      connectNative: () => port,
      productVersion: "0.0.0",
    });
    controller.start();
    await approveWithNativeHost(controller, port);

    const request = createRequest(
      "eval",
      { script: "document.title", source: "argv" },
      "approved-sensitive-request",
    );
    expect(isPrivilegeSensitiveRequest(request)).toBe(true);
    port.emitMessage(request);
    await flushPromises();

    expect(port.messages[2]).toMatchObject({
      protocolVersion: request.protocolVersion,
      id: "approved-sensitive-request",
      ok: true,
      result: {
        value: { type: "json", value: "Example" },
        elapsedMs: 2,
        target: {
          windowId: 7,
          tabId: 42,
        },
      },
    });
    expect(browserCalls).toEqual(["listWindows", "executeEval:42:document.title"]);
  });

  it("rejects native-host requests before protocol negotiation completes", async () => {
    const port = new FakeNativePort();
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
    });
    controller.start();

    const noop = createRequest("noop", {}, "request-1");
    port.emitMessage(noop);
    await Promise.resolve();

    expect(port.messages[1]).toMatchObject({
      protocolVersion: noop.protocolVersion,
      id: "request-1",
      ok: false,
      error: {
        code: "NATIVE_HOST_UNAVAILABLE",
      },
    });
  });

  it("records incompatible native-host protocol state after no-overlap hello response", async () => {
    const port = new FakeNativePort();
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
    });
    controller.start();
    const hello = port.messages[0] as ReturnType<typeof createRequest<"hello">>;

    port.emitMessage({
      protocolVersion: 2,
      id: hello.id,
      ok: false,
      error: {
        code: "VERSION_MISMATCH",
        message: "Protocol version ranges do not overlap.",
      },
    });
    await flushPromises();

    const approvalStatus = await controller.handleRuntimeMessage({ type: "firefox-cli:approve" });

    expect(approvalStatus).toMatchObject({
      connected: true,
      approved: false,
      lastError: "Protocol version ranges do not overlap.",
    });
  });

  it("updates popup-facing approval and reset states", async () => {
    const port = new FakeNativePort();
    const storedTokens: (string | null)[] = [];
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
      storageAdapter: {
        getPairToken: async () => null,
        setPairToken: async (token) => {
          storedTokens.push(token);
        },
      },
    });
    controller.start();

    await approveWithNativeHost(controller, port);
    expect(controller.getStatus().approved).toBe(true);
    const resetStatus = controller.handleRuntimeMessage({ type: "firefox-cli:reset" });
    const reset = port.messages.at(-1) as ReturnType<typeof createRequest<"pair.reset">>;
    expect(reset.command).toBe("pair.reset");
    port.emitMessage(createOkResponse(reset, { ok: true }));
    await resetStatus;

    expect(controller.getStatus()).toMatchObject({
      connected: true,
      approved: false,
    });
    expect(controller.getStatus().lastError).toBeUndefined();
    expect(storedTokens).toEqual(["paired-token", null]);
  });

  it("restores approval state from extension storage", async () => {
    const port = new FakeNativePort();
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
      storageAdapter: {
        getPairToken: async () => "stored-token",
        setPairToken: async () => undefined,
      },
    });
    controller.start();

    await flushPromises();

    expect(controller.getStatus().approved).toBe(true);
    expect(port.messages.at(-1)).toMatchObject({
      command: "hello",
      params: {
        pairToken: "stored-token",
      },
    });
  });

  it("preserves stored pair tokens when hello reports invalid native-host pair state", async () => {
    const port = new FakeNativePort();
    const storedTokens: (string | null)[] = [];
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
      storageAdapter: {
        getPairToken: async () => "stored-token",
        setPairToken: async (token) => {
          storedTokens.push(token);
        },
      },
    });
    controller.start();
    await flushPromises();
    const hello = port.messages.at(-1) as ReturnType<typeof createRequest<"hello">>;

    port.emitMessage(
      createOkResponse(hello, {
        accepted: true,
        negotiatedProtocolVersion: 1,
        peer: {
          component: "native-host",
          productName: "firefox-cli",
          productVersion: "0.0.0",
          protocolMin: 1,
          protocolMax: 1,
          features: [],
        },
        pairing: {
          hostId: "host-1",
          extensionId: "firefox-cli@example.invalid",
          approved: false,
          status: "invalid-pair-state",
          message: "Stored pair state is invalid.",
        },
      }),
    );
    await flushPromises();

    expect(controller.getStatus()).toMatchObject({
      approved: false,
      lastError: "Stored pair state is invalid.",
    });
    expect(storedTokens).toEqual([]);
  });

  it("reports disconnects actionably", () => {
    const port = new FakeNativePort();
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
      reconnectDelaysMs: [],
    });
    controller.start();

    port.emitDisconnect({ message: "Native app exited." });

    expect(controller.getStatus()).toMatchObject({
      connected: false,
      lastError: "Native app exited.",
    });
  });

  it("resolves pending popup approval when the native host disconnects", async () => {
    const port = new FakeNativePort();
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
      reconnectDelaysMs: [],
    });
    controller.start();
    await completeNativeHello(port);

    const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });
    const request = port.messages.at(-1) as ReturnType<typeof createRequest<"pair.approve">>;
    expect(request.command).toBe("pair.approve");

    port.emitDisconnect({ message: "Native app exited." });
    await approval;

    expect(controller.getStatus()).toMatchObject({
      connected: false,
      approved: false,
      lastError: "Native host disconnected before responding.",
    });
  });

  it("resolves pending popup approval when native host responses time out", async () => {
    const port = new FakeNativePort();
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
      requestTimeoutMs: 10,
    });
    controller.start();
    await completeNativeHello(port);

    const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });

    await sleep(20);
    await approval;

    expect(controller.getStatus()).toMatchObject({
      connected: true,
      approved: false,
      lastError: "Timed out waiting for native host response to pair.approve.",
    });
  });

  it("ignores responses that arrive after request timeout", async () => {
    const port = new FakeNativePort();
    const storedTokens: (string | null)[] = [];
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
      requestTimeoutMs: 10,
      storageAdapter: {
        getPairToken: async () => null,
        setPairToken: async (token) => {
          storedTokens.push(token);
        },
      },
    });
    controller.start();
    await completeNativeHello(port);

    const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });
    const request = port.messages.at(-1) as ReturnType<typeof createRequest<"pair.approve">>;

    await sleep(20);
    await approval;
    port.emitMessage(
      createOkResponse(request, {
        hostId: "host-1",
        extensionId: "firefox-cli@example.invalid",
        token: "late-token",
        generation: 1,
        approvedAt: "2026-01-02T03:04:05.000Z",
      }),
    );
    await flushPromises();

    expect(controller.getStatus()).toMatchObject({
      approved: false,
      lastError: "Timed out waiting for native host response to pair.approve.",
    });
    expect(storedTokens).toEqual([]);
  });

  it("reconnects with bounded backoff after native-host disconnect", () => {
    const firstPort = new FakeNativePort();
    const secondPort = new FakeNativePort();
    const ports = [firstPort, secondPort];
    const scheduled: { readonly delayMs: number; readonly callback: () => void }[] = [];
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => {
        const port = ports.shift();
        if (port === undefined) {
          throw new Error("unexpected reconnect");
        }
        return port;
      },
      productVersion: "0.0.0",
      reconnectDelaysMs: [25],
      scheduleTimer: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
      },
    });
    controller.start();

    expect(firstPort.messages[0]).toMatchObject({ command: "hello" });
    expect(scheduled).toEqual([]);
    expect(controller.getStatus().connected).toBe(true);

    firstPort.emitDisconnect({ message: "Native app exited." });
    expect(controller.getStatus()).toMatchObject({
      connected: false,
      lastError: "Native app exited.",
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBe(25);

    scheduled[0]?.callback();

    expect(controller.getStatus()).toMatchObject({
      connected: true,
    });
    expect(secondPort.messages[0]).toMatchObject({ command: "hello" });
  });

  it("clears incompatible protocol state on reconnect", async () => {
    const firstPort = new FakeNativePort();
    const secondPort = new FakeNativePort();
    const ports = [firstPort, secondPort];
    const scheduled: { readonly callback: () => void }[] = [];
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => {
        const port = ports.shift();
        if (port === undefined) {
          throw new Error("unexpected reconnect");
        }
        return port;
      },
      productVersion: "0.0.0",
      reconnectDelaysMs: [1],
      scheduleTimer: (callback) => {
        scheduled.push({ callback });
      },
    });
    controller.start();
    const firstHello = firstPort.messages[0] as ReturnType<typeof createRequest<"hello">>;
    firstPort.emitMessage({
      protocolVersion: 2,
      id: firstHello.id,
      ok: false,
      error: {
        code: "VERSION_MISMATCH",
        message: "Protocol version ranges do not overlap.",
      },
    });
    await flushPromises();

    firstPort.emitDisconnect({ message: "Native app exited." });
    scheduled[0]?.callback();
    await completeNativeHello(secondPort);
    const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });
    const approve = secondPort.messages.at(-1) as ReturnType<typeof createRequest<"pair.approve">>;

    expect(approve.command).toBe("pair.approve");
    secondPort.emitMessage(
      createOkResponse(approve, {
        hostId: "host-1",
        extensionId: "firefox-cli@example.invalid",
        token: "paired-token",
        generation: 1,
        approvedAt: "2026-01-02T03:04:05.000Z",
      }),
    );
    await approval;

    expect(controller.getStatus()).toMatchObject({
      connected: true,
      approved: true,
    });
  });

  it("stops controller effects, drains pending requests, and ignores stale native messages", async () => {
    const port = new FakeNativePort();
    const scheduled: { readonly callback: () => void }[] = [];
    const storedTokens: (string | null)[] = [];
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => port,
      productVersion: "0.0.0",
      reconnectDelaysMs: [1],
      scheduleTimer: (callback) => {
        scheduled.push({ callback });
      },
      storageAdapter: {
        getPairToken: async () => null,
        setPairToken: async (token) => {
          storedTokens.push(token);
        },
      },
    });
    controller.start();
    await completeNativeHello(port);

    const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });
    const approve = port.messages.at(-1) as ReturnType<typeof createRequest<"pair.approve">>;
    controller.stop();
    await approval;

    expect(controller.getStatus()).toMatchObject({
      connected: false,
      approved: false,
      lastError: "Extension background stopped before the native host responded.",
    });

    port.emitMessage(
      createOkResponse(approve, {
        hostId: "host-1",
        extensionId: "firefox-cli@example.invalid",
        token: "late-token",
        generation: 1,
        approvedAt: "2026-01-02T03:04:05.000Z",
      }),
    );
    port.emitDisconnect({ message: "Native app exited." });
    await flushPromises();

    expect(controller.getStatus()).toMatchObject({
      connected: false,
      approved: false,
    });
    expect(storedTokens).toEqual([]);
    expect(scheduled).toEqual([]);
  });

  it("suppresses reconnect callbacks after stop", () => {
    const firstPort = new FakeNativePort();
    const secondPort = new FakeNativePort();
    const ports = [firstPort, secondPort];
    const scheduled: { readonly callback: () => void }[] = [];
    const controller = new FirefoxCliBackgroundController({
      connectNative: () => {
        const port = ports.shift();
        if (port === undefined) {
          throw new Error("unexpected reconnect");
        }
        return port;
      },
      productVersion: "0.0.0",
      reconnectDelaysMs: [1],
      scheduleTimer: (callback) => {
        scheduled.push({ callback });
      },
    });
    controller.start();

    firstPort.emitDisconnect({ message: "Native app exited." });
    expect(scheduled).toHaveLength(1);
    controller.stop();
    scheduled[0]?.callback();

    expect(secondPort.messages).toEqual([]);
    expect(controller.getStatus().connected).toBe(false);
  });
});

class FakeNativePort implements NativePortLike {
  readonly messages: unknown[] = [];
  readonly onMessage = createEvent<unknown>();
  readonly onDisconnect = createEvent<{ readonly message?: string } | undefined>();

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  emitMessage(message: unknown): void {
    this.onMessage.emit(message);
  }

  emitDisconnect(error?: { readonly message?: string }): void {
    this.onDisconnect.emit(error);
  }
}

function createEvent<T>() {
  const listeners: ((value: T) => void)[] = [];
  return {
    addListener(listener: (value: T) => void): void {
      listeners.push(listener);
    },
    emit(value: T): void {
      for (const listener of listeners) {
        listener(value);
      }
    },
  };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function createTestBrowserAdapter(
  windows: readonly BrowserWindowSnapshot[],
  overrides: Partial<BackgroundBrowserAdapter> = {},
): BackgroundBrowserAdapter {
  return {
    hasRequiredHostAccess: async () => true,
    listWindows: async () => windows,
    createTab: async () => {
      throw new Error("not implemented");
    },
    selectTab: async () => {
      throw new Error("not implemented");
    },
    closeTab: async () => undefined,
    createWindow: async () => {
      throw new Error("not implemented");
    },
    focusWindow: async () => {
      throw new Error("not implemented");
    },
    closeWindow: async () => undefined,
    navigateTab: async () => {
      throw new Error("not implemented");
    },
    goBack: async () => {
      throw new Error("not implemented");
    },
    goForward: async () => {
      throw new Error("not implemented");
    },
    reload: async () => {
      throw new Error("not implemented");
    },
    sendContentRequest: async () => {
      throw new Error("not implemented");
    },
    executeEval: async () => {
      throw new Error("not implemented");
    },
    captureVisibleTab: async () => {
      throw new Error("not implemented");
    },
    download: async () => {
      throw new Error("not implemented");
    },
    waitForDownload: async () => {
      throw new Error("not implemented");
    },
    readClipboard: async () => {
      throw new Error("not implemented");
    },
    writeClipboard: async () => {
      throw new Error("not implemented");
    },
    listCookies: async () => {
      throw new Error("not implemented");
    },
    setCookie: async () => {
      throw new Error("not implemented");
    },
    removeCookie: async () => {
      throw new Error("not implemented");
    },
    listNetworkRequests: async () => [],
    clearNetworkRequests: async () => undefined,
    waitForNetworkIdle: async () => undefined,
    resizeWindow: async () => {
      throw new Error("not implemented");
    },
    ...overrides,
  };
}

async function approveWithNativeHost(
  controller: FirefoxCliBackgroundController,
  port: FakeNativePort,
): Promise<void> {
  await completeNativeHello(port);
  const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });
  const request = port.messages.at(-1) as ReturnType<typeof createRequest<"pair.approve">>;
  expect(request.command).toBe("pair.approve");
  port.emitMessage(
    createOkResponse(request, {
      hostId: "host-1",
      extensionId: "firefox-cli@example.invalid",
      token: "paired-token",
      generation: 1,
      approvedAt: "2026-01-02T03:04:05.000Z",
    }),
  );
  await approval;
}

async function completeNativeHello(port: FakeNativePort): Promise<void> {
  const latest = port.messages.at(-1) as ReturnType<typeof createRequest> | undefined;
  if (latest?.command !== "hello") {
    return;
  }

  const hello = latest as ReturnType<typeof createRequest<"hello">>;
  const negotiatedProtocolVersion = hello.params.protocolMax;
  port.emitMessage(
    createOkResponse(
      hello,
      {
        accepted: true,
        negotiatedProtocolVersion,
        peer: {
          component: "native-host",
          productName: "firefox-cli",
          productVersion: "0.0.0",
          protocolMin: 1,
          protocolMax: negotiatedProtocolVersion,
          features: [],
        },
      },
      negotiatedProtocolVersion,
    ),
  );
  await flushPromises();
}
