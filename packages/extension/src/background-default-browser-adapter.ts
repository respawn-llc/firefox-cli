import type { BackgroundBrowserAdapter } from "./browser-commands.js";

export function createUnconfiguredBrowserAdapter(): BackgroundBrowserAdapter {
  return {
    hasRequiredHostAccess: async () => true,
    listWindows: async () => [],
    createTab: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    selectTab: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    closeTab: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    createWindow: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    focusWindow: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    closeWindow: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    navigateTab: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    goBack: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    goForward: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    reload: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    sendContentRequest: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    executeEval: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    captureVisibleTab: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    download: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    waitForDownload: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    readClipboard: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    writeClipboard: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    listCookies: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    setCookie: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    removeCookie: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    listNetworkRequests: async () => [],
    clearNetworkRequests: async () => undefined,
    waitForNetworkIdle: async () => undefined,
    showNotification: async () => {
      throw new Error("Browser adapter is not configured.");
    },
    resizeWindow: async () => {
      throw new Error("Browser adapter is not configured.");
    },
  };
}
