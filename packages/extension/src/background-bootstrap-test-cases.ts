import { createRequest } from "@firefox-cli/protocol";
import { expect } from "vitest";
import { type BackgroundBrowserApi, startBackground } from "./background-bootstrap.js";
import { createBackgroundBrowserAdapter } from "./background-browser-adapter.js";
import type { NativePortLike } from "./background-controller.js";
import { NetworkObservationService } from "./network-observation-service.js";
import { NetworkRequestTracker } from "./network-tracker.js";

interface NotificationOptions {
  readonly type: "basic";
  readonly title: string;
  readonly message: string;
}

export async function runCase01() {
  const port = new FakeNativePort();
  const browser = createFakeBrowserApi(port);
  const networkTracker = new NetworkRequestTracker({ now: () => 1000 });
  const networkObservation = new NetworkObservationService({ browser, tracker: networkTracker });

  const lifecycle = startBackground({
    browser,
    manifest: { version: "0.0.0" },
    controllerOptions: { reconnectDelaysMs: [] },
    networkObservation,
  });

  const runtimeOnMessage = browser.runtime.onMessage;
  const onBeforeRequest = browser.webRequest.onBeforeRequest;
  expect(runtimeOnMessage.listenerCount()).toBe(1);
  expect(onBeforeRequest.listenerCount()).toBe(0);
  expect(browser.tabs.onRemoved.listenerCount()).toBe(1);

  await networkObservation.observeTab(7, () => {
    expect(onBeforeRequest.filters()).toEqual([{ urls: ["<all_urls>"], tabId: 7 }]);
    expect(onBeforeRequest.listenerCount()).toBe(1);
    onBeforeRequest.emit({
      requestId: "before-dispose",
      tabId: 7,
      url: "https://example.test/app",
    });
  });
  expect(networkTracker.list({ tabId: 7 })).toHaveLength(1);
  browser.tabs.onRemoved.emit(7);
  expect(networkTracker.list({ tabId: 7 })).toEqual([]);
  expect(onBeforeRequest.listenerCount()).toBe(0);

  lifecycle.dispose();
  expect(runtimeOnMessage.listenerCount()).toBe(0);
  expect(onBeforeRequest.listenerCount()).toBe(0);
  expect(browser.tabs.onRemoved.listenerCount()).toBe(0);

  onBeforeRequest.emit({
    requestId: "after-dispose",
    tabId: 7,
    url: "https://example.test/after",
  });
  expect(networkTracker.list({ tabId: 7 })).toEqual([]);
}

export async function runCase02() {
  const port = new FakeNativePort();
  const browser = createFakeBrowserApi(port);
  const networkTracker = new NetworkRequestTracker();
  const networkObservation = new NetworkObservationService({ browser, tracker: networkTracker });
  const adapter = createBackgroundBrowserAdapter({ browser, networkObservation });

  browser.tabs.failNextSendMessage = true;
  await adapter.sendContentRequest(42, createRequest("snapshot", {}, "snapshot-1"));
  await adapter.executeEval(42, { script: "1 + 1", timeoutMs: 1000, maxResultBytes: 1024 });

  const { calls: scriptingCalls } = browser.scripting;
  expect(scriptingCalls[0]).toMatchObject({
    target: { tabId: 42, allFrames: false },
    files: ["content.js"],
  });
  expect(scriptingCalls[1]).toMatchObject({
    target: { tabId: 42, allFrames: false },
    world: "MAIN",
  });
}

export async function runCase03() {
  const port = new FakeNativePort();
  const browser = createFakeBrowserApi(port);
  const networkTracker = new NetworkRequestTracker();
  const networkObservation = new NetworkObservationService({ browser, tracker: networkTracker });
  const adapter = createBackgroundBrowserAdapter({ browser, networkObservation });

  browser.tabs.response = {
    protocolVersion: 1,
    id: "snapshot-1",
    ok: false,
    error: {
      code: "VERSION_MISMATCH",
      message: "Protocol version is not supported.",
    },
  };

  await adapter.sendContentRequest(42, createRequest("snapshot", {}, "snapshot-1"));

  const { calls: scriptingCalls } = browser.scripting;
  expect(scriptingCalls).toEqual([]);
}

export async function runCase04() {
  const port = new FakeNativePort();
  const browser = createFakeBrowserApi(port);
  const networkTracker = new NetworkRequestTracker();
  const networkObservation = new NetworkObservationService({ browser, tracker: networkTracker });
  const adapter = createBackgroundBrowserAdapter({ browser, networkObservation });

  browser.tabs.sendMessageFailure = new Error("Cannot access a restricted Firefox page");

  await expect(adapter.sendContentRequest(42, createRequest("snapshot", {}, "snapshot-1"))).rejects.toMatchObject({
    deliveryCause: "restricted-page",
    stage: "send",
    retried: false,
  });
  expect(browser.scripting.calls).toEqual([]);
}

export async function runCase05() {
  const port = new FakeNativePort();
  const browser = createFakeBrowserApi(port);
  const networkTracker = new NetworkRequestTracker();
  const networkObservation = new NetworkObservationService({ browser, tracker: networkTracker });
  const adapter = createBackgroundBrowserAdapter({ browser, networkObservation });

  await expect(adapter.showNotification({ id: "approval", title: "Action needed", message: "Open Firefox." })).resolves.toEqual({
    ok: true,
    id: "approval",
  });
  await expect(adapter.openExtensionPage("popup.html")).resolves.toBe("moz-extension://fake/popup.html");
  expect(browser.notifications.calls).toEqual([
    {
      id: "approval",
      options: {
        type: "basic",
        title: "Action needed",
        message: "Open Firefox.",
      },
    },
  ]);
  expect(browser.tabs.created).toEqual([{ active: true, url: "moz-extension://fake/popup.html" }]);
}

class FakeNativePort implements NativePortLike {
  readonly onMessage = createEvent<unknown>();
  readonly onDisconnect = createEvent<{ readonly message?: string } | undefined>();

  postMessage(): void {
    // Tests only assert bootstrap listener ownership.
  }
}

function createFakeBrowserApi(port: NativePortLike): FakeBackgroundBrowserApi {
  const runtimeOnMessage = createEvent<{ readonly type?: string }, unknown>();
  const onBeforeRequest = createWebRequestEvent();
  const onCompleted = createWebRequestEvent();
  const onErrorOccurred = createWebRequestEvent();
  const onRemoved = createEvent<number>();
  let sendMessageCalls = 0;
  const scriptingCalls: unknown[] = [];
  const notificationCalls: {
    readonly id: string | undefined;
    readonly options: NotificationOptions;
  }[] = [];

  function createNotification(options: NotificationOptions): Promise<string>;
  function createNotification(id: string, options: NotificationOptions): Promise<string>;
  async function createNotification(idOrOptions: string | NotificationOptions, options?: NotificationOptions): Promise<string> {
    if (typeof idOrOptions !== "string") {
      notificationCalls.push({ id: undefined, options: idOrOptions });
      return "generated-notification";
    }
    if (options === undefined) {
      throw new Error("Missing notification options.");
    }
    notificationCalls.push({ id: idOrOptions, options });
    return idOrOptions;
  }

  return {
    runtime: {
      onMessage: runtimeOnMessage,
      connectNative: () => port,
      getURL: (path) => `moz-extension://fake/${path}`,
      sendMessage: async <T = unknown>(): Promise<T> => {
        throw new Error("runtime.sendMessage is not implemented in this fake.");
      },
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
      sendMessageFailure: undefined,
      create: async function create(this: { readonly created: unknown[] }, options: unknown) {
        this.created.push(options);
        return { id: 1, index: 0, active: true, windowId: 1 };
      },
      update: async (id: number) => ({ id, index: 0, active: true, windowId: 1 }),
      get: async (id: number) => ({ id, index: 0, active: true, windowId: 1 }),
      remove: async () => undefined,
      goBack: async () => undefined,
      goForward: async () => undefined,
      reload: async () => undefined,
      response: undefined,
      created: [],
      sendMessage: async function sendMessage(this: {
        failNextSendMessage: boolean;
        response: unknown;
        sendMessageFailure: Error | undefined;
      }) {
        sendMessageCalls += 1;
        if (this.sendMessageFailure !== undefined) {
          throw this.sendMessageFailure;
        }
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
    notifications: {
      calls: notificationCalls,
      create: createNotification,
    },
    webRequest: {
      onBeforeRequest,
      onCompleted,
      onErrorOccurred,
    },
  };
}

type FakeEvent<T, TResult = void> = ReturnType<typeof createEvent<T, TResult>>;
interface WebRequestDetails {
  readonly requestId: string | number;
  readonly tabId?: number;
  readonly url: string;
  readonly statusCode?: number;
}
interface FakeWebRequestEvent<T extends WebRequestDetails = WebRequestDetails> {
  addListener(listener: (details: T) => void, filter: { readonly urls: readonly string[]; readonly tabId?: number }): void;
  removeListener(listener: (details: T) => void): void;
  emit(value: T): readonly undefined[];
  listenerCount(): number;
  filters(): readonly { readonly urls: readonly string[]; readonly tabId?: number }[];
}
type FakeBackgroundBrowserApi = Omit<BackgroundBrowserApi, "runtime" | "tabs" | "scripting" | "webRequest"> & {
  readonly runtime: Omit<BackgroundBrowserApi["runtime"], "onMessage"> & {
    readonly onMessage: FakeEvent<{ readonly type?: string }, unknown>;
  };
  readonly tabs: Omit<BackgroundBrowserApi["tabs"], "onRemoved" | "sendMessage"> & {
    failNextSendMessage: boolean;
    response: unknown;
    sendMessageFailure: Error | undefined;
    readonly created: unknown[];
    sendMessage(this: {
      failNextSendMessage: boolean;
      response: unknown;
      sendMessageFailure: Error | undefined;
    }): Promise<unknown>;
    readonly onRemoved: FakeEvent<number>;
  };
  readonly scripting: BackgroundBrowserApi["scripting"] & {
    readonly calls: readonly unknown[];
  };
  readonly notifications: BackgroundBrowserApi["notifications"] & {
    readonly calls: readonly {
      readonly id: string | undefined;
      readonly options: NotificationOptions;
    }[];
  };
  readonly webRequest: {
    readonly onBeforeRequest: FakeWebRequestEvent;
    readonly onCompleted: FakeWebRequestEvent;
    readonly onErrorOccurred: FakeWebRequestEvent;
  };
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
  const listeners: {
    readonly listener: (details: WebRequestDetails) => void;
    readonly filter: { readonly urls: readonly string[]; readonly tabId?: number };
  }[] = [];
  return {
    addListener(listener: (details: WebRequestDetails) => void, filter: { readonly urls: readonly string[]; readonly tabId?: number }): void {
      listeners.push({ listener, filter });
    },
    removeListener(listener: (details: WebRequestDetails) => void): void {
      const index = listeners.findIndex((registration) => registration.listener === listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    emit(details: WebRequestDetails): readonly undefined[] {
      return listeners
        .filter((registration) => registration.filter.tabId === undefined || registration.filter.tabId === details.tabId)
        .map((registration) => {
          registration.listener(details);
          return undefined;
        });
    },
    listenerCount(): number {
      return listeners.length;
    },
    filters: () => listeners.map((registration) => registration.filter),
  };
}
