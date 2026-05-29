import { createRequest } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { handleBrowserRequest } from "./browser-commands.js";
import {
  FakeBrowserAdapter,
  ONE_BY_ONE_PNG_BASE64,
  tabSummary,
  windowSnapshot,
} from "./browser-commands-test-utils.js";

describe("browser screenshot command handling", () => {
  it("captures the active visible tab as PNG metadata with internal image bytes", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("screenshot", { path: "/tmp/page.png", format: "png" }, "screenshot-1"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        path: "/tmp/page.png",
        format: "png",
        bytes: 68,
        width: 1,
        height: 1,
        activation: {
          tabActivated: false,
          windowFocused: false,
        },
        imageBase64: ONE_BY_ONE_PNG_BASE64,
        target: {
          windowId: 10,
          tabId: 101,
        },
      },
    });
    expect(adapter.captureRequests).toEqual([{ windowId: 10, options: { format: "png" } }]);
    expect(adapter.selectedTabs).toEqual([]);
    expect(adapter.focusedWindows).toEqual([]);
    expect(adapter.contentRequests).toEqual([]);
  });

  it("activates and focuses non-visible screenshot targets with diagnostics", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, false, 20), tabSummary(202, 1, true, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest(
        "screenshot",
        { path: "/tmp/page.png", format: "png", target: { tab: { kind: "id", id: 201 } } },
        "screenshot-1",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        activation: {
          tabActivated: true,
          windowFocused: true,
        },
        target: {
          windowId: 20,
          tabId: 201,
        },
      },
    });
    expect(adapter.selectedTabs).toEqual([201]);
    expect(adapter.focusedWindows).toEqual([20]);
    expect(adapter.captureRequests).toEqual([{ windowId: 20, options: { format: "png" } }]);
  });

  it("rejects private-window screenshots before capture or activation", async () => {
    const adapter = new FakeBrowserAdapter([
      {
        ...windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { private: true })]),
        private: true,
      },
    ]);

    const response = await handleBrowserRequest(
      createRequest("screenshot", { path: "/tmp/page.png", format: "png" }, "screenshot-private"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_CAPABILITY",
      },
    });
    expect(adapter.selectedTabs).toEqual([]);
    expect(adapter.focusedWindows).toEqual([]);
    expect(adapter.captureRequests).toEqual([]);
  });

  it("enforces screenshot byte limits after visible capture", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest(
        "screenshot",
        { path: "/tmp/page.png", format: "png", maxImageBytes: 67 },
        "screenshot-large",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "OUTPUT_TOO_LARGE",
      },
    });
    expect(adapter.captureRequests).toEqual([{ windowId: 10, options: { format: "png" } }]);
  });

  it("maps screenshot capture failures to capture errors", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);
    adapter.captureFailure = new Error("capture permission denied");

    const response = await handleBrowserRequest(
      createRequest("screenshot", { path: "/tmp/page.png", format: "png" }, "screenshot-fail"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "CAPTURE_FAILED",
      },
    });
    expect(response.ok ? "" : response.error.message).toContain("capture permission denied");
  });

  it("maps screenshot activation failures before capture", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, false, 10), tabSummary(102, 1, true, 10)]),
    ]);
    adapter.selectFailure = new Error("tab activation blocked");

    const response = await handleBrowserRequest(
      createRequest(
        "screenshot",
        { path: "/tmp/page.png", format: "png", target: { tab: { kind: "id", id: 101 } } },
        "screenshot-activation-fail",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "CAPTURE_FAILED",
      },
    });
    expect(response.ok ? "" : response.error.message).toContain("Failed to activate");
    expect(adapter.captureRequests).toEqual([]);
  });

  it("maps screenshot capture timeouts", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);
    adapter.captureDelayMs = 100;

    const response = await handleBrowserRequest(
      createRequest(
        "screenshot",
        { path: "/tmp/page.png", format: "png", timeoutMs: 1 },
        "screenshot-timeout",
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

  it("rejects non-PNG screenshot data URLs from Firefox", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
    ]);
    adapter.screenshotDataUrl = "data:image/jpeg;base64,AAAA";

    const response = await handleBrowserRequest(
      createRequest("screenshot", { path: "/tmp/page.png", format: "png" }, "screenshot-format"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "CAPTURE_FAILED",
      },
    });
  });
});
