import { describe, expect, it } from "vitest";
import { NetworkRequestTracker } from "./network-tracker.js";

describe("NetworkRequestTracker", () => {
  it("lists and clears requests per tab without affecting other tabs", () => {
    let now = 1_000;
    const tracker = new NetworkRequestTracker({ now: () => now });

    tracker.recordStart({
      requestId: "tab-1",
      tabId: 101,
      url: "https://example.test/api",
      method: "GET",
      type: "xmlhttprequest",
    });
    now += 10;
    tracker.recordEnd({ requestId: "tab-1", statusCode: 200 });
    tracker.recordStart({ requestId: "tab-2", tabId: 202, url: "https://other.test/api" });
    now += 10;
    tracker.recordEnd({ requestId: "tab-2", statusCode: 204 });

    expect(tracker.list({ tabId: 101 })).toEqual([
      {
        id: "tab-1",
        url: "https://example.test/api",
        method: "GET",
        type: "xmlhttprequest",
        statusCode: 200,
      },
    ]);

    tracker.clear({ tabId: 101 });

    expect(tracker.list({ tabId: 101 })).toEqual([]);
    expect(tracker.list({ tabId: 202 })).toEqual([
      { id: "tab-2", url: "https://other.test/api", statusCode: 204 },
    ]);
  });

  it("ignores non-tab and internal browser requests", () => {
    const tracker = new NetworkRequestTracker();

    tracker.recordStart({ requestId: "missing-tab", url: "https://example.test/" });
    tracker.recordStart({ requestId: "browser-tab", tabId: -1, url: "https://example.test/" });
    tracker.recordStart({ requestId: "extension", tabId: 101, url: "moz-extension://id/app.js" });
    tracker.recordStart({ requestId: "about", tabId: 101, url: "about:blank" });
    tracker.recordStart({ requestId: "chrome", tabId: 101, url: "chrome://browser/content" });
    tracker.recordStart({ requestId: "resource", tabId: 101, url: "resource://gre/modules" });

    expect(tracker.list({ tabId: 101 })).toEqual([]);
  });

  it("keeps active requests out of completed-history pruning and clear operations", () => {
    let now = 1_000;
    const tracker = new NetworkRequestTracker({
      maxCompletedRequestsPerTab: 1,
      now: () => now,
    });

    tracker.recordStart({ requestId: "old", tabId: 101, url: "https://example.test/old" });
    now += 10;
    tracker.recordEnd({ requestId: "old", statusCode: 200 });
    tracker.recordStart({ requestId: "new", tabId: 101, url: "https://example.test/new" });
    now += 10;
    tracker.recordEnd({ requestId: "new", statusCode: 201 });
    tracker.recordStart({ requestId: "pending", tabId: 101, url: "https://example.test/pending" });

    expect(tracker.list({ tabId: 101 }).map((request) => request.id)).toEqual(["new", "pending"]);
    expect(tracker.isIdle({ tabId: 101, idleMs: 1 })).toBe(false);

    tracker.clear({ tabId: 101 });

    expect(tracker.list({ tabId: 101 })).toEqual([
      { id: "pending", url: "https://example.test/pending" },
    ]);
    expect(tracker.isIdle({ tabId: 101, idleMs: 1 })).toBe(false);
  });

  it("checks idle state from target-tab pending and activity only", () => {
    let now = 1_000;
    const tracker = new NetworkRequestTracker({ now: () => now });

    tracker.recordStart({ requestId: "target", tabId: 101, url: "https://example.test/api" });
    tracker.recordStart({ requestId: "other", tabId: 202, url: "https://other.test/api" });
    now += 100;
    tracker.recordEnd({ requestId: "target" });

    expect(tracker.isIdle({ tabId: 101, idleMs: 500 })).toBe(false);
    now += 500;
    expect(tracker.isIdle({ tabId: 101, idleMs: 500 })).toBe(true);
    expect(tracker.isIdle({ tabId: 202, idleMs: 1 })).toBe(false);
  });

  it("clears completed history by tab and URL glob", () => {
    const tracker = new NetworkRequestTracker();

    tracker.recordStart({ requestId: "api", tabId: 101, url: "https://example.test/api" });
    tracker.recordEnd({ requestId: "api" });
    tracker.recordStart({ requestId: "asset", tabId: 101, url: "https://example.test/app.js" });
    tracker.recordEnd({ requestId: "asset" });

    tracker.clear({ tabId: 101, urlGlob: "*api" });

    expect(tracker.list({ tabId: 101 })).toEqual([
      { id: "asset", url: "https://example.test/app.js" },
    ]);
  });

  it("uses shared glob semantics for URL filters", () => {
    const tracker = new NetworkRequestTracker();

    for (const [requestId, url] of [
      ["query", "https://example.test/api?x=1"],
      ["path", "https://example.test/api/x=1"],
      ["meta", "https://example.test/file+name[1].json"],
    ] as const) {
      tracker.recordStart({ requestId, tabId: 101, url });
      tracker.recordEnd({ requestId });
    }

    expect(tracker.list({ tabId: 101, urlGlob: "https://example.test/api?x=1" })).toEqual([
      { id: "query", url: "https://example.test/api?x=1" },
    ]);
    expect(tracker.list({ tabId: 101, urlGlob: "https://example.test/file+name[1].json" })).toEqual(
      [{ id: "meta", url: "https://example.test/file+name[1].json" }],
    );

    tracker.clear({ tabId: 101, urlGlob: "https://example.test/api*" });

    expect(tracker.list({ tabId: 101 })).toEqual([
      { id: "meta", url: "https://example.test/file+name[1].json" },
    ]);
  });

  it("prunes all network state for removed tabs", () => {
    const tracker = new NetworkRequestTracker();

    tracker.recordStart({ requestId: "active", tabId: 101, url: "https://example.test/active" });
    tracker.recordStart({ requestId: "done", tabId: 101, url: "https://example.test/done" });
    tracker.recordEnd({ requestId: "done", statusCode: 200 });
    tracker.recordStart({ requestId: "other", tabId: 202, url: "https://other.test/api" });

    tracker.pruneTab(101);

    expect(tracker.list({ tabId: 101 })).toEqual([]);
    expect(tracker.isIdle({ tabId: 101, idleMs: 0 })).toBe(true);
    expect(tracker.list({ tabId: 202 })).toEqual([{ id: "other", url: "https://other.test/api" }]);
  });

  it("sweeps stale active requests into bounded history", () => {
    let now = 1_000;
    const tracker = new NetworkRequestTracker({
      maxActiveRequestAgeMs: 100,
      now: () => now,
    });

    tracker.recordStart({ requestId: "stale", tabId: 101, url: "https://example.test/stale" });
    now += 50;
    tracker.recordStart({ requestId: "fresh", tabId: 101, url: "https://example.test/fresh" });
    now += 51;
    expect(tracker.pruneStaleActiveRequests()).toBe(1);

    expect(tracker.list({ tabId: 101 })).toEqual([
      { id: "stale", url: "https://example.test/stale" },
      { id: "fresh", url: "https://example.test/fresh" },
    ]);
    expect(tracker.isIdle({ tabId: 101, idleMs: 0 })).toBe(false);

    now += 49;
    expect(tracker.pruneStaleActiveRequests()).toBe(1);
    expect(tracker.isIdle({ tabId: 101, idleMs: 0 })).toBe(true);
  });
});
