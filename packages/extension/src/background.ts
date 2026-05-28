import { FirefoxCliBackgroundController } from "./background-controller.js";
import { executeEvalInPage } from "./eval-executor.js";
import manifest from "./manifest.json" with { type: "json" };

const networkRequests: {
  id: string;
  url: string;
  method?: string;
  type?: string;
  statusCode?: number;
  startedAt: number;
  completedAt?: number;
}[] = [];
const MAX_NETWORK_REQUESTS = 1_000;

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
    captureVisibleTab: (windowId, options) =>
      browser.tabs.captureVisibleTab(windowId, {
        format: options.format,
        ...(options.quality === undefined ? {} : { quality: options.quality }),
      }),
    download: async (options) => {
      const id = await browser.downloads.download({
        url: options.url,
        ...(options.filename === undefined ? {} : { filename: options.filename }),
        ...(options.saveAs === undefined ? {} : { saveAs: options.saveAs }),
      });
      const [item] = await browser.downloads.search({ id });
      return toDownloadResult(item ?? { id });
    },
    waitForDownload: async (options) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < options.timeoutMs) {
        const downloads = await browser.downloads.search(
          options.downloadId === undefined ? {} : { id: options.downloadId },
        );
        const match = downloads.find(
          (download) =>
            (options.downloadId === undefined || download.id === options.downloadId) &&
            (options.filenameGlob === undefined ||
              matchesGlob(download.filename ?? "", options.filenameGlob)),
        );
        if (match?.state === "complete") {
          return toDownloadResult(match);
        }
        if (match?.state === "interrupted") {
          throw new Error(`Download ${String(match.id)} was interrupted.`);
        }
        await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
      }
      throw new Error("Timed out waiting for download.");
    },
    readClipboard: async () => navigator.clipboard.readText(),
    writeClipboard: async (text) => {
      await navigator.clipboard.writeText(text);
    },
    listCookies: async (options) => {
      const cookies = await browser.cookies.getAll({
        url: options.url,
        ...(options.name === undefined ? {} : { name: options.name }),
      });
      return cookies.map(toCookieSummary);
    },
    setCookie: async (options) =>
      toCookieSummary(
        await browser.cookies.set({
          url: options.url,
          name: options.name,
          value: options.value,
          ...(options.domain === undefined ? {} : { domain: options.domain }),
          ...(options.path === undefined ? {} : { path: options.path }),
        }),
      ),
    removeCookie: async (options) => {
      await browser.cookies.remove(options);
    },
    listNetworkRequests: async (options) =>
      networkRequests
        .filter(
          (request) => options.urlGlob === undefined || matchesGlob(request.url, options.urlGlob),
        )
        .map(toNetworkRequestSummary),
    clearNetworkRequests: async () => {
      networkRequests.length = 0;
    },
    waitForNetworkIdle: async (options) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < options.timeoutMs) {
        if (isNetworkIdle(options.idleMs)) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Timed out waiting for network idle.");
    },
    resizeWindow: async (windowId, size) =>
      toWindowSnapshot(await browser.windows.update(windowId, size)),
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

browser.webRequest?.onBeforeRequest?.addListener(
  (details) => {
    networkRequests.push({
      id: String(details.requestId),
      url: details.url,
      ...(details.method === undefined ? {} : { method: details.method }),
      ...(details.type === undefined ? {} : { type: details.type }),
      startedAt: Date.now(),
    });
    pruneNetworkRequests();
  },
  { urls: ["<all_urls>"] },
);

browser.webRequest?.onCompleted?.addListener(markNetworkComplete, { urls: ["<all_urls>"] });
browser.webRequest?.onErrorOccurred?.addListener(markNetworkComplete, { urls: ["<all_urls>"] });

function markNetworkComplete(details: {
  readonly requestId: string | number;
  readonly statusCode?: number;
}): void {
  const existing = networkRequests.find((request) => request.id === String(details.requestId));
  if (existing !== undefined) {
    if (details.statusCode !== undefined) {
      existing.statusCode = details.statusCode;
    }
    existing.completedAt = Date.now();
  }
}

function isNetworkIdle(idleMs: number): boolean {
  if (networkRequests.some((request) => request.completedAt === undefined)) {
    return false;
  }

  const lastActivityAt = Math.max(
    0,
    ...networkRequests.map((request) => request.completedAt ?? request.startedAt),
  );
  return Date.now() - lastActivityAt >= idleMs;
}

function pruneNetworkRequests(): void {
  const extraCount = networkRequests.length - MAX_NETWORK_REQUESTS;
  if (extraCount > 0) {
    networkRequests.splice(0, extraCount);
  }
}

function toNetworkRequestSummary(request: (typeof networkRequests)[number]) {
  return {
    id: request.id,
    url: request.url,
    ...(request.method === undefined ? {} : { method: request.method }),
    ...(request.type === undefined ? {} : { type: request.type }),
    ...(request.statusCode === undefined ? {} : { statusCode: request.statusCode }),
  };
}

function toDownloadResult(item: {
  readonly id?: number;
  readonly filename?: string;
  readonly state?: string;
}) {
  if (item.id === undefined) {
    throw new Error("Firefox did not return a download ID.");
  }
  return {
    id: item.id,
    ...(item.filename === undefined ? {} : { filename: item.filename }),
    ...(item.state === undefined ? {} : { state: item.state }),
  };
}

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

function toCookieSummary(cookie: {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
  readonly path?: string;
}) {
  return {
    name: cookie.name,
    value: cookie.value,
    ...(cookie.domain === undefined ? {} : { domain: cookie.domain }),
    ...(cookie.path === undefined ? {} : { path: cookie.path }),
  };
}

function matchesGlob(value: string, glob: string): boolean {
  return new RegExp(
    `^${glob.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&").replaceAll("*", ".*")}$`,
    "u",
  ).test(value);
}
