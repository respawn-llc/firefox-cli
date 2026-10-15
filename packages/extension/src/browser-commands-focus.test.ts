import { createRequest } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { handleBrowserRequest } from "./browser-commands.js";
import { FakeBrowserAdapter, tabSummary, windowSnapshot } from "./browser-commands-test-utils.js";

describe("browser command focus options", () => {
  it("navigates an inactive tab without changing selection or window focus by default", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20), tabSummary(202, 1, false, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("open", { url: "https://qa.example/", newTab: false, target: { tab: { kind: "id", id: 202 } } }, "open-background"),
      adapter,
    );

    expect(response).toMatchObject({ ok: true, result: { target: { windowId: 20, tabId: 202, url: "https://qa.example/" } } });
    expect(await adapter.listWindows()).toMatchObject([
      { id: 10, focused: true, tabs: [{ id: 101, active: true }] },
      {
        id: 20,
        focused: false,
        tabs: [
          { id: 201, active: true },
          { id: 202, active: false },
        ],
      },
    ]);
    expect(adapter.navigations).toEqual([{ tabId: 202, url: "https://qa.example/" }]);
    expect(adapter.selectedTabs).toEqual([]);
    expect(adapter.focusedWindows).toEqual([]);
  });

  it("selects a tab without changing window focus or another window's active tab", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20), tabSummary(202, 1, false, 20)]),
    ]);

    const response = await handleBrowserRequest(createRequest("tab.select", { target: { tab: { kind: "id", id: 202 } } }, "select-tab-202"), adapter);

    expect(response).toMatchObject({ ok: true, result: { target: { windowId: 20, tabId: 202 } } });
    expect(await adapter.listWindows()).toMatchObject([
      { id: 10, focused: true, tabs: [{ id: 101, active: true }] },
      {
        id: 20,
        focused: false,
        tabs: [
          { id: 201, active: false },
          { id: 202, active: true },
        ],
      },
    ]);
    expect(adapter.selectedTabs).toEqual([202]);
    expect(adapter.focusedWindows).toEqual([]);
  });

  it("focuses the selected tab's window only when focus is requested", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20), tabSummary(202, 1, false, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("tab.select", { focus: true, target: { tab: { kind: "id", id: 202 } } }, "select-and-focus-tab"),
      adapter,
    );

    expect(response).toMatchObject({ ok: true, result: { target: { windowId: 20, tabId: 202 } } });
    expect(await adapter.listWindows()).toMatchObject([
      { id: 10, focused: false, tabs: [{ id: 101, active: true }] },
      {
        id: 20,
        focused: true,
        tabs: [
          { id: 201, active: false },
          { id: 202, active: true },
        ],
      },
    ]);
    expect(adapter.selectedTabs).toEqual([202]);
    expect(adapter.focusedWindows).toEqual([20]);
  });

  it("creates a default tab without selecting it or focusing its window", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const response = await handleBrowserRequest(createRequest("tab.new", { target: { window: { kind: "id", id: 20 } } }, "new-background-tab"), adapter);

    expect(response).toMatchObject({ ok: true, result: { target: { windowId: 20, tabId: 102 } } });
    expect(await adapter.listWindows()).toMatchObject([
      { id: 10, focused: true, tabs: [{ id: 101, active: true }] },
      {
        id: 20,
        focused: false,
        tabs: [
          { id: 201, active: true },
          { id: 102, active: false },
        ],
      },
    ]);
    expect(adapter.selectedTabs).toEqual([]);
    expect(adapter.focusedWindows).toEqual([]);
  });

  it("focuses a requested new tab without selecting it twice", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("tab.new", { url: "https://qa.example/", focus: true, target: { window: { kind: "id", id: 20 } } }, "new-tab-focus"),
      adapter,
    );

    expect(response).toMatchObject({ ok: true, result: { target: { windowId: 20, tabId: 102, url: "https://qa.example/" } } });
    expect(await adapter.listWindows()).toMatchObject([
      { id: 10, focused: false, tabs: [{ id: 101, active: true }] },
      {
        id: 20,
        focused: true,
        tabs: [
          { id: 201, active: false },
          { id: 102, active: true },
        ],
      },
    ]);
    expect(adapter.selectedTabs).toEqual([]);
    expect(adapter.focusedWindows).toEqual([20]);
  });

  it("opens a new default tab without changing the selected tab or window focus", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("open", { url: "https://qa.example/", newTab: true, target: { window: { kind: "id", id: 20 } } }, "open-background-new-tab"),
      adapter,
    );

    expect(response).toMatchObject({ ok: true, result: { target: { windowId: 20, tabId: 102 }, url: "https://qa.example/" } });
    expect(await adapter.listWindows()).toMatchObject([
      { id: 10, focused: true, tabs: [{ id: 101, active: true }] },
      {
        id: 20,
        focused: false,
        tabs: [
          { id: 201, active: true },
          { id: 102, active: false, url: "https://qa.example/" },
        ],
      },
    ]);
    expect(adapter.selectedTabs).toEqual([]);
    expect(adapter.focusedWindows).toEqual([]);
  });

  it("focuses a new open tab's window without selecting the already-active tab twice", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("open", { url: "https://qa.example/", newTab: true, focus: true, target: { window: { kind: "id", id: 20 } } }, "open-new-tab-focus"),
      adapter,
    );

    expect(response).toMatchObject({ ok: true, result: { target: { windowId: 20, tabId: 102, url: "https://qa.example/" } } });
    expect(await adapter.listWindows()).toMatchObject([
      { id: 10, focused: false, tabs: [{ id: 101, active: true }] },
      {
        id: 20,
        focused: true,
        tabs: [
          { id: 201, active: false },
          { id: 102, active: true },
        ],
      },
    ]);
    expect(adapter.selectedTabs).toEqual([]);
    expect(adapter.focusedWindows).toEqual([20]);
  });

  it("selects and focuses a navigated target only when requested", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20), tabSummary(202, 1, false, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest("open", { url: "https://qa.example/", newTab: false, focus: true, target: { tab: { kind: "id", id: 202 } } }, "open-focus"),
      adapter,
    );

    expect(response).toMatchObject({ ok: true, result: { target: { windowId: 20, tabId: 202, url: "https://qa.example/" } } });
    expect(adapter.navigations).toEqual([{ tabId: 202, url: "https://qa.example/" }]);
    expect(adapter.selectedTabs).toEqual([202]);
    expect(adapter.focusedWindows).toEqual([20]);
  });

  it("passes requested focus to new windows without a follow-up raise", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

    const background = await handleBrowserRequest(createRequest("window.new", { url: "https://background.example/" }, "new-background-window"), adapter);
    const focused = await handleBrowserRequest(createRequest("window.new", { url: "https://visible.example/", focus: true }, "new-focused-window"), adapter);

    expect(background).toMatchObject({ ok: true, result: { window: { focused: false }, target: { url: "https://background.example/" } } });
    expect(focused).toMatchObject({ ok: true, result: { window: { focused: true }, target: { url: "https://visible.example/" } } });
    expect(adapter.createdWindows).toEqual([
      { focused: false, url: "https://background.example/" },
      { focused: true, url: "https://visible.example/" },
    ]);
    expect(adapter.focusedWindows).toEqual([]);
  });

  it("applies focus options inside batch command steps", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20), tabSummary(202, 1, false, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          steps: [
            {
              command: "open",
              params: {
                url: "https://qa.example/",
                focus: true,
                target: { tab: { kind: "id", id: 202 } },
              },
            },
          ],
        },
        "batch-open-focus",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        ok: true,
        steps: [{ index: 0, command: "open", ok: true, result: { target: { windowId: 20, tabId: 202 } } }],
      },
    });
    expect(adapter.selectedTabs).toEqual([202]);
    expect(adapter.focusedWindows).toEqual([20]);
  });
});
