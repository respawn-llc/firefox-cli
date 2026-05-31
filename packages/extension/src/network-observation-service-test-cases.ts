import { expect } from "vitest";
import { type NetworkObservationBrowserApi, NetworkObservationService, type NetworkObservationWebRequestDetails } from "./network-observation-service.js";
import { NetworkRequestTracker } from "./network-tracker.js";

export async function runCase01() {
  const browser = createFakeBrowserApi();
  const service = new NetworkObservationService({
    browser,
    tracker: new NetworkRequestTracker({ now: () => 1_000 }),
  });

  expect(browser.webRequest.onBeforeRequest.listenerCount()).toBe(0);

  await service.observeTab(7, (tracker) => {
    expect(browser.webRequest.onBeforeRequest.filters()).toEqual([{ urls: ["<all_urls>"], tabId: 7 }]);
    browser.webRequest.onBeforeRequest.emit({
      requestId: "target",
      tabId: 7,
      url: "https://example.test/target",
    });
    browser.webRequest.onBeforeRequest.emit({
      requestId: "other",
      tabId: 8,
      url: "https://example.test/other",
    });
    expect(tracker.list({ tabId: 7 })).toEqual([{ id: "target", url: "https://example.test/target" }]);
    expect(tracker.list({ tabId: 8 })).toEqual([]);
  });
}

export async function runCase02() {
  const timers = createManualTimers();
  const browser = createFakeBrowserApi();
  const tracker = new NetworkRequestTracker({ now: () => 1_000 });
  const service = new NetworkObservationService({
    browser,
    clearTimer: (id) => {
      timers.clearTimer(id);
    },
    retentionMs: 500,
    scheduleTimer: (callback) => timers.scheduleTimer(callback),
    tracker,
  });

  await service.observeTab(7, () => {
    browser.webRequest.onBeforeRequest.emit({
      requestId: "target",
      tabId: 7,
      url: "https://example.test/target",
    });
    browser.webRequest.onCompleted.emit({
      requestId: "target",
      tabId: 7,
      url: "https://example.test/target",
    });
  });

  expect(service.observedTabIds()).toEqual([7]);
  expect(tracker.hasTabState(7)).toBe(true);
  timers.runNext();
  expect(service.observedTabIds()).toEqual([]);
  expect(browser.webRequest.onBeforeRequest.listenerCount()).toBe(0);
  expect(tracker.hasTabState(7)).toBe(false);
}

export async function runCase03() {
  const timers = createManualTimers();
  const browser = createFakeBrowserApi();
  const tracker = new NetworkRequestTracker({ now: () => 1_000 });
  const service = new NetworkObservationService({
    browser,
    clearTimer: (id) => {
      timers.clearTimer(id);
    },
    retentionMs: 500,
    scheduleTimer: (callback) => timers.scheduleTimer(callback),
    tracker,
  });

  await service.observeTab(7, () => {
    browser.webRequest.onBeforeRequest.emit({
      requestId: "active",
      tabId: 7,
      url: "https://example.test/active",
    });
  });

  timers.runNext();
  expect(service.observedTabIds()).toEqual([7]);
  browser.webRequest.onCompleted.emit({ requestId: "active", tabId: 7, url: "" });
  timers.runNext();
  expect(service.observedTabIds()).toEqual([]);
}

export async function runCase04() {
  const timers = createManualTimers();
  const browser = createFakeBrowserApi();
  const tracker = new NetworkRequestTracker({ now: () => 1_000 });
  const service = new NetworkObservationService({
    browser,
    clearTimer: (id) => {
      timers.clearTimer(id);
    },
    retentionMs: 500,
    scheduleTimer: (callback) => timers.scheduleTimer(callback),
    tracker,
  });

  await service.observeTab(
    7,
    (observedTracker) => {
      observedTracker.clear({ tabId: 7 });
    },
    { retainWhenEmpty: false },
  );

  expect(service.observedTabIds()).toEqual([]);
  expect(browser.webRequest.onBeforeRequest.listenerCount()).toBe(0);
}

export async function runCase05() {
  const browser = createFakeBrowserApi();
  const service = new NetworkObservationService({ browser });

  await service.observeTab(7, () => undefined);
  await service.observeTab(8, () => undefined);
  expect(browser.webRequest.onBeforeRequest.listenerCount()).toBe(2);

  service.dispose();
  expect(browser.webRequest.onBeforeRequest.listenerCount()).toBe(0);
  expect(service.observedTabIds()).toEqual([]);
}

function createFakeBrowserApi(): NetworkObservationBrowserApi & {
  readonly webRequest: {
    readonly onBeforeRequest: FakeWebRequestEvent;
    readonly onCompleted: FakeWebRequestEvent;
    readonly onErrorOccurred: FakeWebRequestEvent;
  };
} {
  return {
    webRequest: {
      onBeforeRequest: createWebRequestEvent(),
      onCompleted: createWebRequestEvent(),
      onErrorOccurred: createWebRequestEvent(),
    },
  };
}

type FakeWebRequestEvent = ReturnType<typeof createWebRequestEvent>;

function createWebRequestEvent() {
  const listeners: {
    readonly listener: (details: NetworkObservationWebRequestDetails) => void;
    readonly filter: { readonly urls: readonly string[]; readonly tabId?: number };
  }[] = [];
  return {
    addListener(listener: (details: NetworkObservationWebRequestDetails) => void, filter: { readonly urls: readonly string[]; readonly tabId?: number }): void {
      listeners.push({ listener, filter });
    },
    removeListener(listener: (details: NetworkObservationWebRequestDetails) => void): void {
      const index = listeners.findIndex((registration) => registration.listener === listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    emit(details: NetworkObservationWebRequestDetails): void {
      for (const registration of listeners) {
        if (registration.filter.tabId === undefined || registration.filter.tabId === details.tabId) {
          registration.listener(details);
        }
      }
    },
    filters(): readonly { readonly urls: readonly string[]; readonly tabId?: number }[] {
      return listeners.map((registration) => registration.filter);
    },
    listenerCount(): number {
      return listeners.length;
    },
  };
}

function createManualTimers() {
  const timers = new Map<number, () => void>();
  let nextId = 1;
  return {
    scheduleTimer(callback: () => void): number {
      const id = nextId;
      nextId += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id: unknown): void {
      if (typeof id === "number") {
        timers.delete(id);
      }
    },
    runNext(): void {
      const [id, callback] = timers.entries().next().value ?? [];
      if (id === undefined || callback === undefined) {
        return;
      }
      timers.delete(id);
      callback();
    },
  };
}
