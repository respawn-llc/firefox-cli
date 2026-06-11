import { FirefoxCliBackgroundController, type BackgroundStorageAdapter } from "./background-controller.js";
import { createBackgroundBrowserAdapter } from "./background-browser-adapter.js";
import { createContentScriptInjectionState } from "./content-script-delivery.js";
import { NetworkObservationService } from "./network-observation-service.js";
import { NetworkRequestTracker } from "./network-tracker.js";

interface RuntimeMessage {
  readonly type?: string;
}
interface RuntimeMessageSender {
  readonly tab?: {
    readonly id?: number;
  };
}
type RuntimeMessageListener = (message: RuntimeMessage, sender?: RuntimeMessageSender) => Promise<unknown>;

export type BackgroundBrowserApi = typeof browser;

const PAIR_TOKEN_STORAGE_KEY = "firefoxCliPairToken";

export interface BackgroundLifecycle {
  readonly controller: FirefoxCliBackgroundController;
  dispose(): void;
}

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
  readonly networkObservation?: NetworkObservationService;
}): BackgroundLifecycle {
  const networkObservation =
    options.networkObservation ??
    new NetworkObservationService({
      browser: options.browser,
      tracker: options.networkTracker ?? new NetworkRequestTracker(),
    });
  const contentScriptState = createContentScriptInjectionState();
  const controller = new FirefoxCliBackgroundController({
    browserAdapter: createBackgroundBrowserAdapter({
      browser: options.browser,
      networkObservation,
      contentScriptState,
      ...(options.clipboard === undefined ? {} : { clipboard: options.clipboard }),
    }),
    connectNative: (name) => options.browser.runtime.connectNative(name),
    productVersion: options.manifest.version,
    storageAdapter: createBackgroundStorageAdapter(options.browser),
    ...createControllerOptions(options.controllerOptions),
  });

  const runtimeListener: RuntimeMessageListener = async (message, sender) =>
    controller.handleRuntimeMessage(message, sender?.tab?.id === undefined ? {} : { sourceTabId: sender.tab.id });
  const onTabRemoved = (tabId: number) => {
    networkObservation.pruneTab(tabId);
    contentScriptState.forgetTab(tabId);
  };

  controller.start();
  options.browser.runtime.onMessage.addListener(runtimeListener);
  options.browser.tabs.onRemoved?.addListener(onTabRemoved);

  return {
    controller,
    dispose: () => {
      options.browser.runtime.onMessage.removeListener(runtimeListener);
      networkObservation.dispose();
      options.browser.tabs.onRemoved?.removeListener(onTabRemoved);
      controller.stop();
    },
  };
}

function createBackgroundStorageAdapter(browser: BackgroundBrowserApi): BackgroundStorageAdapter {
  return {
    getPairToken: async () => {
      const values = await browser.storage.local.get(PAIR_TOKEN_STORAGE_KEY);
      const value = values[PAIR_TOKEN_STORAGE_KEY];
      return typeof value === "string" && value.length > 0 ? value : null;
    },
    setPairToken: async (token) => {
      await browser.storage.local.set({ [PAIR_TOKEN_STORAGE_KEY]: token });
    },
  };
}

function createControllerOptions(
  options:
    | {
        readonly reconnectDelaysMs?: readonly number[];
        readonly scheduleTimer?: (callback: () => void, delayMs: number) => void;
        readonly requestTimeoutMs?: number;
        readonly storageAdapter?: BackgroundStorageAdapter;
      }
    | undefined,
) {
  if (options === undefined) {
    return {};
  }
  return {
    ...(options.reconnectDelaysMs === undefined ? {} : { reconnectDelaysMs: options.reconnectDelaysMs }),
    ...(options.scheduleTimer === undefined ? {} : { scheduleTimer: options.scheduleTimer }),
    ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
    ...(options.storageAdapter === undefined ? {} : { storageAdapter: options.storageAdapter }),
  };
}
