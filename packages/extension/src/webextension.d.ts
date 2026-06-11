interface BrowserTab {
  readonly id: number;
  readonly index: number;
  readonly active: boolean;
  readonly title?: string;
  readonly url?: string;
  readonly windowId: number;
  readonly incognito?: boolean;
  readonly cookieStoreId?: string;
}

interface BrowserWindow {
  readonly id?: number;
  readonly focused?: boolean;
  readonly incognito?: boolean;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
  readonly tabs?: readonly BrowserTab[];
}

declare const browser: {
  readonly runtime: {
    readonly onMessage: {
      addListener(listener: (message: { readonly type?: string }, sender?: { readonly tab?: { readonly id?: number } }) => unknown): void;
      removeListener(listener: (message: { readonly type?: string }, sender?: { readonly tab?: { readonly id?: number } }) => unknown): void;
    };
    connectNative(name: string): {
      readonly onMessage: {
        addListener(listener: (message: unknown) => void): void;
      };
      readonly onDisconnect: {
        addListener(listener: (error?: { readonly message?: string }) => void): void;
      };
      postMessage(message: unknown): void;
    };
    getURL(path: string): string;
    sendMessage<T = unknown>(message: unknown): Promise<T>;
    reload(): void;
  };
  readonly windows: {
    getAll(options: { readonly populate: boolean }): Promise<readonly BrowserWindow[]>;
    create(options: { readonly url?: string }): Promise<BrowserWindow>;
    update(windowId: number, options: { readonly focused?: boolean; readonly width?: number; readonly height?: number }): Promise<BrowserWindow>;
    remove(windowId: number): Promise<void>;
  };
  readonly tabs: {
    create(options: { readonly active?: boolean; readonly url?: string; readonly windowId?: number }): Promise<BrowserTab>;
    update(tabId: number, options: { readonly active?: boolean; readonly url?: string }): Promise<BrowserTab>;
    get(tabId: number): Promise<BrowserTab>;
    remove(tabId: number): Promise<void>;
    goBack(tabId: number): Promise<void>;
    goForward(tabId: number): Promise<void>;
    reload(tabId: number): Promise<void>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
    captureVisibleTab(windowId: number, options: { readonly format?: "png" | "jpeg"; readonly quality?: number }): Promise<string>;
    readonly onRemoved?: {
      addListener(listener: (tabId: number) => void): void;
      removeListener(listener: (tabId: number) => void): void;
    };
  };
  readonly scripting: {
    executeScript(options: {
      readonly target: {
        readonly tabId: number;
        readonly allFrames?: boolean;
      };
      readonly files: readonly string[];
    }): Promise<readonly unknown[]>;
    executeScript<TArgs extends readonly unknown[], TResult>(options: {
      readonly target: {
        readonly tabId: number;
        readonly allFrames?: boolean;
      };
      readonly world?: "ISOLATED" | "MAIN";
      readonly func: (...args: TArgs) => TResult | Promise<TResult>;
      readonly args: TArgs;
    }): Promise<
      readonly {
        readonly result?: Awaited<TResult>;
        readonly error?: { readonly message?: string };
      }[]
    >;
  };
  readonly storage: {
    readonly local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
    };
  };
  readonly permissions?: {
    contains(permissions: { readonly origins: readonly string[] }): Promise<boolean>;
    request(permissions: { readonly origins: readonly string[] }): Promise<boolean>;
  };
  readonly downloads: {
    download(options: { readonly url: string; readonly filename?: string; readonly saveAs?: boolean }): Promise<number>;
    search(options: { readonly id?: number }): Promise<readonly { readonly id?: number; readonly filename?: string; readonly state?: string }[]>;
  };
  readonly cookies: {
    getAll(options: { readonly url: string; readonly name?: string }): Promise<readonly BrowserCookie[]>;
    set(options: {
      readonly url: string;
      readonly name: string;
      readonly value: string;
      readonly domain?: string;
      readonly path?: string;
    }): Promise<BrowserCookie>;
    remove(options: { readonly url: string; readonly name: string }): Promise<unknown>;
  };
  readonly notifications: {
    create(options: { readonly type: "basic"; readonly title: string; readonly message: string }): Promise<string>;
    create(
      notificationId: string,
      options: {
        readonly type: "basic";
        readonly title: string;
        readonly message: string;
      },
    ): Promise<string>;
  };
  readonly webRequest?: {
    readonly onBeforeRequest?: BrowserWebRequestEvent;
    readonly onCompleted?: BrowserWebRequestEvent;
    readonly onErrorOccurred?: BrowserWebRequestEvent;
  };
};

interface BrowserCookie {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
  readonly path?: string;
}

interface BrowserWebRequestEvent {
  addListener(
    listener: (details: {
      readonly requestId: string | number;
      readonly url: string;
      readonly method?: string;
      readonly type?: string;
      readonly statusCode?: number;
      readonly tabId?: number;
    }) => void,
    filter: { readonly urls: readonly string[]; readonly tabId?: number },
  ): void;
  removeListener(
    listener: (details: {
      readonly requestId: string | number;
      readonly url: string;
      readonly method?: string;
      readonly type?: string;
      readonly statusCode?: number;
      readonly tabId?: number;
    }) => void,
  ): void;
}
