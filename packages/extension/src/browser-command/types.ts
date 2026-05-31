import type {
  DownloadResult,
  NetworkResult,
  CookieResult,
  RequestEnvelope,
  ResolvedTarget,
  TabSummary,
} from "@firefox-cli/protocol";
import type { EvalExecutorPayload, EvalExecutorResult } from "../eval-executor.js";

export type BrowserWindowSnapshot = {
  readonly id: number;
  readonly focused: boolean;
  readonly private?: boolean;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
  readonly tabs: readonly TabSummary[];
};

export type BackgroundBrowserAdapter = {
  hasRequiredHostAccess(): Promise<boolean>;
  listWindows(): Promise<readonly BrowserWindowSnapshot[]>;
  createTab(options: { readonly url?: string; readonly windowId?: number }): Promise<TabSummary>;
  selectTab(tabId: number): Promise<TabSummary>;
  closeTab(tabId: number): Promise<void>;
  createWindow(options: { readonly url?: string }): Promise<BrowserWindowSnapshot>;
  focusWindow(windowId: number): Promise<BrowserWindowSnapshot>;
  closeWindow(windowId: number): Promise<void>;
  navigateTab(tabId: number, url: string): Promise<TabSummary>;
  goBack(tabId: number): Promise<TabSummary>;
  goForward(tabId: number): Promise<TabSummary>;
  reload(tabId: number): Promise<TabSummary>;
  sendContentRequest(tabId: number, request: RequestEnvelope): Promise<unknown>;
  executeEval(tabId: number, payload: EvalExecutorPayload): Promise<EvalExecutorResult>;
  captureVisibleTab(
    windowId: number,
    options: { readonly format: "png" | "jpeg"; readonly quality?: number },
  ): Promise<string>;
  download(options: {
    readonly url: string;
    readonly filename?: string;
    readonly saveAs?: boolean;
  }): Promise<DownloadResult>;
  waitForDownload(options: {
    readonly downloadId?: number;
    readonly filenameGlob?: string;
    readonly timeoutMs: number;
    readonly intervalMs: number;
  }): Promise<DownloadResult>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  listCookies(options: { readonly url: string; readonly name?: string }): Promise<CookieResult["cookies"]>;
  setCookie(options: {
    readonly url: string;
    readonly name: string;
    readonly value: string;
    readonly domain?: string;
    readonly path?: string;
  }): Promise<NonNullable<CookieResult["cookie"]>>;
  removeCookie(options: { readonly url: string; readonly name: string }): Promise<void>;
  listNetworkRequests(options: {
    readonly tabId: number;
    readonly urlGlob?: string;
  }): Promise<NonNullable<NetworkResult["requests"]>>;
  clearNetworkRequests(options: { readonly tabId: number; readonly urlGlob?: string }): Promise<void>;
  waitForNetworkIdle(options: {
    readonly tabId: number;
    readonly timeoutMs: number;
    readonly idleMs: number;
  }): Promise<void>;
  resizeWindow(
    windowId: number,
    size: { readonly width: number; readonly height: number },
  ): Promise<BrowserWindowSnapshot>;
};

export type OrderedWindow = BrowserWindowSnapshot & {
  readonly index: number;
  readonly tabs: readonly TabSummary[];
};

export type ResolvedBrowserTarget = {
  readonly window: OrderedWindow;
  readonly tab: TabSummary;
  readonly target: ResolvedTarget;
};
