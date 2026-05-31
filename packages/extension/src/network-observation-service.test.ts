import { describe, expect, it } from "vitest";
import {
  NetworkObservationService,
  type NetworkObservationBrowserApi,
  type NetworkObservationWebRequestDetails,
} from "./network-observation-service.js";
import { NetworkRequestTracker } from "./network-tracker.js";

describe("NetworkObservationService", () => {
  it("registers webRequest listeners only for the observed tab", async () => {
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
  });

  it("retains observations briefly and prunes inactive tab state on timer expiry", async () => {
    const timers = createManualTimers();
    const browser = createFakeBrowserApi();
    const tracker = new NetworkRequestTracker({ now: () => 1_000 });
    const service = new NetworkObservationService({
      browser,
      clearTimer: timers.clearTimer,
      retentionMs: 500,
      scheduleTimer: timers.scheduleTimer,
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
  });

  it("keeps observations alive while target requests are active", async () => {
    const timers = createManualTimers();
    const browser = createFakeBrowserApi();
    const tracker = new NetworkRequestTracker({ now: () => 1_000 });
    const service = new NetworkObservationService({
      browser,
      clearTimer: timers.clearTimer,
      retentionMs: 500,
      scheduleTimer: timers.scheduleTimer,
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
  });

  it("can release empty observations immediately for clear operations", async () => {
    const timers = createManualTimers();
    const browser = createFakeBrowserApi();
    const tracker = new NetworkRequestTracker({ now: () => 1_000 });
    const service = new NetworkObservationService({
      browser,
      clearTimer: timers.clearTimer,
      retentionMs: 500,
      scheduleTimer: timers.scheduleTimer,
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
  });

  it("disposes all observed tab listeners", async () => {
    const browser = createFakeBrowserApi();
    const service = new NetworkObservationService({ browser });

    await service.observeTab(7, () => undefined);
    await service.observeTab(8, () => undefined);
    expect(browser.webRequest.onBeforeRequest.listenerCount()).toBe(2);

    service.dispose();
    expect(browser.webRequest.onBeforeRequest.listenerCount()).toBe(0);
    expect(service.observedTabIds()).toEqual([]);
  });
});

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
    addListener(
      listener: (details: NetworkObservationWebRequestDetails) => void,
      filter: { readonly urls: readonly string[]; readonly tabId?: number },
    ): void {
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
