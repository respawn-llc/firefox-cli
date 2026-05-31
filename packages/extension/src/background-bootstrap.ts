import {
  FirefoxCliBackgroundController,
  type BackgroundStorageAdapter,
} from "./background-controller.js";
import { createBackgroundBrowserAdapter } from "./background-browser-adapter.js";
import { createContentScriptInjectionState } from "./content-script-delivery.js";
import { NetworkObservationService } from "./network-observation-service.js";
import { NetworkRequestTracker } from "./network-tracker.js";

type RuntimeMessage = { readonly type?: string };
type RuntimeMessageListener = (message: RuntimeMessage) => Promise<unknown>;

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
