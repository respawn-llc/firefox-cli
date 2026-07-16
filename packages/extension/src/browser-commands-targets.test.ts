import { createRequest } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { handleBrowserRequest } from "./browser-commands.js";
import {
  runCase01,
  runCase02,
  runCase03,
  runCase04,
  runCase05,
  runCase06,
  runCase07,
  runCase08,
  runCase09,
  runCase10,
} from "./browser-commands-targets-test-cases.js";
import { FakeBrowserAdapter, tabSummary, windowSnapshot } from "./browser-commands-test-utils.js";

describe("browser command handling", () => {
  it("routes element state checks to the resolved tab content script and adds target metadata", runCase01);
  it("handles duration waits without content injection or browser mutation", runCase02);
  it("waits for URL globs against the resolved tab without content injection", runCase03);
  it("preserves URL wait question-mark wildcard glob semantics", runCase04);
  it("routes document waits to content script and adds target metadata", runCase05);
  it("runs function waits through main-world eval instead of content-script eval", runCase06);
  it("waits for network idle through the background network tracker", runCase07);
  it("uses the resolved target tab for network-idle waits", runCase08);
  it("lists and clears network requests for the resolved target tab only", runCase09);
  it("runs eval in the resolved tab main world and adds target metadata", runCase10);

  it("routes explicit-window navigation, reads, interactions, and screenshots to that window's active tab", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);
    const target = { window: { kind: "id" as const, id: 20 } };

    const responses = [
      await handleBrowserRequest(createRequest("open", { url: "https://qa.example/", newTab: false, target }, "qa-open"), adapter),
      await handleBrowserRequest(createRequest("snapshot", { interactiveOnly: true, compact: true, target }, "qa-snapshot"), adapter),
      await handleBrowserRequest(createRequest("console", { action: "list", target }, "qa-console"), adapter),
      await handleBrowserRequest(createRequest("click", { selector: "#save", target }, "qa-click"), adapter),
      await handleBrowserRequest(createRequest("screenshot", { path: "/tmp/qa.png", format: "png", target }, "qa-screenshot"), adapter),
    ];

    for (const response of [responses[0], responses[1], responses[3], responses[4]]) {
      expect(response).toMatchObject({ ok: true, result: { target: { windowId: 20, tabId: 201 } } });
    }
    expect(responses[2]).toMatchObject({ ok: true, result: { action: "list" } });
    expect(adapter.navigations).toEqual([{ tabId: 201, url: "https://qa.example/" }]);
    expect(adapter.contentRequests).toEqual([
      { tabId: 201, command: "snapshot" },
      { tabId: 201, command: "console" },
      { tabId: 201, command: "click" },
    ]);
    expect(adapter.captureRequests).toEqual([{ windowId: 20, options: { format: "png" } }]);
    expect(adapter.selectedTabs).toEqual([]);
    expect(adapter.focusedWindows).toEqual([20]);
    expect(adapter.navigations.some((navigation) => navigation.tabId === 101)).toBe(false);
    expect(adapter.contentRequests.some((request) => request.tabId === 101)).toBe(false);
  });

  it("rejects an omitted window selector when multiple windows exist", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const response = await handleBrowserRequest(createRequest("open", { url: "https://qa.example/", newTab: false }, "ambiguous-window"), adapter);

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_TARGET",
        message: "Ambiguous window: Firefox has 2 windows. Pass `--window id:<id>` or explicitly choose `--window active`.",
      },
    });
    expect(adapter.navigations).toEqual([]);
  });

  it("rejects an omitted tab selector when the selected window has multiple tabs", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)])]);

    const response = await handleBrowserRequest(
      createRequest("open", { url: "https://qa.example/", newTab: false, target: { window: { kind: "id", id: 10 } } }, "ambiguous-tab"),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_TARGET",
        message: "Ambiguous tab: Firefox window 10 has 2 tabs. Pass `--tab id:<id>` or explicitly choose `--tab active`.",
      },
    });
    expect(adapter.navigations).toEqual([]);
  });

  it("accepts explicit active selectors when several windows and tabs exist", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest(
        "open",
        {
          url: "https://qa.example/",
          newTab: false,
          target: {
            window: { kind: "active" },
            tab: { kind: "active" },
          },
        },
        "explicit-active",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        target: { windowId: 10, tabId: 101 },
      },
    });
    expect(adapter.navigations).toEqual([{ tabId: 101, url: "https://qa.example/" }]);
  });

  it("lists tabs in an explicitly selected window without requiring a tab selector", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)])]);

    const response = await handleBrowserRequest(createRequest("tabs.list", { target: { window: { kind: "id", id: 10 } } }, "list-tabs-window"), adapter);

    expect(response).toMatchObject({
      ok: true,
      result: {
        tabs: [{ id: 101 }, { id: 102 }],
      },
    });
  });

  it("opens a new tab in the window identified by an explicit tab id", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest(
        "open",
        {
          url: "https://qa.example/",
          newTab: true,
          target: { tab: { kind: "id", id: 201 } },
        },
        "new-tab-by-tab-id",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        target: { windowId: 20, tabId: 102 },
      },
    });
  });

  it("resizes an explicitly selected window without requiring a tab selector", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)])]);

    const response = await handleBrowserRequest(
      createRequest(
        "set.viewport",
        {
          width: 1200,
          height: 800,
          target: { window: { kind: "id", id: 10 } },
        },
        "resize-window",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        window: { id: 10, width: 1200, height: 800 },
      },
    });
  });

  it.each([
    ["missing window", { window: { kind: "id" as const, id: 999 } }],
    ["tab outside selected window", { window: { kind: "id" as const, id: 20 }, tab: { kind: "id" as const, id: 101 } }],
  ])("rejects %s before target-dependent side effects", async (_name, target) => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const responses = [
      await handleBrowserRequest(createRequest("open", { url: "https://qa.example/", newTab: false, target }, "invalid-open"), adapter),
      await handleBrowserRequest(createRequest("snapshot", { interactiveOnly: true, compact: true, target }, "invalid-snapshot"), adapter),
      await handleBrowserRequest(createRequest("click", { selector: "#save", target }, "invalid-click"), adapter),
      await handleBrowserRequest(createRequest("screenshot", { path: "/tmp/invalid.png", format: "png", target }, "invalid-screenshot"), adapter),
    ];

    for (const response of responses) {
      expect(response).toMatchObject({ ok: false, error: { code: "INVALID_TARGET" } });
    }
    expect(adapter.navigations).toEqual([]);
    expect(adapter.contentRequests).toEqual([]);
    expect(adapter.selectedTabs).toEqual([]);
    expect(adapter.focusedWindows).toEqual([]);
    expect(adapter.captureRequests).toEqual([]);
  });

  it("reports refreshed focus metadata for window selection without changing later explicit target resolution", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const selected = await handleBrowserRequest(createRequest("window.select", { target: { window: { kind: "id", id: 20 } } }, "select-window-20"), adapter);
    const snapshot = await handleBrowserRequest(
      createRequest("snapshot", { interactiveOnly: true, compact: true, target: { window: { kind: "id", id: 10 } } }, "snapshot-window-10"),
      adapter,
    );

    expect(selected).toMatchObject({ ok: true, result: { window: { id: 20, focused: true }, target: { tabId: 201 } } });
    expect(snapshot).toMatchObject({ ok: true, result: { target: { windowId: 10, tabId: 101 } } });
    expect(adapter.focusedWindows).toEqual([20]);
    expect(adapter.contentRequests).toEqual([{ tabId: 101, command: "snapshot" }]);
  });
});
