import {
  PROTOCOL_VERSION,
  createOkResponse,
  createRequest,
  type ActionKind,
  type RequestEnvelope,
} from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { ACTION_COMMANDS, isActionCommand } from "./action-commands.js";
import {
  handleBrowserRequest,
  type BackgroundBrowserAdapter,
  type BrowserWindowSnapshot,
} from "./browser-commands.js";

describe("browser command handling", () => {
  it("lists tabs for the focused window using deterministic window ordering", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("tabs.list", {}, "request-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        target: {
          windowId: 10,
          windowIndex: 0,
          tabId: 101,
        },
        tabs: [{ id: 101 }],
      },
    });
  });

  it("selects a tab by Firefox ID across windows", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("tab.select", { target: { tab: { kind: "id", id: 201 } } }, "request-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        target: {
          windowId: 20,
          tabId: 201,
        },
      },
    });
    expect(adapter.selectedTabs).toEqual([201]);
  });

  it("navigates the resolved active tab without creating a hidden browser session", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("open", { url: "https://example.com/", newTab: false }, "request-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        target: {
          tabId: 101,
          url: "https://example.com/",
        },
      },
    });
    expect(adapter.navigations).toEqual([{ tabId: 101, url: "https://example.com/" }]);
  });

  it("creates a new tab in the selected window", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("tab.new", { url: "https://example.com/" }, "request-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        target: {
          windowId: 10,
          tabId: 102,
          url: "https://example.com/",
        },
      },
    });
  });

  it("rejects private-window mutations unless a command is a list command", async () => {
    const adapter = new FakeBrowserAdapter([
      {
        ...windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { private: true })]),
        private: true,
      },
    ]);

    const response = await handleBrowserRequest(
      createRequest("open", { url: "https://example.com/", newTab: false }, "request-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_CAPABILITY",
      },
    });
  });

  it("rejects new-tab and window mutations in private windows", async () => {
    const adapter = new FakeBrowserAdapter([
      { ...windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]), private: true },
    ]);

    await expect(
      handleBrowserRequest(createRequest("tab.new", {}, "tab-new-1"), adapter),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_CAPABILITY" },
    });
    await expect(
      handleBrowserRequest(
        createRequest("window.close", { target: { window: { kind: "active" } } }, "window-close-1"),
        adapter,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_CAPABILITY" },
    });
  });

  it("routes snapshots to the resolved tab content script and adds target metadata", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const request = createRequest("snapshot", { interactiveOnly: true }, "snapshot-1");
    const response = await handleBrowserRequest(request, adapter);

    expect(response).toMatchObject({
      ok: true,
      result: {
        target: {
          tabId: 101,
        },
        text: '@e1 button "Submit"',
        generationId: "g1",
        refs: 1,
      },
    });
    expect(adapter.contentRequests).toEqual([{ tabId: 101, command: "snapshot" }]);
  });

  it("routes ref resolution to the same tab content registry across CLI invocations", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    await handleBrowserRequest(
      createRequest("snapshot", { interactiveOnly: true }, "snapshot-1"),
      adapter,
    );
    const response = await handleBrowserRequest(
      createRequest("ref.resolve", { ref: "@e1", generationId: "g1" }, "ref-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        target: {
          tabId: 101,
        },
        element: {
          ref: "@e1",
          generationId: "g1",
          role: "button",
        },
      },
    });
    expect(adapter.contentRequests).toEqual([
      { tabId: 101, command: "snapshot" },
      { tabId: 101, command: "ref.resolve" },
    ]);
  });

  it("gets tab title and URL from resolved target metadata without content injection", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [
        tabSummary(101, 0, true, 10, { url: "https://example.test/", title: "Example title" }),
      ]),
    ]);

    await expect(
      handleBrowserRequest(createRequest("get", { kind: "title" }, "get-title-1"), adapter),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        kind: "title",
        value: "Example title",
        target: {
          tabId: 101,
        },
      },
    });
    await expect(
      handleBrowserRequest(createRequest("get", { kind: "url" }, "get-url-1"), adapter),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        kind: "url",
        value: "https://example.test/",
      },
    });
    expect(adapter.contentRequests).toEqual([]);
  });

  it("routes element getters to the resolved tab content script and adds target metadata", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("get", { kind: "text", selector: "#main" }, "get-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        kind: "text",
        value: "Submit",
        target: {
          tabId: 101,
        },
      },
    });
    expect(adapter.contentRequests).toEqual([{ tabId: 101, command: "get" }]);
  });

  it("routes element state checks to the resolved tab content script and adds target metadata", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("is", { kind: "visible", selector: "#main" }, "is-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        kind: "visible",
        value: true,
        target: {
          tabId: 101,
        },
      },
    });
    expect(adapter.contentRequests).toEqual([{ tabId: 101, command: "is" }]);
  });

  it("handles duration waits without content injection or browser mutation", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("wait", { kind: "ms", durationMs: 0 }, "wait-ms-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        kind: "ms",
        matched: true,
        elapsedMs: expect.any(Number),
      },
    });
    expect(adapter.contentRequests).toEqual([]);
    expect(adapter.selectedTabs).toEqual([]);
    expect(adapter.navigations).toEqual([]);
  });

  it("waits for URL globs against the resolved tab without content injection", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { url: "https://example.test/app" })]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("wait", { kind: "url", urlGlob: "https://example.test/*" }, "wait-url-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        kind: "url",
        matched: true,
        value: "https://example.test/app",
        target: {
          tabId: 101,
        },
      },
    });
    expect(adapter.contentRequests).toEqual([]);
  });

  it("routes document waits to content script and adds target metadata", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("wait", { kind: "text", text: "Ready" }, "wait-text-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        kind: "text",
        matched: true,
        value: "Ready",
        target: {
          tabId: 101,
        },
      },
    });
    expect(adapter.contentRequests).toEqual([{ tabId: 101, command: "wait" }]);
  });

  it("routes interactions to content script and adds target metadata", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("click", { selector: "button" }, "click-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        action: "click",
        ok: true,
        target: {
          tabId: 101,
        },
        element: {
          role: "button",
        },
      },
    });
    expect(adapter.contentRequests).toEqual([{ tabId: 101, command: "click" }]);
  });

  it("rejects private-window interactions for every action command", async () => {
    for (const command of ACTION_COMMANDS) {
      const adapter = new FakeBrowserAdapter([
        {
          ...windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { private: true })]),
          private: true,
        },
      ]);

      const response = await handleBrowserRequest(
        {
          protocolVersion: PROTOCOL_VERSION,
          id: `${command}-private-1`,
          command,
          params: actionParamsFor(command),
        } as RequestEnvelope,
        adapter,
      );

      expect(response).toMatchObject({
        ok: false,
        error: {
          code: "UNSUPPORTED_CAPABILITY",
        },
      });
      expect(adapter.contentRequests).toEqual([]);
    }
  });

  it("returns TIMEOUT for unsatisfied URL waits", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [
        tabSummary(101, 0, true, 10, { url: "https://example.test/loading" }),
      ]),
    ]);

    const response = await handleBrowserRequest(
      createRequest(
        "wait",
        { kind: "url", urlGlob: "https://example.test/done", timeoutMs: 1, intervalMs: 1 },
        "wait-url-1",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "TIMEOUT",
      },
    });
  });

  it("maps restricted-page getter injection failures to actionable errors", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);
    adapter.contentFailure = new Error("Cannot access a restricted Firefox page");

    const response = await handleBrowserRequest(
      createRequest("is", { kind: "visible", selector: "body" }, "is-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "SCRIPT_INJECTION_FAILED",
      },
    });
  });

  it("maps content-script injection failures to actionable errors", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);
    adapter.contentFailure = new Error("Missing host permission for the tab");

    const response = await handleBrowserRequest(
      createRequest("snapshot", { interactiveOnly: true }, "snapshot-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "SCRIPT_INJECTION_FAILED",
      },
    });
    expect(response.ok ? "" : response.error.message).toContain("Open a normal web page");
  });
});

class FakeBrowserAdapter implements BackgroundBrowserAdapter {
  readonly selectedTabs: number[] = [];
  readonly navigations: { readonly tabId: number; readonly url: string }[] = [];
  readonly contentRequests: { readonly tabId: number; readonly command: string }[] = [];
  contentFailure: Error | undefined;
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

  #navigationNoop(tabId: number): BrowserWindowSnapshot["tabs"][number] {
    const match = findTab(this.#windows, tabId);
    if (match === undefined) {
      throw new Error("tab not found");
    }
    return match.tab;
  }
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

function actionParamsFor(command: string): Record<string, unknown> {
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

function windowSnapshot(
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

function tabSummary(
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
