import {
  FirefoxCliBackgroundController,
  type BackgroundStorageAdapter,
} from "./background-controller.js";
import { createBackgroundBrowserAdapter } from "./background-browser-adapter.js";
import { NetworkRequestTracker } from "./network-tracker.js";

type RuntimeMessage = { readonly type?: string };
type RuntimeMessageListener = (message: RuntimeMessage) => Promise<unknown>;
type WebRequestDetails = {
  readonly requestId: string | number;
  readonly url: string;
  readonly method?: string;
  readonly type?: string;
  readonly statusCode?: number;
  readonly tabId?: number;
};
type WebRequestEvent = {
  addListener(
    listener: (details: WebRequestDetails) => void,
    filter: { readonly urls: readonly string[] },
  ): void;
  removeListener(listener: (details: WebRequestDetails) => void): void;
};

export type BackgroundBrowserApi = typeof browser;

export type BackgroundLifecycle = {
  readonly controller: FirefoxCliBackgroundController;
  dispose(): void;
};

export function startBackground(options: {
  readonly browser: BackgroundBrowserApi;
  readonly manifest: { readonly version: string };
  readonly controllerOptions?: {
    readonly reconnectDelaysMs?: readonly number[];
    readonly scheduleTimer?: (callback: () => void, delayMs: number) => void;
    readonly requestTimeoutMs?: number;
    readonly storageAdapter?: BackgroundStorageAdapter;
  };
  readonly clipboard?: Pick<typeof navigator.clipboard, "readText" | "writeText">;
  readonly networkTracker?: NetworkRequestTracker;
}): BackgroundLifecycle {
  const networkTracker = options.networkTracker ?? new NetworkRequestTracker();
  const controller = new FirefoxCliBackgroundController({
    browserAdapter: createBackgroundBrowserAdapter({
      browser: options.browser,
      networkTracker,
      ...(options.clipboard === undefined ? {} : { clipboard: options.clipboard }),
    }),
    connectNative: (name) => options.browser.runtime.connectNative(name),
    productVersion: options.manifest.version,
    ...(options.controllerOptions?.reconnectDelaysMs === undefined
      ? {}
      : { reconnectDelaysMs: options.controllerOptions.reconnectDelaysMs }),
    ...(options.controllerOptions?.scheduleTimer === undefined
      ? {}
      : { scheduleTimer: options.controllerOptions.scheduleTimer }),
    ...(options.controllerOptions?.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.controllerOptions.requestTimeoutMs }),
    ...(options.controllerOptions?.storageAdapter === undefined
      ? {}
      : { storageAdapter: options.controllerOptions.storageAdapter }),
  });

  const runtimeListener: RuntimeMessageListener = (message) =>
    controller.handleRuntimeMessage(message);
  const onBeforeRequest = (details: WebRequestDetails) => {
    networkTracker.recordStart({
      requestId: details.requestId,
      ...(details.tabId === undefined ? {} : { tabId: details.tabId }),
      url: details.url,
      ...(details.method === undefined ? {} : { method: details.method }),
      ...(details.type === undefined ? {} : { type: details.type }),
    });
  };
  const markNetworkComplete = (details: WebRequestDetails) => {
    networkTracker.recordEnd(details);
  };
  const webRequestRegistrations: {
    readonly event: WebRequestEvent;
    readonly listener: (details: WebRequestDetails) => void;
  }[] = [];
  const onTabRemoved = (tabId: number) => {
    networkTracker.pruneTab(tabId);
  };

  controller.start();
  options.browser.runtime.onMessage.addListener(runtimeListener);
  options.browser.tabs.onRemoved?.addListener(onTabRemoved);
  addWebRequestListener(
    options.browser.webRequest?.onBeforeRequest,
    onBeforeRequest,
    webRequestRegistrations,
  );
  addWebRequestListener(
    options.browser.webRequest?.onCompleted,
    markNetworkComplete,
    webRequestRegistrations,
  );
  addWebRequestListener(
    options.browser.webRequest?.onErrorOccurred,
    markNetworkComplete,
    webRequestRegistrations,
  );

  return {
    controller,
    dispose: () => {
      options.browser.runtime.onMessage.removeListener(runtimeListener);
      for (const registration of webRequestRegistrations) {
        registration.event.removeListener(registration.listener);
      }
      webRequestRegistrations.length = 0;
      options.browser.tabs.onRemoved?.removeListener(onTabRemoved);
      controller.stop();
    },
  };
}

function addWebRequestListener(
  event: WebRequestEvent | undefined,
  listener: (details: WebRequestDetails) => void,
  registrations: {
    readonly event: WebRequestEvent;
    readonly listener: (details: WebRequestDetails) => void;
  }[],
): void {
  if (event === undefined) {
    return;
  }
  event.addListener(listener, { urls: ["<all_urls>"] });
  registrations.push({ event, listener });
}
