import { getExtensionPermissionRequirements } from "@firefox-cli/protocol";
import type { BackgroundBrowserAdapter } from "./background-controller.js";
import { createBrowserCommandDeadline } from "./browser-command/deadline.js";
import {
  createContentScriptInjectionState,
  deliverContentScriptRequest,
  type ContentScriptInjectionState,
} from "./content-script-delivery.js";
import { executeEvalInPage } from "./eval-executor.js";
import { createGlobMatcher } from "./glob.js";
import type { NetworkRequestTracker } from "./network-tracker.js";

export function createBackgroundBrowserAdapter(options: {
  readonly browser: typeof browser;
  readonly networkTracker: NetworkRequestTracker;
  readonly clipboard?: Pick<typeof navigator.clipboard, "readText" | "writeText">;
  readonly contentScriptState?: ContentScriptInjectionState;
}): BackgroundBrowserAdapter {
  const clipboard = options.clipboard ?? navigator.clipboard;
  const requiredHostAccess = {
    origins: getExtensionPermissionRequirements().popupApprovalOrigins,
  };
  const contentScriptState = options.contentScriptState ?? createContentScriptInjectionState();
  return {
    hasRequiredHostAccess: async () =>
      options.browser.permissions?.contains(requiredHostAccess) ?? true,
    listWindows: async () => {
      const windows = await options.browser.windows.getAll({ populate: true });
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
    createTab: async (tabOptions) =>
      toTabSummary(
        await options.browser.tabs.create({
          active: true,
          ...(tabOptions.url === undefined ? {} : { url: tabOptions.url }),
          ...(tabOptions.windowId === undefined ? {} : { windowId: tabOptions.windowId }),
        }),
      ),
    selectTab: async (tabId) => {
      const tab = toTabSummary(await options.browser.tabs.update(tabId, { active: true }));
      await options.browser.windows.update(tab.windowId, { focused: true });
      return tab;
    },
    closeTab: async (tabId) => {
      await options.browser.tabs.remove(tabId);
    },
    createWindow: async (windowOptions) =>
      toWindowSnapshot(
        await options.browser.windows.create({
          ...(windowOptions.url === undefined ? {} : { url: windowOptions.url }),
        }),
      ),
    focusWindow: async (windowId) =>
      toWindowSnapshot(await options.browser.windows.update(windowId, { focused: true })),
    closeWindow: async (windowId) => {
      await options.browser.windows.remove(windowId);
    },
    navigateTab: async (tabId, url) =>
      toTabSummary(await options.browser.tabs.update(tabId, { active: true, url })),
    goBack: async (tabId) => {
      await options.browser.tabs.goBack(tabId);
      return toTabSummary(await options.browser.tabs.get(tabId));
    },
    goForward: async (tabId) => {
      await options.browser.tabs.goForward(tabId);
      return toTabSummary(await options.browser.tabs.get(tabId));
    },
    reload: async (tabId) => {
      await options.browser.tabs.reload(tabId);
      return toTabSummary(await options.browser.tabs.get(tabId));
    },
    captureVisibleTab: (windowId, captureOptions) =>
      options.browser.tabs.captureVisibleTab(windowId, {
        format: captureOptions.format,
        ...(captureOptions.quality === undefined ? {} : { quality: captureOptions.quality }),
      }),
    download: async (downloadOptions) => {
      const id = await options.browser.downloads.download({
        url: downloadOptions.url,
        ...(downloadOptions.filename === undefined ? {} : { filename: downloadOptions.filename }),
        ...(downloadOptions.saveAs === undefined ? {} : { saveAs: downloadOptions.saveAs }),
      });
      const [item] = await options.browser.downloads.search({ id });
      return toDownloadResult(item ?? { id });
    },
    waitForDownload: async (waitOptions) => {
      const deadline = createBrowserCommandDeadline(waitOptions.timeoutMs);
      const timeoutMessage = () => "Timed out waiting for download.";
      const matchesFilename =
        waitOptions.filenameGlob === undefined
          ? undefined
          : createGlobMatcher(waitOptions.filenameGlob);
      while (true) {
        const downloads = await deadline.run(
          options.browser.downloads.search(
            waitOptions.downloadId === undefined ? {} : { id: waitOptions.downloadId },
          ),
          timeoutMessage,
        );
        const match = downloads.find(
          (download) =>
            (waitOptions.downloadId === undefined || download.id === waitOptions.downloadId) &&
            (matchesFilename === undefined || matchesFilename(download.filename ?? "")),
        );
        if (match?.state === "complete") {
          return toDownloadResult(match);
        }
        if (match?.state === "interrupted") {
          throw new Error(`Download ${String(match.id)} was interrupted.`);
        }
        deadline.throwIfExpired(timeoutMessage);
        await deadline.sleep(waitOptions.intervalMs, timeoutMessage);
      }
    },
    readClipboard: async () => clipboard.readText(),
    writeClipboard: async (text) => {
      await clipboard.writeText(text);
    },
    listCookies: async (cookieOptions) => {
      const cookies = await options.browser.cookies.getAll({
        url: cookieOptions.url,
        ...(cookieOptions.name === undefined ? {} : { name: cookieOptions.name }),
      });
      return cookies.map(toCookieSummary);
    },
    setCookie: async (cookieOptions) =>
      toCookieSummary(
        await options.browser.cookies.set({
          url: cookieOptions.url,
          name: cookieOptions.name,
          value: cookieOptions.value,
          ...(cookieOptions.domain === undefined ? {} : { domain: cookieOptions.domain }),
          ...(cookieOptions.path === undefined ? {} : { path: cookieOptions.path }),
        }),
      ),
    removeCookie: async (cookieOptions) => {
      await options.browser.cookies.remove(cookieOptions);
    },
    listNetworkRequests: async (networkOptions) =>
      options.networkTracker.list({
        tabId: networkOptions.tabId,
        ...(networkOptions.urlGlob === undefined ? {} : { urlGlob: networkOptions.urlGlob }),
      }),
    clearNetworkRequests: async (networkOptions) => {
      options.networkTracker.clear({
        tabId: networkOptions.tabId,
        ...(networkOptions.urlGlob === undefined ? {} : { urlGlob: networkOptions.urlGlob }),
      });
    },
    waitForNetworkIdle: async (networkOptions) => {
      const deadline = createBrowserCommandDeadline(networkOptions.timeoutMs);
      const timeoutMessage = () => "Timed out waiting for network idle.";
      while (true) {
        if (
          options.networkTracker.isIdle({
            tabId: networkOptions.tabId,
            idleMs: networkOptions.idleMs,
          })
        ) {
          return;
        }
        deadline.throwIfExpired(timeoutMessage);
        await deadline.sleep(100, timeoutMessage);
      }
    },
    resizeWindow: async (windowId, size) => {
      await options.browser.windows.update(windowId, size);
      const windows = await options.browser.windows.getAll({ populate: true });
      const window = windows.find((candidate) => candidate.id === windowId);
      if (window === undefined) {
        throw new Error("Firefox did not return the resized window.");
      }
      return toWindowSnapshot(window);
    },
    sendContentRequest: async (tabId, request) => {
      return deliverContentScriptRequest(
        {
          sendMessage: (targetTabId, contentRequest) =>
            options.browser.tabs.sendMessage(targetTabId, contentRequest),
          injectContentScript: async (targetTabId) => {
            await options.browser.scripting.executeScript({
              target: { tabId: targetTabId, allFrames: false },
              files: ["content.js"],
            });
          },
          markInjected: (targetTabId) => {
            contentScriptState.markInjected(targetTabId);
          },
        },
        tabId,
        request,
      );
    },
    executeEval: async (tabId, payload) => {
      const [result] = await options.browser.scripting.executeScript({
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

function toWindowSnapshot(window: BrowserWindow) {
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

function toTabSummary(tab: BrowserTab) {
  return {
    id: tab.id,
    index: tab.index,
    active: tab.active,
    windowId: tab.windowId,
    ...(tab.title === undefined ? {} : { title: tab.title }),
    ...(tab.url === undefined ? {} : { url: tab.url }),
    ...(tab.incognito === undefined ? {} : { private: tab.incognito }),
    ...(tab.cookieStoreId === undefined ? {} : { cookieStoreId: tab.cookieStoreId }),
  };
}

function toCookieSummary(cookie: BrowserCookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    ...(cookie.domain === undefined ? {} : { domain: cookie.domain }),
    ...(cookie.path === undefined ? {} : { path: cookie.path }),
  };
}
