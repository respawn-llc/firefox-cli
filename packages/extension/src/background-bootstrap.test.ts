import { describe, expect, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05 } from "./background-bootstrap-test-cases.js";
import { createFakeBrowserApi, FakeNativePort } from "./background-bootstrap-test-support.js";
import { createBackgroundBrowserAdapter } from "./background-browser-adapter.js";
import { handleBrowserRequest } from "./browser-commands.js";
import { createRequest } from "@firefox-cli/protocol";
import { NetworkObservationService } from "./network-observation-service.js";
import { NetworkRequestTracker } from "./network-tracker.js";

describe("background bootstrap", () => {
  it("registers runtime eagerly and webRequest listeners lazily by target tab", runCase01);
  it("preserves content injection and eval execution product contracts", runCase02);
  it("does not refresh content scripts when an existing script returns a structured mismatch", runCase03);
  it("does not inject content scripts for classified non-recoverable send failures", runCase04);
  it("creates native notifications through the browser adapter", runCase05);

  it("selects tabs without focusing their window through the WebExtension API", async () => {
    const browser = createFakeBrowserApi(new FakeNativePort());
    const adapter = createBackgroundBrowserAdapter({
      browser,
      networkObservation: new NetworkObservationService({ browser, tracker: new NetworkRequestTracker() }),
    });

    const tab = await adapter.selectTab(42);

    expect(tab).toMatchObject({ id: 42, active: true });
    expect(browser.tabs.updateCalls).toEqual([{ tabId: 42, updateInfo: { active: true } }]);
    expect(browser.windows.updateCalls).toEqual([]);
  });

  it("navigates background tabs without selecting or focusing them through the WebExtension API", async () => {
    const browser = createFakeBrowserApi(new FakeNativePort());
    const adapter = createBackgroundBrowserAdapter({
      browser,
      networkObservation: new NetworkObservationService({ browser, tracker: new NetworkRequestTracker() }),
    });

    await adapter.navigateTab(42, "https://qa.example/");

    expect(browser.tabs.updateCalls).toEqual([{ tabId: 42, updateInfo: { url: "https://qa.example/" } }]);
    expect(browser.windows.updateCalls).toEqual([]);
  });

  it("passes requested tab activity directly to Firefox tab creation", async () => {
    const browser = createFakeBrowserApi(new FakeNativePort());
    const adapter = createBackgroundBrowserAdapter({
      browser,
      networkObservation: new NetworkObservationService({ browser, tracker: new NetworkRequestTracker() }),
    });

    const backgroundTab = await adapter.createTab({ active: false, windowId: 7 });
    const activeTab = await adapter.createTab({ active: true, url: "https://qa.example/", windowId: 7 });

    expect(backgroundTab).toMatchObject({ active: false });
    expect(activeTab).toMatchObject({ active: true, url: "https://qa.example/" });
    expect(browser.tabs.created).toEqual([
      { active: false, windowId: 7 },
      { active: true, url: "https://qa.example/", windowId: 7 },
    ]);
    expect(browser.windows.updateCalls).toEqual([]);
  });

  it("passes requested window focus directly to Firefox window creation", async () => {
    const browser = createFakeBrowserApi(new FakeNativePort());
    const adapter = createBackgroundBrowserAdapter({
      browser,
      networkObservation: new NetworkObservationService({ browser, tracker: new NetworkRequestTracker() }),
    });

    const background = await handleBrowserRequest(createRequest("window.new", { url: "https://background.example/" }, "window-background"), adapter);
    const focused = await handleBrowserRequest(createRequest("window.new", { url: "https://visible.example/", focus: true }, "window-focused"), adapter);

    expect(background).toMatchObject({ ok: true, result: { window: { id: 1, focused: false } } });
    expect(focused).toMatchObject({ ok: true, result: { window: { id: 1, focused: true } } });
    expect(browser.windows.createCalls).toEqual([
      { focused: false, url: "https://background.example/" },
      { focused: true, url: "https://visible.example/" },
    ]);
    expect(browser.windows.updateCalls).toEqual([]);
  });
});
