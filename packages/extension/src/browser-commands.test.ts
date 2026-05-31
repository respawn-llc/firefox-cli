import {
  PROTOCOL_VERSION,
  actionKinds,
  commandSchemas,
  createErrorResponse,
  createRequest,
  type CommandId,
  type RequestEnvelope,
} from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { handleBrowserRequest } from "./browser-commands.js";
import {
  FakeBrowserAdapter,
  actionParamsFor,
  tabSummary,
  windowSnapshot,
} from "./browser-commands-test-utils.js";

const browserSmokeRequests = new Map<CommandId, unknown>([
  ["tabs.list", {}],
  ["tab.new", {}],
  ["tab.select", { target: { tab: { kind: "active" } } }],
  ["tab.close", { target: { tab: { kind: "active" } } }],
  ["windows.list", {}],
  ["window.new", {}],
  ["window.select", { target: { window: { kind: "active" } } }],
  ["window.close", { target: { window: { kind: "active" } } }],
  ["open", { url: "https://example.test/done", newTab: false }],
  ["back", {}],
  ["forward", {}],
  ["reload", {}],
  ["snapshot", {}],
  ["ref.resolve", { ref: "@e1", generationId: "g1" }],
  ["get", { kind: "title" }],
  ["is", { kind: "visible", selector: "button" }],
  ["wait", { kind: "url", urlGlob: "https://example.test/*" }],
  ["eval", { script: "document.title", source: "argv" }],
  ["screenshot", { path: "/tmp/page.png", format: "png" }],
  ["drag", actionParamsFor("drag")],
  ["upload", actionParamsFor("upload")],
  ["mouse", actionParamsFor("mouse")],
  ["keydown", actionParamsFor("keydown")],
  ["keyup", actionParamsFor("keyup")],
  ["find", { kind: "text", value: "Submit" }],
  ["frame", {}],
  ["download", { url: "https://example.test/file.txt" }],
  ["dialog", { action: "status" }],
  ["clipboard", { action: "read" }],
  ["cookies", { action: "list", url: "https://example.test/" }],
  ["storage", { area: "local", action: "get" }],
  ["network", { action: "list" }],
  ["console", { action: "list" }],
  ["errors", { action: "list" }],
  ["highlight", { selector: "button" }],
  ["pdf", { path: "/tmp/page.pdf" }],
  ["set.viewport", { width: 1200, height: 800 }],
  ["diff", { kind: "title", expected: "Expected title" }],
  ["batch", { steps: [{ command: "snapshot", params: {} }] }],
  ["click", actionParamsFor("click")],
  ["dblclick", actionParamsFor("dblclick")],
  ["focus", actionParamsFor("focus")],
  ["hover", actionParamsFor("hover")],
  ["fill", actionParamsFor("fill")],
  ["type", actionParamsFor("type")],
  ["press", actionParamsFor("press")],
  ["keyboard.type", actionParamsFor("keyboard.type")],
  ["keyboard.inserttext", actionParamsFor("keyboard.inserttext")],
  ["check", actionParamsFor("check")],
  ["uncheck", actionParamsFor("uncheck")],
  ["select", actionParamsFor("select")],
  ["scroll", actionParamsFor("scroll")],
  ["scrollintoview", actionParamsFor("scrollintoview")],
  ["swipe", actionParamsFor("swipe")],
]);

describe("browser command handling", () => {
  it("has browser handlers for every extension-owned command routed past background control", async () => {
    const expectedCommands = (Object.keys(commandSchemas) as CommandId[]).filter(
      (command) =>
        commandSchemas[command].owner === "extension" &&
        command !== "capabilities" &&
        command !== "noop",
    );

    expect([...browserSmokeRequests.keys()].sort()).toEqual(expectedCommands.sort());

    for (const [command, params] of browserSmokeRequests) {
      const adapter = new FakeBrowserAdapter([
        windowSnapshot(10, true, [
          tabSummary(101, 0, true, 10, {
            url: "https://example.test/done",
            title: "Expected title",
          }),
        ]),
      ]);
      const response = await handleBrowserRequest(
        {
          protocolVersion: PROTOCOL_VERSION,
          id: `${command}-smoke`,
          command,
          params,
        } as RequestEnvelope,
        adapter,
      );

      if (command === "pdf") {
        expect(response).toMatchObject({
          ok: false,
          error: {
            code: "UNSUPPORTED_CAPABILITY",
            message: expect.stringContaining("PDF export is unsupported"),
          },
        });
        continue;
      }

      expect(response).not.toMatchObject({
        ok: false,
        error: { code: "UNSUPPORTED_CAPABILITY" },
      });
    }
  });

  it("rejects page-scoped commands when host approval was revoked", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);
    adapter.hostAccess = false;

    const response = await handleBrowserRequest(
      createRequest("snapshot", {}, "snapshot-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "PERMISSION_DENIED",
        message: expect.stringContaining("Approve host access"),
      },
    });
  });

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

  it("uses local protocol version for same-extension content-script messages", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("snapshot", { interactiveOnly: true }, "snapshot-v1", 1),
      adapter,
    );

    expect(response).toMatchObject({ protocolVersion: 1, ok: true });
    expect(adapter.contentRequestVersions).toEqual([PROTOCOL_VERSION]);
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

  it("preserves URL wait question-mark wildcard glob semantics", async () => {
    const wildcardAdapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { url: "https://example.test/a" })]),
    ]);

    await expect(
      handleBrowserRequest(
        createRequest("wait", { kind: "url", urlGlob: "https://example.test/?" }, "wait-url-q"),
        wildcardAdapter,
      ),
    ).resolves.toMatchObject({ ok: true, result: { value: "https://example.test/a" } });

    const queryAdapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [
        tabSummary(101, 0, true, 10, { url: "https://example.test/api/x=1" }),
      ]),
    ]);

    await expect(
      handleBrowserRequest(
        createRequest(
          "wait",
          { kind: "url", urlGlob: "https://example.test/api?x=1" },
          "wait-url-query",
        ),
        queryAdapter,
      ),
    ).resolves.toMatchObject({ ok: true, result: { value: "https://example.test/api/x=1" } });
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

  it("runs function waits through main-world eval instead of content-script eval", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);
    adapter.evalResult = {
      ok: true,
      value: { type: "json", value: { matched: true, value: true } },
      elapsedMs: 1,
    };

    const response = await handleBrowserRequest(
      createRequest(
        "wait",
        { kind: "function", expression: "document.readyState === 'complete'" },
        "wait-fn-1",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        kind: "function",
        matched: true,
        value: true,
        target: {
          tabId: 101,
        },
      },
    });
    expect(adapter.contentRequests).toEqual([]);
    expect(adapter.evalRequests).toEqual([
      {
        tabId: 101,
        payload: {
          script: expect.stringContaining("document.readyState === 'complete'"),
          timeoutMs: 30_000,
          maxResultBytes: 4096,
        },
      },
    ]);
  });

  it("waits for network idle through the background network tracker", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest(
        "wait",
        { kind: "load-state", state: "networkidle", timeoutMs: 500, intervalMs: 75 },
        "wait-networkidle-1",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        kind: "load-state",
        matched: true,
        target: {
          tabId: 101,
        },
      },
    });
    expect(adapter.networkIdleWaits).toEqual([{ tabId: 101, timeoutMs: 500, idleMs: 75 }]);
    expect(adapter.contentRequests).toEqual([]);
  });

  it("uses the resolved target tab for network-idle waits", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)]),
    ]);

    await expect(
      handleBrowserRequest(
        createRequest(
          "wait",
          {
            target: { tab: { kind: "id", id: 102 } },
            kind: "load-state",
            state: "networkidle",
            timeoutMs: 500,
            intervalMs: 75,
          },
          "wait-networkidle-target",
        ),
        adapter,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        target: { tabId: 102 },
      },
    });
    expect(adapter.networkIdleWaits).toEqual([{ tabId: 102, timeoutMs: 500, idleMs: 75 }]);
  });

  it("lists and clears network requests for the resolved target tab only", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)]),
    ]);
    adapter.networkRequests = [
      { id: "target", tabId: 102, url: "https://example.test/api" },
      { id: "active", tabId: 101, url: "https://example.test/api" },
    ];

    await expect(
      handleBrowserRequest(
        createRequest(
          "network",
          {
            target: { tab: { kind: "id", id: 102 } },
            action: "list",
            urlGlob: "example.test/api",
          },
          "network-list-target",
        ),
        adapter,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        requests: [{ id: "target", url: "https://example.test/api" }],
      },
    });
    await expect(
      handleBrowserRequest(
        createRequest(
          "network",
          { target: { tab: { kind: "id", id: 102 } }, action: "clear" },
          "network-clear-target",
        ),
        adapter,
      ),
    ).resolves.toMatchObject({ ok: true });

    expect(adapter.networkListRequests).toEqual([{ tabId: 102, urlGlob: "example.test/api" }]);
    expect(adapter.networkClearRequests).toEqual([{ tabId: 102 }]);
    expect(adapter.networkRequests).toEqual([
      { id: "active", tabId: 101, url: "https://example.test/api" },
    ]);
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

  it("captures JPEG screenshots with quality options and returns image bytes", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);
    adapter.screenshotDataUrl = "data:image/jpeg;base64,AQID";

    const response = await handleBrowserRequest(
      createRequest(
        "screenshot",
        { path: "/tmp/page.jpg", format: "jpeg", quality: 80 },
        "screenshot-jpeg-1",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        path: "/tmp/page.jpg",
        format: "jpeg",
        bytes: 3,
        imageBase64: "AQID",
        activation: {
          tabActivated: false,
          windowFocused: false,
        },
        target: {
          tabId: 101,
        },
      },
    });
    expect(adapter.captureRequests).toEqual([
      { windowId: 10, options: { format: "jpeg", quality: 80 } },
    ]);
  });

  it("returns explicit unsupported error for full-page screenshots", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    await expect(
      handleBrowserRequest(
        createRequest(
          "screenshot",
          { path: "/tmp/page.png", format: "png", fullPage: true },
          "screenshot-full-1",
        ),
        adapter,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_CAPABILITY" },
    });
    expect(adapter.captureRequests).toEqual([]);
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

  it("handles Phase 8 browser APIs and content-routed command families", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [
        tabSummary(101, 0, true, 10, {
          title: "Example title",
          url: "https://example.test/app",
        }),
      ]),
    ]);
    adapter.networkRequests = [{ id: "1", tabId: 101, url: "https://example.test/api" }];

    await expect(
      handleBrowserRequest(
        createRequest(
          "download",
          { url: "https://example.test/file.txt", filename: "file.txt", saveAs: true },
          "download-1",
        ),
        adapter,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { id: 1, filename: "file.txt", state: "complete" },
    });
    expect(adapter.downloads).toEqual([
      { url: "https://example.test/file.txt", filename: "file.txt", saveAs: true },
    ]);
    await expect(
      handleBrowserRequest(
        createRequest(
          "wait",
          {
            kind: "download",
            downloadId: 1,
            timeoutMs: 500,
            intervalMs: 50,
          },
          "wait-download-1",
        ),
        adapter,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { kind: "download", download: { id: 1, state: "complete" } },
    });
    expect(adapter.downloadWaits).toEqual([{ downloadId: 1, timeoutMs: 500, intervalMs: 50 }]);

    await expect(
      handleBrowserRequest(
        createRequest("clipboard", { action: "write", text: "Manual" }, "cw"),
        adapter,
      ),
    ).resolves.toMatchObject({ ok: true, result: { action: "write", ok: true } });
    expect(adapter.clipboardText).toBe("Manual");
    await expect(
      handleBrowserRequest(createRequest("clipboard", { action: "read" }, "cr"), adapter),
    ).resolves.toMatchObject({
      ok: true,
      result: { action: "read", ok: true, text: "Manual" },
    });
    await expect(
      handleBrowserRequest(
        createRequest("clipboard", { action: "copy", selector: "#copy" }, "cc"),
        adapter,
      ),
    ).resolves.toMatchObject({ ok: true, result: { action: "copy", text: "Copied" } });
    expect(adapter.clipboardText).toBe("Copied");
    adapter.clipboardText = "Pasted";
    await expect(
      handleBrowserRequest(
        createRequest("clipboard", { action: "paste", selector: "#paste" }, "cp"),
        adapter,
      ),
    ).resolves.toMatchObject({ ok: true, result: { action: "paste", ok: true } });

    await expect(
      handleBrowserRequest(
        createRequest(
          "cookies",
          { action: "set", url: "https://example.test/", name: "sid", value: "1" },
          "cookie-set",
        ),
        adapter,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { action: "set", cookie: { name: "sid", value: "1" } },
    });
    await expect(
      handleBrowserRequest(
        createRequest(
          "cookies",
          { action: "get", url: "https://example.test/", name: "sid" },
          "cookie-get",
        ),
        adapter,
      ),
    ).resolves.toMatchObject({ ok: true, result: { action: "get", cookie: { name: "sid" } } });
    await expect(
      handleBrowserRequest(
        createRequest("network", { action: "list", urlGlob: "example.test/api" }, "network-list"),
        adapter,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { action: "list", requests: [{ id: "1", url: "https://example.test/api" }] },
    });
    expect(adapter.networkListRequests).toEqual([{ tabId: 101, urlGlob: "example.test/api" }]);
    await expect(
      handleBrowserRequest(createRequest("network", { action: "clear" }, "network-clear"), adapter),
    ).resolves.toMatchObject({ ok: true, result: { action: "clear", ok: true } });
    expect(adapter.networkClearRequests).toEqual([{ tabId: 101 }]);
    expect(adapter.networkRequests).toEqual([]);

    await expect(
      handleBrowserRequest(
        createRequest("set.viewport", { width: 1200, height: 800 }, "viewport-1"),
        adapter,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { window: { id: 10, width: 1200, height: 800 } },
    });
    await expect(
      handleBrowserRequest(createRequest("pdf", { path: "/tmp/page.pdf" }, "pdf-1"), adapter),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_CAPABILITY" },
    });

    await expect(
      handleBrowserRequest(
        createRequest("find", { kind: "role", value: "button" }, "find-1"),
        adapter,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { target: { tabId: 101 }, elements: [{ role: "button" }] },
    });
    await expect(
      handleBrowserRequest(createRequest("frame", {}, "frame-1"), adapter),
    ).resolves.toMatchObject({
      ok: true,
      result: { target: { tabId: 101 }, frames: [{ index: 0 }] },
    });
    await expect(
      handleBrowserRequest(createRequest("dialog", { action: "status" }, "dialog-1"), adapter),
    ).resolves.toMatchObject({ ok: true, result: { action: "status", handled: false } });
    await expect(
      handleBrowserRequest(
        createRequest("storage", { area: "local", action: "clear" }, "storage-1"),
        adapter,
      ),
    ).resolves.toMatchObject({ ok: true, result: { action: "clear", ok: true } });
    await expect(
      handleBrowserRequest(createRequest("console", { action: "list" }, "console-1"), adapter),
    ).resolves.toMatchObject({ ok: true, result: { action: "list", entries: [] } });
    await expect(
      handleBrowserRequest(createRequest("errors", { action: "list" }, "errors-1"), adapter),
    ).resolves.toMatchObject({ ok: true, result: { action: "list", errors: [] } });
    await expect(
      handleBrowserRequest(
        createRequest("highlight", { selector: "#save" }, "highlight-1"),
        adapter,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { target: { tabId: 101 }, element: { role: "button" } },
    });
    await expect(
      handleBrowserRequest(
        createRequest("diff", { kind: "url", expected: "https://example.test/app" }, "diff-url"),
        adapter,
      ),
    ).resolves.toMatchObject({ ok: true, result: { kind: "url", matches: true } });
    await expect(
      handleBrowserRequest(
        createRequest("diff", { kind: "title", expected: "Wrong" }, "diff-title"),
        adapter,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { kind: "title", matches: false, actual: "Example title" },
    });

    expect(adapter.contentRequests.map((request) => request.command)).toEqual([
      "clipboard",
      "clipboard",
      "find",
      "frame",
      "dialog",
      "storage",
      "console",
      "errors",
      "highlight",
    ]);
  });

  it("strips log truncation metadata for protocol v1 and v2 browser responses", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    for (const protocolVersion of [1, 2]) {
      const consoleResponse = await handleBrowserRequest(
        createRequest(
          "console",
          { action: "list" },
          `console-v${protocolVersion}`,
          protocolVersion,
        ),
        adapter,
      );
      const errorsResponse = await handleBrowserRequest(
        createRequest("errors", { action: "list" }, `errors-v${protocolVersion}`, protocolVersion),
        adapter,
      );
      const batchResponse = await handleBrowserRequest(
        createRequest(
          "batch",
          {
            steps: [
              { command: "console", params: { action: "list" } },
              { command: "errors", params: { action: "list" } },
            ],
          },
          `batch-v${protocolVersion}`,
          protocolVersion,
        ),
        adapter,
      );

      expect(consoleResponse).toMatchObject({ ok: true, protocolVersion });
      expect(errorsResponse).toMatchObject({ ok: true, protocolVersion });
      expect(batchResponse).toMatchObject({ ok: true, protocolVersion });
      if (consoleResponse.ok) {
        expect("truncated" in consoleResponse.result).toBe(false);
        expect("droppedEntries" in consoleResponse.result).toBe(false);
      }
      if (errorsResponse.ok) {
        expect("truncated" in errorsResponse.result).toBe(false);
        expect("droppedEntries" in errorsResponse.result).toBe(false);
      }
      if (batchResponse.ok) {
        const batchResult = batchResponse.result as {
          readonly steps: readonly {
            readonly ok: boolean;
            readonly result: Record<string, unknown>;
          }[];
        };
        const stepResults = batchResult.steps.filter((step) => step.ok);
        expect(stepResults).toHaveLength(2);
        for (const step of stepResults) {
          expect("truncated" in step.result).toBe(false);
          expect("droppedEntries" in step.result).toBe(false);
        }
      }
    }
  });

  it("keeps log truncation metadata for protocol v3 browser responses", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const consoleResponse = await handleBrowserRequest(
      createRequest("console", { action: "list" }, "console-v3"),
      adapter,
    );
    const batchResponse = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          steps: [{ command: "console", params: { action: "list" } }],
        },
        "batch-v3",
      ),
      adapter,
    );

    expect(consoleResponse).toMatchObject({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      result: { truncated: true, droppedEntries: 2 },
    });
    expect(batchResponse).toMatchObject({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      result: {
        steps: [
          {
            ok: true,
            result: { truncated: true, droppedEntries: 2 },
          },
        ],
      },
    });
  });

  it("rejects private-window interactions for every action command", async () => {
    for (const command of actionKinds) {
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

  it("returns TIMEOUT when browser wait target resolution does not answer", async () => {
    class HangingWindowsAdapter extends FakeBrowserAdapter {
      override async listWindows(): Promise<never> {
        return new Promise<never>(() => undefined);
      }
    }
    const adapter = new HangingWindowsAdapter([
      windowSnapshot(10, true, [
        tabSummary(101, 0, true, 10, { url: "https://example.test/loading" }),
      ]),
    ]);

    const response = await handleBrowserRequest(
      createRequest(
        "wait",
        { kind: "url", urlGlob: "https://example.test/done", timeoutMs: 1, intervalMs: 1 },
        "wait-url-hung-target",
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
      createRequest("snapshot", { interactiveOnly: true }, "snapshot-1", 1),
      adapter,
    );

    expect(response).toMatchObject({
      protocolVersion: 1,
      ok: false,
      error: {
        code: "SCRIPT_INJECTION_FAILED",
      },
    });
    expect(response.ok ? "" : response.error.message).toContain("Open a normal web page");
  });

  it("surfaces stale content-script version mismatches without treating them as injection failures", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);
    const request = createRequest("snapshot", { interactiveOnly: true }, "snapshot-1", 1);
    adapter.contentResponse = createErrorResponse(
      "snapshot-1",
      {
        code: "VERSION_MISMATCH",
        message: "Protocol version is not supported.",
        details: { supported: 1, actual: 2 },
      },
      PROTOCOL_VERSION,
    );

    const response = await handleBrowserRequest(request, adapter);

    expect(response).toMatchObject({
      protocolVersion: 1,
      ok: false,
      error: {
        code: "VERSION_MISMATCH",
        message: expect.stringContaining("Reload the tab"),
      },
    });
    expect(adapter.contentRequests).toEqual([{ tabId: 101, command: "snapshot" }]);
  });
});
