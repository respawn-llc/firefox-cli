import { createOkResponse, createRequest, type RequestEnvelope } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
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

  it("maps restricted-page getter injection failures to actionable errors", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);
    adapter.contentFailure = new Error("Cannot access a restricted Firefox page");

    const response = await handleBrowserRequest(
      createRequest("get", { kind: "text", selector: "body" }, "get-1"),
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
