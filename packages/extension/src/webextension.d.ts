type BrowserTab = {
  readonly id: number;
  readonly index: number;
  readonly active: boolean;
  readonly title?: string;
  readonly url?: string;
  readonly windowId: number;
  readonly incognito?: boolean;
  readonly cookieStoreId?: string;
};

type BrowserWindow = {
  readonly id?: number;
  readonly focused?: boolean;
  readonly incognito?: boolean;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
  readonly tabs?: readonly BrowserTab[];
};

declare const browser: {
  readonly runtime: {
    readonly onMessage: {
      addListener(
        listener: (message: { readonly type?: string }) => Promise<unknown> | unknown,
      ): void;
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
    sendMessage(message: unknown): Promise<unknown>;
  };
  readonly windows: {
    getAll(options: { readonly populate: true }): Promise<readonly BrowserWindow[]>;
    create(options: { readonly url?: string }): Promise<BrowserWindow>;
    update(windowId: number, options: { readonly focused?: boolean }): Promise<BrowserWindow>;
    remove(windowId: number): Promise<void>;
  };
  readonly tabs: {
    create(options: {
      readonly active?: boolean;
      readonly url?: string;
      readonly windowId?: number;
    }): Promise<BrowserTab>;
    update(
      tabId: number,
      options: { readonly active?: boolean; readonly url?: string },
    ): Promise<BrowserTab>;
    get(tabId: number): Promise<BrowserTab>;
    remove(tabId: number): Promise<void>;
    goBack(tabId: number): Promise<void>;
    goForward(tabId: number): Promise<void>;
    reload(tabId: number): Promise<void>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
    captureVisibleTab(
      windowId: number,
      options: { readonly format?: "png" | "jpeg"; readonly quality?: number },
    ): Promise<string>;
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
};
