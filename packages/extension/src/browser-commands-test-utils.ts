import {
  PROTOCOL_VERSION,
  createOkResponse,
  type ActionKind,
  type RequestEnvelope,
} from "@firefox-cli/protocol";
import { isActionCommand } from "./action-commands.js";
import type { BackgroundBrowserAdapter, BrowserWindowSnapshot } from "./browser-commands.js";
import type { EvalExecutorPayload, EvalExecutorResult } from "./eval-executor.js";

export const ONE_BY_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const ONE_BY_ONE_PNG_DATA_URL = `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`;

export class FakeBrowserAdapter implements BackgroundBrowserAdapter {
  readonly selectedTabs: number[] = [];
  readonly focusedWindows: number[] = [];
  readonly navigations: { readonly tabId: number; readonly url: string }[] = [];
  readonly contentRequests: { readonly tabId: number; readonly command: string }[] = [];
  readonly evalRequests: { readonly tabId: number; readonly payload: EvalExecutorPayload }[] = [];
  readonly captureRequests: {
    readonly windowId: number;
    readonly options: { readonly format: "png" };
  }[] = [];
  contentFailure: Error | undefined;
  evalFailure: Error | undefined;
  captureFailure: Error | undefined;
  selectFailure: Error | undefined;
  captureDelayMs: number | undefined;
  screenshotDataUrl = ONE_BY_ONE_PNG_DATA_URL;
  #windows: BrowserWindowSnapshot[];
  #nextTabId = 102;

  constructor(windows: readonly BrowserWindowSnapshot[]) {
    this.#windows = [...windows];
  }

  async listWindows(): Promise<readonly BrowserWindowSnapshot[]> {
    return this.#windows;
  }

  async createTab(options: {
    readonly url?: string;
    readonly windowId?: number;
  }): Promise<BrowserWindowSnapshot["tabs"][number]> {
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
    if (this.contentFailure !== undefined) {
      throw this.contentFailure;
    }

    if (request.command === "ref.resolve") {
      return createOkResponse(request as RequestEnvelope<"ref.resolve">, {
        element: {
          ref: "@e1",
          generationId: "g1",
          tagName: "button",
          role: "button",
          name: "Submit",
          text: "Submit",
          visible: true,
        },
      });
    }

    if (request.command === "get") {
      const getRequest = request as RequestEnvelope<"get">;
      return createOkResponse(getRequest, {
        kind: "text",
        value: "Submit",
        truncated: false,
      });
    }

    if (request.command === "is") {
      return createOkResponse(request as RequestEnvelope<"is">, {
        kind: "visible",
        value: true,
      });
    }

    if (request.command === "wait") {
      return createOkResponse(request as RequestEnvelope<"wait">, {
        kind: "text",
        matched: true,
        elapsedMs: 5,
        value: "Ready",
      });
    }

    if (isActionCommand(request.command)) {
      return fakeActionResponse(request.command, request.id);
    }

    return createOkResponse(request as RequestEnvelope<"snapshot">, {
      generationId: "g1",
      text: '@e1 button "Submit"',
      refs: 1,
      truncated: false,
      frames: [],
    });
  }

  async executeEval(tabId: number, payload: EvalExecutorPayload): Promise<EvalExecutorResult> {
    this.evalRequests.push({ tabId, payload });
    if (this.evalFailure !== undefined) {
      throw this.evalFailure;
    }

    return {
      ok: true,
      value: {
        type: "json",
        value: "Eval result",
      },
      elapsedMs: 4,
    };
  }

  async captureVisibleTab(windowId: number, options: { readonly format: "png" }): Promise<string> {
    this.captureRequests.push({ windowId, options });
    if (this.captureFailure !== undefined) {
      throw this.captureFailure;
    }
    if (this.captureDelayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, this.captureDelayMs));
    }

    return this.screenshotDataUrl;
  }

  #navigationNoop(tabId: number): BrowserWindowSnapshot["tabs"][number] {
    const match = findTab(this.#windows, tabId);
    if (match === undefined) {
      throw new Error("tab not found");
    }
    return match.tab;
  }
}

export function actionParamsFor(command: string): Record<string, unknown> {
  if (command === "fill" || command === "type") {
    return { selector: "input", text: "hello" };
  }
  if (command === "keyboard.type" || command === "keyboard.inserttext") {
    return { text: "hello" };
  }
  if (command === "press") {
    return { key: "Enter" };
  }
  if (command === "select") {
    return { selector: "select", values: ["pro"] };
  }
  if (command === "scroll" || command === "swipe") {
    return { direction: "down" };
  }
  return { selector: "button" };
}

export function windowSnapshot(
  id: number,
  focused: boolean,
  tabs: readonly BrowserWindowSnapshot["tabs"][number][],
): BrowserWindowSnapshot {
  return {
    id,
    focused,
    private: false,
    tabs,
  };
}

export function tabSummary(
  id: number,
  index: number,
  active: boolean,
  windowId: number,
  options: { readonly title?: string; readonly url?: string; readonly private?: boolean } = {},
): BrowserWindowSnapshot["tabs"][number] {
  return {
    id,
    index,
    active,
    title: options.title ?? `Tab ${id}`,
    url: options.url ?? `https://example.com/${id}`,
    windowId,
    private: options.private ?? false,
  };
}

function fakeActionResponse(command: ActionKind, id: string): unknown {
  const element = {
    tagName: "button",
    role: "button",
    visible: true,
    name: "Submit",
  };
  const base = { action: command, ok: true, element };
  return {
    protocolVersion: PROTOCOL_VERSION,
    id,
    ok: true,
    result:
      command === "scroll" || command === "swipe"
        ? { action: command, ok: true, scroll: { x: 0, y: 10 } }
        : command === "select"
          ? { ...base, selectedValues: ["Submit"] }
          : command === "fill" ||
              command === "type" ||
              command === "keyboard.type" ||
              command === "keyboard.inserttext"
            ? { ...base, valueLength: 6 }
            : base,
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
