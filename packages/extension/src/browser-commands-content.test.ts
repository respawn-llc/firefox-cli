import { createRequest } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { handleBrowserRequest } from "./browser-commands.js";
import { FakeBrowserAdapter, tabSummary, windowSnapshot } from "./browser-commands-test-utils.js";

describe("browser command handling", () => {
  it("rejects private-window eval before script execution", async () => {
    const adapter = new FakeBrowserAdapter([
      {
        ...windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { private: true })]),
        private: true,
      },
    ]);

    const response = await handleBrowserRequest(createRequest("eval", { script: "1", source: "argv" }, "eval-private-1"), adapter);

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_CAPABILITY",
      },
    });
    expect(adapter.evalRequests).toEqual([]);
  });

  it("maps eval injection failures to actionable errors", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);
    adapter.evalFailure = new Error("Missing host permission for the tab");

    const response = await handleBrowserRequest(createRequest("eval", { script: "1", source: "argv" }, "eval-1"), adapter);

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "SCRIPT_INJECTION_FAILED",
      },
    });
    expect(response.ok ? "" : response.error.message).toContain("Open a normal web page");
  });

  it("captures JPEG screenshots with quality options and returns image bytes", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);
    adapter.screenshotDataUrl = "data:image/jpeg;base64,AQID";

    const response = await handleBrowserRequest(
      createRequest("screenshot", { path: "/tmp/page.jpg", format: "jpeg", quality: 80 }, "screenshot-jpeg-1"),
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
    expect(adapter.captureRequests).toEqual([{ windowId: 10, options: { format: "jpeg", quality: 80 } }]);
  });

  it("returns explicit unsupported error for full-page screenshots", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

    await expect(
      handleBrowserRequest(createRequest("screenshot", { path: "/tmp/page.png", format: "png", fullPage: true }, "screenshot-full-1"), adapter),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_CAPABILITY" },
    });
    expect(adapter.captureRequests).toEqual([]);
  });

  it("routes interactions to content script and adds target metadata", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

    const response = await handleBrowserRequest(createRequest("click", { selector: "button" }, "click-1"), adapter);

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
      handleBrowserRequest(createRequest("download", { url: "https://example.test/file.txt", filename: "file.txt", saveAs: true }, "download-1"), adapter),
    ).resolves.toMatchObject({
      ok: true,
      result: { id: 1, filename: "file.txt", state: "complete" },
    });
    expect(adapter.downloads).toEqual([{ url: "https://example.test/file.txt", filename: "file.txt", saveAs: true }]);
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

    await expect(handleBrowserRequest(createRequest("clipboard", { action: "write", text: "Manual" }, "cw"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { action: "write", ok: true },
    });
    expect(adapter.clipboardText).toBe("Manual");
    await expect(handleBrowserRequest(createRequest("clipboard", { action: "read" }, "cr"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { action: "read", ok: true, text: "Manual" },
    });
    await expect(handleBrowserRequest(createRequest("clipboard", { action: "copy", selector: "#copy" }, "cc"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { action: "copy", text: "Copied" },
    });
    expect(adapter.clipboardText).toBe("Copied");
    adapter.clipboardText = "Pasted";
    await expect(handleBrowserRequest(createRequest("clipboard", { action: "paste", selector: "#paste" }, "cp"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { action: "paste", ok: true },
    });

    await expect(
      handleBrowserRequest(createRequest("cookies", { action: "set", url: "https://example.test/", name: "sid", value: "1" }, "cookie-set"), adapter),
    ).resolves.toMatchObject({
      ok: true,
      result: { action: "set", cookie: { name: "sid", value: "1" } },
    });
    await expect(
      handleBrowserRequest(createRequest("cookies", { action: "get", url: "https://example.test/", name: "sid" }, "cookie-get"), adapter),
    ).resolves.toMatchObject({ ok: true, result: { action: "get", cookie: { name: "sid" } } });
    await expect(
      handleBrowserRequest(createRequest("network", { action: "list", urlGlob: "example.test/api" }, "network-list"), adapter),
    ).resolves.toMatchObject({
      ok: true,
      result: { action: "list", requests: [{ id: "1", url: "https://example.test/api" }] },
    });
    expect(adapter.networkListRequests).toEqual([{ tabId: 101, urlGlob: "example.test/api" }]);
    await expect(handleBrowserRequest(createRequest("network", { action: "clear" }, "network-clear"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { action: "clear", ok: true },
    });
    expect(adapter.networkClearRequests).toEqual([{ tabId: 101 }]);
    expect(adapter.networkRequests).toEqual([]);

    await expect(handleBrowserRequest(createRequest("set.viewport", { width: 1200, height: 800 }, "viewport-1"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { window: { id: 10, width: 1200, height: 800 } },
    });
    await expect(handleBrowserRequest(createRequest("pdf", { path: "/tmp/page.pdf" }, "pdf-1"), adapter)).resolves.toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_CAPABILITY" },
    });

    await expect(handleBrowserRequest(createRequest("find", { kind: "role", value: "button" }, "find-1"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { target: { tabId: 101 }, elements: [{ role: "button" }] },
    });
    await expect(handleBrowserRequest(createRequest("frame", {}, "frame-1"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { target: { tabId: 101 }, frames: [{ index: 0 }] },
    });
    await expect(handleBrowserRequest(createRequest("dialog", { action: "status" }, "dialog-1"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { action: "status", handled: false },
    });
    await expect(handleBrowserRequest(createRequest("storage", { area: "local", action: "clear" }, "storage-1"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { action: "clear", ok: true },
    });
    await expect(handleBrowserRequest(createRequest("console", { action: "list" }, "console-1"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { action: "list", entries: [] },
    });
    await expect(handleBrowserRequest(createRequest("errors", { action: "list" }, "errors-1"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { action: "list", errors: [] },
    });
    await expect(handleBrowserRequest(createRequest("highlight", { selector: "#save" }, "highlight-1"), adapter)).resolves.toMatchObject({
      ok: true,
      result: { target: { tabId: 101 }, element: { role: "button" } },
    });
    await expect(
      handleBrowserRequest(createRequest("diff", { kind: "url", expected: "https://example.test/app" }, "diff-url"), adapter),
    ).resolves.toMatchObject({ ok: true, result: { kind: "url", matches: true } });
    await expect(handleBrowserRequest(createRequest("diff", { kind: "title", expected: "Wrong" }, "diff-title"), adapter)).resolves.toMatchObject({
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
});
