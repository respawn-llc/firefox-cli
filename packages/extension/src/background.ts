import { FirefoxCliBackgroundController } from "./background-controller.js";
import { executeEvalInPage } from "./eval-executor.js";
import manifest from "./manifest.json" with { type: "json" };

const controller = new FirefoxCliBackgroundController({
  browserAdapter: {
    listWindows: async () => {
      const windows = await browser.windows.getAll({ populate: true });
      return windows.filter(hasWindowId).map((window) => ({
        id: window.id,
        focused: window.focused === true,
        ...(window.incognito === undefined ? {} : { private: window.incognito }),
        ...(window.left === undefined ? {} : { left: window.left }),
        ...(window.top === undefined ? {} : { top: window.top }),
        ...(window.width === undefined ? {} : { width: window.width }),
        ...(window.height === undefined ? {} : { height: window.height }),
        tabs: (window.tabs ?? []).map(toTabSummary),
      }));
    },
    createTab: async (options) =>
      toTabSummary(
        await browser.tabs.create({
          active: true,
          ...(options.url === undefined ? {} : { url: options.url }),
          ...(options.windowId === undefined ? {} : { windowId: options.windowId }),
        }),
      ),
    selectTab: async (tabId) => {
      const tab = toTabSummary(await browser.tabs.update(tabId, { active: true }));
      await browser.windows.update(tab.windowId, { focused: true });
      return tab;
    },
    closeTab: async (tabId) => {
      await browser.tabs.remove(tabId);
    },
    createWindow: async (options) =>
      toWindowSnapshot(
        await browser.windows.create({
          ...(options.url === undefined ? {} : { url: options.url }),
        }),
      ),
    focusWindow: async (windowId) =>
      toWindowSnapshot(await browser.windows.update(windowId, { focused: true })),
    closeWindow: async (windowId) => {
      await browser.windows.remove(windowId);
    },
    navigateTab: async (tabId, url) =>
      toTabSummary(await browser.tabs.update(tabId, { active: true, url })),
    goBack: async (tabId) => {
      await browser.tabs.goBack(tabId);
      return toTabSummary(await browser.tabs.get(tabId));
    },
    goForward: async (tabId) => {
      await browser.tabs.goForward(tabId);
      return toTabSummary(await browser.tabs.get(tabId));
    },
    reload: async (tabId) => {
      await browser.tabs.reload(tabId);
      return toTabSummary(await browser.tabs.get(tabId));
    },
    sendContentRequest: async (tabId, request) => {
      try {
        return await browser.tabs.sendMessage(tabId, request);
      } catch {
        await browser.scripting.executeScript({
          target: { tabId, allFrames: false },
          files: ["content.js"],
        });
        return browser.tabs.sendMessage(tabId, request);
      }
    },
    executeEval: async (tabId, payload) => {
      const [result] = await browser.scripting.executeScript({
        target: { tabId, allFrames: false },
        world: "MAIN",
        func: executeEvalInPage,
        args: [payload],
      });
      if (result === undefined) {
        throw new Error("Firefox did not return an eval result.");
      }
      if (result.error !== undefined) {
        throw new Error(result.error.message);
      }
      if (result.result === undefined) {
        throw new Error("Firefox did not return an eval payload.");
      }
      return result.result;
    },
  },
  connectNative: (name) => browser.runtime.connectNative(name),
  productVersion: manifest.version,
  storageAdapter: {
    getPairToken: async () => {
      const result = await browser.storage.local.get("pairToken");
      return typeof result.pairToken === "string" ? result.pairToken : null;
    },
    setPairToken: async (pairToken) => {
      await browser.storage.local.set({ pairToken });
    },
  },
});

controller.start();

browser.runtime.onMessage.addListener((message: { readonly type?: string }) =>
  controller.handleRuntimeMessage(message),
);

function toWindowSnapshot(window: {
  readonly id?: number;
  readonly focused?: boolean;
  readonly incognito?: boolean;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
  readonly tabs?: readonly BrowserTab[];
}) {
  if (window.id === undefined) {
    throw new Error("Firefox did not return a window ID.");
  }

  return {
    id: window.id,
    focused: window.focused === true,
    ...(window.incognito === undefined ? {} : { private: window.incognito }),
    ...(window.left === undefined ? {} : { left: window.left }),
    ...(window.top === undefined ? {} : { top: window.top }),
    ...(window.width === undefined ? {} : { width: window.width }),
    ...(window.height === undefined ? {} : { height: window.height }),
    tabs: (window.tabs ?? []).map(toTabSummary),
  };
}

function hasWindowId(window: BrowserWindow): window is BrowserWindow & { readonly id: number } {
  return window.id !== undefined;
}

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

function toTabSummary(tab: BrowserTab) {
  return {
    id: tab.id,
    index: tab.index,
    active: tab.active,
    ...(tab.title === undefined ? {} : { title: tab.title }),
    ...(tab.url === undefined ? {} : { url: tab.url }),
    windowId: tab.windowId,
    ...(tab.incognito === undefined ? {} : { private: tab.incognito }),
    ...(tab.cookieStoreId === undefined ? {} : { cookieStoreId: tab.cookieStoreId }),
  };
}
