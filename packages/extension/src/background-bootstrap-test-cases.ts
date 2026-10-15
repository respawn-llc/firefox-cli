import { createRequest } from "@firefox-cli/protocol";
import { expect } from "vitest";
import { startBackground } from "./background-bootstrap.js";
import { createBackgroundBrowserAdapter } from "./background-browser-adapter.js";
import { createFakeBrowserApi, FakeNativePort } from "./background-bootstrap-test-support.js";
import { NetworkObservationService } from "./network-observation-service.js";
import { NetworkRequestTracker } from "./network-tracker.js";

export async function runCase01() {
  const port = new FakeNativePort();
  const browser = createFakeBrowserApi(port);
  const networkTracker = new NetworkRequestTracker({ now: () => 1000 });
  const networkObservation = new NetworkObservationService({ browser, tracker: networkTracker });

  const lifecycle = startBackground({
    browser,
    manifest: { version: "0.0.0" },
    controllerOptions: { reconnectDelaysMs: [] },
    networkObservation,
  });

  const runtimeOnMessage = browser.runtime.onMessage;
  const onBeforeRequest = browser.webRequest.onBeforeRequest;
  expect(runtimeOnMessage.listenerCount()).toBe(1);
  expect(onBeforeRequest.listenerCount()).toBe(0);
  expect(browser.tabs.onRemoved.listenerCount()).toBe(1);

  await networkObservation.observeTab(7, () => {
    expect(onBeforeRequest.filters()).toEqual([{ urls: ["<all_urls>"], tabId: 7 }]);
    expect(onBeforeRequest.listenerCount()).toBe(1);
    onBeforeRequest.emit({
      requestId: "before-dispose",
      tabId: 7,
      url: "https://example.test/app",
    });
  });
  expect(networkTracker.list({ tabId: 7 })).toHaveLength(1);
  browser.tabs.onRemoved.emit(7);
  expect(networkTracker.list({ tabId: 7 })).toEqual([]);
  expect(onBeforeRequest.listenerCount()).toBe(0);

  lifecycle.dispose();
  expect(runtimeOnMessage.listenerCount()).toBe(0);
  expect(onBeforeRequest.listenerCount()).toBe(0);
  expect(browser.tabs.onRemoved.listenerCount()).toBe(0);

  onBeforeRequest.emit({
    requestId: "after-dispose",
    tabId: 7,
    url: "https://example.test/after",
  });
  expect(networkTracker.list({ tabId: 7 })).toEqual([]);
}

export async function runCase02() {
  const port = new FakeNativePort();
  const browser = createFakeBrowserApi(port);
  const networkTracker = new NetworkRequestTracker();
  const networkObservation = new NetworkObservationService({ browser, tracker: networkTracker });
  const adapter = createBackgroundBrowserAdapter({ browser, networkObservation });

  browser.tabs.failNextSendMessage = true;
  await adapter.sendContentRequest(42, createRequest("snapshot", {}, "snapshot-1"));
  await adapter.executeEval(42, { script: "1 + 1", timeoutMs: 1000, maxResultBytes: 1024 });

  const { calls: scriptingCalls } = browser.scripting;
  expect(scriptingCalls[0]).toMatchObject({
    target: { tabId: 42, allFrames: false },
    files: ["content.js"],
  });
  expect(scriptingCalls[1]).toMatchObject({
    target: { tabId: 42, allFrames: false },
    world: "MAIN",
  });
}

export async function runCase03() {
  const port = new FakeNativePort();
  const browser = createFakeBrowserApi(port);
  const networkTracker = new NetworkRequestTracker();
  const networkObservation = new NetworkObservationService({ browser, tracker: networkTracker });
  const adapter = createBackgroundBrowserAdapter({ browser, networkObservation });

  browser.tabs.response = {
    protocolVersion: 1,
    id: "snapshot-1",
    ok: false,
    error: {
      code: "VERSION_MISMATCH",
      message: "Protocol version is not supported.",
    },
  };

  await adapter.sendContentRequest(42, createRequest("snapshot", {}, "snapshot-1"));

  const { calls: scriptingCalls } = browser.scripting;
  expect(scriptingCalls).toEqual([]);
}

export async function runCase04() {
  const port = new FakeNativePort();
  const browser = createFakeBrowserApi(port);
  const networkTracker = new NetworkRequestTracker();
  const networkObservation = new NetworkObservationService({ browser, tracker: networkTracker });
  const adapter = createBackgroundBrowserAdapter({ browser, networkObservation });

  browser.tabs.sendMessageFailure = new Error("Cannot access a restricted Firefox page");

  await expect(adapter.sendContentRequest(42, createRequest("snapshot", {}, "snapshot-1"))).rejects.toMatchObject({
    deliveryCause: "restricted-page",
    stage: "send",
    retried: false,
  });
  expect(browser.scripting.calls).toEqual([]);
}

export async function runCase05() {
  const port = new FakeNativePort();
  const browser = createFakeBrowserApi(port);
  const networkTracker = new NetworkRequestTracker();
  const networkObservation = new NetworkObservationService({ browser, tracker: networkTracker });
  const adapter = createBackgroundBrowserAdapter({ browser, networkObservation });

  await expect(adapter.showNotification({ id: "approval", title: "Action needed", message: "Open Firefox." })).resolves.toEqual({
    ok: true,
    id: "approval",
  });
  await expect(adapter.openExtensionPage("popup.html")).resolves.toBe("moz-extension://fake/popup.html");
  expect(browser.notifications.calls).toEqual([
    {
      id: "approval",
      options: {
        type: "basic",
        title: "Action needed",
        message: "Open Firefox.",
      },
    },
  ]);
  expect(browser.tabs.created).toEqual([{ active: true, url: "moz-extension://fake/popup.html" }]);
}
