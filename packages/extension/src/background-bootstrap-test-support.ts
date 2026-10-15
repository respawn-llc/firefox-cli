import type { BackgroundBrowserApi } from "./background-bootstrap.js";
import type { NativePortLike } from "./background-controller.js";

interface NotificationOptions {
  readonly type: "basic";
  readonly title: string;
  readonly message: string;
}

export class FakeNativePort implements NativePortLike {
  readonly onMessage = createEvent<unknown>();
  readonly onDisconnect = createEvent<{ readonly message?: string } | undefined>();

  postMessage(): void {
    // Tests only assert bootstrap listener ownership.
  }
}

export function createFakeBrowserApi(port: NativePortLike): FakeBackgroundBrowserApi {
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
  const tabUpdateCalls: { readonly tabId: number; readonly updateInfo: unknown }[] = [];
  const windowUpdateCalls: { readonly windowId: number; readonly updateInfo: unknown }[] = [];
  const windowCreateCalls: unknown[] = [];

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
      createCalls: windowCreateCalls,
      create: async (createData) => {
        windowCreateCalls.push(createData);
        return { id: 1, focused: createData.focused === true };
      },
      updateCalls: windowUpdateCalls,
      update: async (id, updateInfo) => {
        windowUpdateCalls.push({ windowId: id, updateInfo });
        return { id, focused: true };
      },
      remove: async () => undefined,
    },
    tabs: {
      failNextSendMessage: false,
      sendMessageFailure: undefined,
      create: async function create(
        this: { readonly created: unknown[] },
        options: { readonly active?: boolean; readonly url?: string; readonly windowId?: number },
      ) {
        this.created.push(options);
        return {
          id: 1,
          index: 0,
          active: options.active !== false,
          windowId: options.windowId ?? 1,
          ...(options.url === undefined ? {} : { url: options.url }),
        };
      },
      updateCalls: tabUpdateCalls,
      update: async (id, updateInfo) => {
        tabUpdateCalls.push({ tabId: id, updateInfo });
        return { id, index: 0, active: true, windowId: 1 };
      },
      getCurrent: async () => ({ id: 1, index: 0, active: true, windowId: 1 }),
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
type FakeBackgroundBrowserApi = Omit<BackgroundBrowserApi, "runtime" | "windows" | "tabs" | "scripting" | "webRequest"> & {
  readonly windows: BackgroundBrowserApi["windows"] & {
    readonly createCalls: readonly unknown[];
    readonly updateCalls: readonly { readonly windowId: number; readonly updateInfo: unknown }[];
  };
  readonly runtime: Omit<BackgroundBrowserApi["runtime"], "onMessage"> & {
    readonly onMessage: FakeEvent<{ readonly type?: string }, unknown>;
  };
  readonly tabs: Omit<BackgroundBrowserApi["tabs"], "onRemoved" | "sendMessage"> & {
    failNextSendMessage: boolean;
    response: unknown;
    sendMessageFailure: Error | undefined;
    readonly created: unknown[];
    readonly updateCalls: readonly { readonly tabId: number; readonly updateInfo: unknown }[];
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
