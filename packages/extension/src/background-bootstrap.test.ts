import { createRequest } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { startBackground, type BackgroundBrowserApi } from "./background-bootstrap.js";
import { createBackgroundBrowserAdapter } from "./background-browser-adapter.js";
import type { NativePortLike } from "./background-controller.js";
import { NetworkRequestTracker } from "./network-tracker.js";

describe("background bootstrap", () => {
  it("registers and disposes runtime and webRequest listeners", () => {
    const port = new FakeNativePort();
    const browser = createFakeBrowserApi(port);
    const networkTracker = new NetworkRequestTracker({ now: () => 1000 });

    const lifecycle = startBackground({
      browser,
      manifest: { version: "0.0.0" },
      controllerOptions: { reconnectDelaysMs: [] },
      networkTracker,
    });

    const runtimeOnMessage = browser.runtime.onMessage as unknown as FakeEvent<{
      readonly type?: string;
    }>;
    const onBeforeRequest = browser.webRequest?.onBeforeRequest as unknown as FakeWebRequestEvent<{
      readonly requestId: string | number;
      readonly tabId?: number;
      readonly url: string;
    }>;
    expect(onBeforeRequest.filters()).toEqual([{ urls: ["<all_urls>"] }]);
    expect(runtimeOnMessage.listenerCount()).toBe(1);
    expect(onBeforeRequest.listenerCount()).toBe(1);
    expect((browser.tabs.onRemoved as unknown as FakeEvent<number>).listenerCount()).toBe(1);

    onBeforeRequest.emit({
      requestId: "before-dispose",
      tabId: 7,
      url: "https://example.test/app",
    });
    expect(networkTracker.list({ tabId: 7 })).toHaveLength(1);
    (browser.tabs.onRemoved as unknown as FakeEvent<number>).emit(7);
    expect(networkTracker.list({ tabId: 7 })).toEqual([]);

    lifecycle.dispose();
    expect(runtimeOnMessage.listenerCount()).toBe(0);
    expect(onBeforeRequest.listenerCount()).toBe(0);
    expect((browser.tabs.onRemoved as unknown as FakeEvent<number>).listenerCount()).toBe(0);

    onBeforeRequest.emit({
      requestId: "after-dispose",
      tabId: 7,
      url: "https://example.test/after",
    });
    expect(networkTracker.list({ tabId: 7 })).toEqual([]);
  });

  it("preserves content injection and eval execution product contracts", async () => {
    const port = new FakeNativePort();
    const browser = createFakeBrowserApi(port);
    const networkTracker = new NetworkRequestTracker();
    const adapter = createBackgroundBrowserAdapter({ browser, networkTracker });

    (browser.tabs as unknown as { failNextSendMessage: boolean }).failNextSendMessage = true;
    await adapter.sendContentRequest(42, createRequest("snapshot", {}, "snapshot-1"));
    await adapter.executeEval(42, { script: "1 + 1", timeoutMs: 1000, maxResultBytes: 1024 });

    const scriptingCalls = (browser.scripting as unknown as { readonly calls: readonly unknown[] })
      .calls;
    expect(scriptingCalls[0]).toMatchObject({
      target: { tabId: 42, allFrames: false },
      files: ["content.js"],
    });
    expect(scriptingCalls[1]).toMatchObject({
      target: { tabId: 42, allFrames: false },
      world: "MAIN",
    });
  });

  it("does not refresh content scripts when an existing script returns a structured mismatch", async () => {
    const port = new FakeNativePort();
    const browser = createFakeBrowserApi(port);
    const networkTracker = new NetworkRequestTracker();
    const adapter = createBackgroundBrowserAdapter({ browser, networkTracker });

    (browser.tabs as unknown as { response: unknown }).response = {
      protocolVersion: 1,
      id: "snapshot-1",
      ok: false,
      error: {
        code: "VERSION_MISMATCH",
        message: "Protocol version is not supported.",
      },
    };

    await adapter.sendContentRequest(42, createRequest("snapshot", {}, "snapshot-1"));

    const scriptingCalls = (browser.scripting as unknown as { readonly calls: readonly unknown[] })
      .calls;
    expect(scriptingCalls).toEqual([]);
  });
});

class FakeNativePort implements NativePortLike {
  readonly onMessage = createEvent<unknown>();
  readonly onDisconnect = createEvent<{ readonly message?: string } | undefined>();

  postMessage(): void {
    // Tests only assert bootstrap listener ownership.
  }
}

function createFakeBrowserApi(port: NativePortLike): BackgroundBrowserApi {
  const runtimeOnMessage = createEvent<{ readonly type?: string }, Promise<unknown> | unknown>();
  const onBeforeRequest = createWebRequestEvent();
  const onCompleted = createWebRequestEvent();
  const onErrorOccurred = createWebRequestEvent();
  const onRemoved = createEvent<number>();
  let sendMessageCalls = 0;
  const scriptingCalls: unknown[] = [];

  return {
    runtime: {
      onMessage: runtimeOnMessage,
      connectNative: () => port,
      sendMessage: async () => undefined,
      reload: () => undefined,
    },
    windows: {
      getAll: async () => [],
      create: async () => ({ id: 1 }),
      update: async (id: number) => ({ id, focused: true }),
      remove: async () => undefined,
    },
    tabs: {
      failNextSendMessage: false,
      create: async () => ({ id: 1, index: 0, active: true, windowId: 1 }),
      update: async (id: number) => ({ id, index: 0, active: true, windowId: 1 }),
      get: async (id: number) => ({ id, index: 0, active: true, windowId: 1 }),
      remove: async () => undefined,
      goBack: async () => undefined,
      goForward: async () => undefined,
      reload: async () => undefined,
      response: undefined,
      sendMessage: async function sendMessage(this: {
        failNextSendMessage: boolean;
        response: unknown;
      }) {
        sendMessageCalls += 1;
        if (this.failNextSendMessage) {
          this.failNextSendMessage = false;
          throw new Error("content script missing");
        }
        return this.response ?? { sendMessageCalls };
      },
      captureVisibleTab: async () => "data:image/png;base64,",
      onRemoved,
    },
    permissions: {
      contains: async () => true,
      request: async () => true,
    },
    scripting: {
      calls: scriptingCalls,
      executeScript: async (options: unknown) => {
        scriptingCalls.push(options);
        return [{ result: { ok: true } }];
      },
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => undefined,
      },
    },
    downloads: {
      download: async () => 1,
      search: async () => [{ id: 1, state: "complete" }],
    },
    cookies: {
      getAll: async () => [],
      set: async (cookie: BrowserCookie) => cookie,
      remove: async () => undefined,
    },
    webRequest: {
      onBeforeRequest,
      onCompleted,
      onErrorOccurred,
    },
  } as unknown as BackgroundBrowserApi;
}

type FakeEvent<T, TResult = void> = ReturnType<typeof createEvent<T, TResult>>;
type FakeWebRequestEvent<T> = FakeEvent<T> & {
  filters(): readonly { readonly urls: readonly string[] }[];
};

function createEvent<T, TResult = void>() {
  const listeners: ((value: T) => TResult)[] = [];
  return {
    addListener(listener: (value: T) => TResult): void {
      listeners.push(listener);
    },
    removeListener(listener: (value: T) => TResult): void {
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    emit(value: T): readonly TResult[] {
      return listeners.map((listener) => listener(value));
    },
    listenerCount(): number {
      return listeners.length;
    },
  };
}

function createWebRequestEvent() {
  const event = createEvent<{
    readonly requestId: string | number;
    readonly tabId?: number;
    readonly url: string;
    readonly statusCode?: number;
  }>();
  const filters: { readonly urls: readonly string[] }[] = [];
  return {
    ...event,
    addListener(
      listener: Parameters<typeof event.addListener>[0],
      filter: { readonly urls: readonly string[] },
    ) {
      filters.push(filter);
      event.addListener(listener);
    },
    filters: () => filters,
  };
}
