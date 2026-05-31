import { createRequest } from "@firefox-cli/protocol";
import { expect } from "vitest";
import { handleBrowserRequest } from "./browser-commands.js";
import { FakeBrowserAdapter, tabSummary, windowSnapshot } from "./browser-commands-test-utils.js";

export async function runCase01() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  const response = await handleBrowserRequest(createRequest("is", { kind: "visible", selector: "#main" }, "is-1"), adapter);

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
}

export async function runCase02() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);
  const elapsedMsMatcher: unknown = expect.any(Number);

  const response = await handleBrowserRequest(createRequest("wait", { kind: "ms", durationMs: 0 }, "wait-ms-1"), adapter);

  expect(response).toMatchObject({
    ok: true,
    result: {
      kind: "ms",
      matched: true,
      elapsedMs: elapsedMsMatcher,
    },
  });
  expect(adapter.contentRequests).toEqual([]);
  expect(adapter.selectedTabs).toEqual([]);
  expect(adapter.navigations).toEqual([]);
}

export async function runCase03() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { url: "https://example.test/app" })])]);

  const response = await handleBrowserRequest(createRequest("wait", { kind: "url", urlGlob: "https://example.test/*" }, "wait-url-1"), adapter);

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
}

export async function runCase04() {
  const wildcardAdapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { url: "https://example.test/a" })])]);

  await expect(
    handleBrowserRequest(createRequest("wait", { kind: "url", urlGlob: "https://example.test/?" }, "wait-url-q"), wildcardAdapter),
  ).resolves.toMatchObject({ ok: true, result: { value: "https://example.test/a" } });

  const queryAdapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { url: "https://example.test/api/x=1" })])]);

  await expect(
    handleBrowserRequest(createRequest("wait", { kind: "url", urlGlob: "https://example.test/api?x=1" }, "wait-url-query"), queryAdapter),
  ).resolves.toMatchObject({ ok: true, result: { value: "https://example.test/api/x=1" } });
}

export async function runCase05() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  const response = await handleBrowserRequest(createRequest("wait", { kind: "text", text: "Ready" }, "wait-text-1"), adapter);

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
}

export async function runCase06() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);
  const scriptMatcher: unknown = expect.stringContaining("document.readyState === 'complete'");
  const timeoutMatcher: unknown = expect.any(Number);
  adapter.evalResult = {
    ok: true,
    value: { type: "json", value: { matched: true, value: true } },
    elapsedMs: 1,
  };

  const response = await handleBrowserRequest(
    createRequest("wait", { kind: "function", expression: "document.readyState === 'complete'" }, "wait-fn-1"),
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
        script: scriptMatcher,
        timeoutMs: timeoutMatcher,
        maxResultBytes: 4096,
      },
    },
  ]);
  expect(adapter.evalRequests[0]?.payload.timeoutMs).toBeGreaterThan(0);
  expect(adapter.evalRequests[0]?.payload.timeoutMs).toBeLessThanOrEqual(30_000);
}

export async function runCase07() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  const response = await handleBrowserRequest(
    createRequest("wait", { kind: "load-state", state: "networkidle", timeoutMs: 500, intervalMs: 75 }, "wait-networkidle-1"),
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
}

export async function runCase08() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)])]);

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
}

export async function runCase09() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)])]);
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
    handleBrowserRequest(createRequest("network", { target: { tab: { kind: "id", id: 102 } }, action: "clear" }, "network-clear-target"), adapter),
  ).resolves.toMatchObject({ ok: true });

  expect(adapter.networkListRequests).toEqual([{ tabId: 102, urlGlob: "example.test/api" }]);
  expect(adapter.networkClearRequests).toEqual([{ tabId: 102 }]);
  expect(adapter.networkRequests).toEqual([{ id: "active", tabId: 101, url: "https://example.test/api" }]);
}

export async function runCase10() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  const response = await handleBrowserRequest(createRequest("eval", { script: "document.title", source: "argv" }, "eval-1"), adapter);

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
}
