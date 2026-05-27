import { PROTOCOL_VERSION, createRequest, type RequestEnvelope } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { ACTION_COMMANDS } from "./action-commands.js";
import { handleBrowserRequest } from "./browser-commands.js";
import {
  FakeBrowserAdapter,
  actionParamsFor,
  tabSummary,
  windowSnapshot,
} from "./browser-commands-test-utils.js";

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

  it("runs eval in the resolved tab main world and adds target metadata", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("eval", { script: "document.title", source: "argv" }, "eval-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        value: {
          type: "json",
          value: "Eval result",
        },
        target: {
          tabId: 101,
        },
      },
    });
    expect(adapter.evalRequests).toEqual([
      {
        tabId: 101,
        payload: {
          script: "document.title",
          timeoutMs: 30_000,
          maxResultBytes: 900_000,
        },
      },
    ]);
    expect(adapter.contentRequests).toEqual([]);
  });

  it("rejects private-window eval before script execution", async () => {
    const adapter = new FakeBrowserAdapter([
      {
        ...windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { private: true })]),
        private: true,
      },
    ]);

    const response = await handleBrowserRequest(
      createRequest("eval", { script: "1", source: "argv" }, "eval-private-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_CAPABILITY",
      },
    });
    expect(adapter.evalRequests).toEqual([]);
  });

  it("maps eval injection failures to actionable errors", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);
    adapter.evalFailure = new Error("Missing host permission for the tab");

    const response = await handleBrowserRequest(
      createRequest("eval", { script: "1", source: "argv" }, "eval-1"),
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
