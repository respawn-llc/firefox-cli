import { parseBoundaryRequest, type RequestEnvelope } from "@firefox-cli/protocol";
import type { BackgroundBrowserAdapter, BrowserWindowSnapshot } from "./browser-commands.js";
import { actionParamsFor, fakeContentResponse } from "./browser-commands-test-responses.js";
import type { EvalExecutorPayload, EvalExecutorResult } from "./eval-executor.js";

export { actionParamsFor };

export const ONE_BY_ONE_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const ONE_BY_ONE_PNG_DATA_URL = `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`;

export function parseTestBrowserRequest(raw: {
  readonly protocolVersion: number;
  readonly id: string;
  readonly command: string;
  readonly params: unknown;
}): RequestEnvelope {
  const parsed = parseBoundaryRequest("host-to-extension", raw, { protocolVersion: raw.protocolVersion });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
}

export class FakeBrowserAdapter implements BackgroundBrowserAdapter {
  readonly selectedTabs: number[] = [];
  readonly focusedWindows: number[] = [];
  readonly navigations: { readonly tabId: number; readonly url: string }[] = [];
  readonly contentRequests: { readonly tabId: number; readonly command: string }[] = [];
  readonly contentRequestVersions: number[] = [];
  readonly evalRequests: { readonly tabId: number; readonly payload: EvalExecutorPayload }[] = [];
  readonly captureRequests: {
    readonly windowId: number;
    readonly options: { readonly format: "png" | "jpeg"; readonly quality?: number };
  }[] = [];
  readonly downloads: {
    readonly url: string;
    readonly filename?: string;
    readonly saveAs?: boolean;
  }[] = [];
  readonly downloadWaits: {
    readonly downloadId?: number;
    readonly filenameGlob?: string;
    readonly timeoutMs: number;
    readonly intervalMs: number;
  }[] = [];
  readonly networkListRequests: { readonly tabId: number; readonly urlGlob?: string }[] = [];
  readonly networkClearRequests: { readonly tabId: number; readonly urlGlob?: string }[] = [];
  readonly networkIdleWaits: {
    readonly tabId: number;
    readonly timeoutMs: number;
    readonly idleMs: number;
  }[] = [];
  readonly notifications: { readonly id?: string; readonly title: string; readonly message?: string }[] = [];
  readonly extensionPages: string[] = [];
  clipboardText = "";
  networkRequests: { readonly id: string; readonly tabId: number; readonly url: string }[] = [];
  listWindowCalls = 0;
  contentFailure: Error | undefined;
  contentResponse: unknown = undefined;
  evalFailure: Error | undefined;
  evalResult: EvalExecutorResult | undefined;
  captureFailure: Error | undefined;
  selectFailure: Error | undefined;
  hostAccess = true;
  captureDelayMs: number | undefined;
  screenshotDataUrl = ONE_BY_ONE_PNG_DATA_URL;
  #windows: BrowserWindowSnapshot[];
  #nextTabId = 102;

  constructor(windows: readonly BrowserWindowSnapshot[]) {
    this.#windows = [...windows];
  }

  async hasRequiredHostAccess(): Promise<boolean> {
    return this.hostAccess;
  }

  async listWindows(): Promise<readonly BrowserWindowSnapshot[]> {
    this.listWindowCalls += 1;
    return this.#windows;
  }

  async createTab(options: { readonly url?: string; readonly windowId?: number }): Promise<BrowserWindowSnapshot["tabs"][number]> {
    const window = this.#windows.find((candidate) => candidate.id === options.windowId);
    if (window === undefined) {
      throw new Error("window not found");
    }
    const tab = tabSummary(this.#nextTabId, window.tabs.length, true, window.id, {
      ...(options.url === undefined ? {} : { url: options.url }),
    });
    this.#nextTabId += 1;
    this.#windows = this.#windows.map((candidate) =>
      candidate.id === window.id
        ? {
            ...candidate,
            tabs: [...candidate.tabs.map((existing) => ({ ...existing, active: false })), tab],
          }
        : candidate,
    );
    return tab;
  }

  async selectTab(tabId: number): Promise<BrowserWindowSnapshot["tabs"][number]> {
    this.selectedTabs.push(tabId);
    if (this.selectFailure !== undefined) {
      throw this.selectFailure;
    }
    const match = findTab(this.#windows, tabId);
    if (match === undefined) {
      throw new Error("tab not found");
    }
    this.#windows = this.#windows.map((window) => ({
      ...window,
      focused: window.id === match.window.id,
      tabs: window.tabs.map((tab) => ({ ...tab, active: tab.id === tabId })),
    }));
    return { ...match.tab, active: true };
  }

  async closeTab(tabId: number): Promise<void> {
    this.#windows = this.#windows.map((window) => ({
      ...window,
      tabs: window.tabs.filter((tab) => tab.id !== tabId),
    }));
  }

  async createWindow(): Promise<BrowserWindowSnapshot> {
    throw new Error("not implemented");
  }

  async focusWindow(windowId: number): Promise<BrowserWindowSnapshot> {
    this.focusedWindows.push(windowId);
    const window = this.#windows.find((candidate) => candidate.id === windowId);
    if (window === undefined) {
      throw new Error("window not found");
    }
    this.#windows = this.#windows.map((candidate) => ({
      ...candidate,
      focused: candidate.id === windowId,
    }));
    return { ...window, focused: true };
  }

  async closeWindow(windowId: number): Promise<void> {
    this.#windows = this.#windows.filter((window) => window.id !== windowId);
  }

  async navigateTab(tabId: number, url: string): Promise<BrowserWindowSnapshot["tabs"][number]> {
    this.navigations.push({ tabId, url });
    const match = findTab(this.#windows, tabId);
    if (match === undefined) {
      throw new Error("tab not found");
    }
    const navigated = { ...match.tab, url };
    this.#windows = this.#windows.map((window) => ({
      ...window,
      tabs: window.tabs.map((tab) => (tab.id === tabId ? navigated : tab)),
    }));
    return navigated;
  }

  async goBack(tabId: number): Promise<BrowserWindowSnapshot["tabs"][number]> {
    return this.#navigationNoop(tabId);
  }

  async goForward(tabId: number): Promise<BrowserWindowSnapshot["tabs"][number]> {
    return this.#navigationNoop(tabId);
  }

  async reload(tabId: number): Promise<BrowserWindowSnapshot["tabs"][number]> {
    return this.#navigationNoop(tabId);
  }

  async sendContentRequest(tabId: number, request: RequestEnvelope): Promise<unknown> {
    this.contentRequests.push({ tabId, command: request.command });
    this.contentRequestVersions.push(request.protocolVersion);
    if (this.contentFailure !== undefined) {
      throw this.contentFailure;
    }
    if (this.contentResponse !== undefined) {
      return this.contentResponse;
    }

    return fakeContentResponse(request);
  }

  async executeEval(tabId: number, payload: EvalExecutorPayload): Promise<EvalExecutorResult> {
    this.evalRequests.push({ tabId, payload });
    if (this.evalFailure !== undefined) {
      throw this.evalFailure;
    }

    return (
      this.evalResult ?? {
        ok: true,
        value: {
          type: "json",
          value: "Eval result",
        },
        elapsedMs: 4,
      }
    );
  }

  async captureVisibleTab(windowId: number, options: { readonly format: "png" | "jpeg"; readonly quality?: number }): Promise<string> {
    this.captureRequests.push({ windowId, options });
    if (this.captureFailure !== undefined) {
      throw this.captureFailure;
    }
    if (this.captureDelayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, this.captureDelayMs));
    }

    return this.screenshotDataUrl;
  }

  async download(options: { readonly url: string; readonly filename?: string; readonly saveAs?: boolean }) {
    this.downloads.push(options);
    return { id: this.downloads.length, filename: options.filename, state: "complete" };
  }

  async waitForDownload(options: { readonly downloadId?: number; readonly filenameGlob?: string; readonly timeoutMs: number; readonly intervalMs: number }) {
    this.downloadWaits.push(options);
    return {
      id: options.downloadId ?? 1,
      ...(options.filenameGlob === undefined ? {} : { filename: options.filenameGlob }),
      state: "complete",
    };
  }

  async readClipboard(): Promise<string> {
    return this.clipboardText;
  }

  async writeClipboard(text: string): Promise<void> {
    this.clipboardText = text;
  }

  async listCookies(options: { readonly url: string; readonly name?: string }) {
    return [
      {
        name: options.name ?? "session",
        value: "test",
        domain: new URL(options.url).hostname,
        path: "/",
      },
    ];
  }

  async setCookie(options: { readonly name: string; readonly value: string }) {
    return { name: options.name, value: options.value, path: "/" };
  }

  async removeCookie(): Promise<void> {
    await Promise.resolve();
  }

  async listNetworkRequests(options: { readonly tabId: number; readonly urlGlob?: string }) {
    this.networkListRequests.push(options);
    return this.networkRequests
      .filter((request) => request.tabId === options.tabId)
      .filter((request) => options.urlGlob === undefined || request.url.includes(options.urlGlob));
  }

  async clearNetworkRequests(options: { readonly tabId: number; readonly urlGlob?: string }): Promise<void> {
    this.networkClearRequests.push(options);
    this.networkRequests = this.networkRequests.filter(
      (request) => request.tabId !== options.tabId || (options.urlGlob !== undefined && !request.url.includes(options.urlGlob)),
    );
  }

  async waitForNetworkIdle(options: { readonly tabId: number; readonly timeoutMs: number; readonly idleMs: number }): Promise<void> {
    this.networkIdleWaits.push(options);
  }

  async showNotification(options: { readonly id?: string; readonly title: string; readonly message?: string }) {
    this.notifications.push(options);
    return { ok: true as const, id: options.id ?? `notification-${String(this.notifications.length)}` };
  }

  async openExtensionPage(path: string): Promise<string> {
    this.extensionPages.push(path);
    return `moz-extension://test/${path}`;
  }

  async resizeWindow(windowId: number, size: { readonly width: number; readonly height: number }): Promise<BrowserWindowSnapshot> {
    const window = this.#windows.find((candidate) => candidate.id === windowId);
    if (window === undefined) {
      throw new Error("window not found");
    }
    const resized = { ...window, width: size.width, height: size.height };
    this.#windows = this.#windows.map((candidate) => (candidate.id === windowId ? resized : candidate));
    return resized;
  }

  #navigationNoop(tabId: number): BrowserWindowSnapshot["tabs"][number] {
    const match = findTab(this.#windows, tabId);
    if (match === undefined) {
      throw new Error("tab not found");
    }
    return match.tab;
  }
}

export function windowSnapshot(id: number, focused: boolean, tabs: readonly BrowserWindowSnapshot["tabs"][number][]): BrowserWindowSnapshot {
  return {
    id,
    focused,
    private: false,
    tabs,
  };
}

type TabSummaryArgs = readonly [
  id: number,
  index: number,
  active: boolean,
  windowId: number,
  options?: { readonly title?: string; readonly url?: string; readonly private?: boolean },
];

export function tabSummary(...[id, index, active, windowId, options = {}]: TabSummaryArgs): BrowserWindowSnapshot["tabs"][number] {
  return {
    id,
    index,
    active,
    title: options.title ?? `Tab ${String(id)}`,
    url: options.url ?? `https://example.com/${String(id)}`,
    windowId,
    private: options.private ?? false,
  };
}

function findTab(
  windows: readonly BrowserWindowSnapshot[],
  tabId: number,
):
  | {
      readonly window: BrowserWindowSnapshot;
      readonly tab: BrowserWindowSnapshot["tabs"][number];
    }
  | undefined {
  for (const window of windows) {
    const tab = window.tabs.find((candidate) => candidate.id === tabId);
    if (tab !== undefined) {
      return { window, tab };
    }
  }

  return undefined;
}
