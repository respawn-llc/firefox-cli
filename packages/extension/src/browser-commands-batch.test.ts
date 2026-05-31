import { createRequest } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { handleBrowserRequest } from "./browser-commands.js";
import { FakeBrowserAdapter, tabSummary, windowSnapshot } from "./browser-commands-test-utils.js";

describe("browser batch command handling", () => {
  it("runs steps serially with a once-resolved default target", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          target: { tab: { kind: "id", id: 201 } },
          steps: [
            { command: "snapshot", params: { interactiveOnly: true } },
            { command: "click", params: { selector: "button" } },
          ],
        },
        "batch-1",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        ok: true,
        steps: [
          { index: 0, command: "snapshot", ok: true },
          { index: 1, command: "click", ok: true },
        ],
      },
    });
    expect(adapter.contentRequests).toEqual([
      { tabId: 201, command: "snapshot" },
      { tabId: 201, command: "click" },
    ]);
  });

  it("preserves step target overrides", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          steps: [
            { command: "snapshot", params: {} },
            {
              command: "click",
              params: { selector: "button", target: { tab: { kind: "id", id: 201 } } },
            },
          ],
        },
        "batch-1",
      ),
      adapter,
    );

    expect(response).toMatchObject({ ok: true, result: { ok: true } });
    expect(adapter.contentRequests).toEqual([
      { tabId: 101, command: "snapshot" },
      { tabId: 201, command: "click" },
    ]);
  });

  it("uses the locked default target for target commands that omit step targets", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)])]);

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          target: { tab: { kind: "id", id: 101 } },
          steps: [
            { command: "tab.select", params: { target: { tab: { kind: "id", id: 102 } } } },
            { command: "tab.close", params: {} },
          ],
        },
        "batch-locked-target",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        ok: true,
        steps: [
          { index: 0, command: "tab.select", ok: true },
          { index: 1, command: "tab.close", ok: true, result: { closedTabId: 101 } },
        ],
      },
    });
    await expect(adapter.listWindows()).resolves.toMatchObject([
      {
        tabs: [{ id: 102 }],
      },
    ]);
  });

  it("uses the locked default target for network and network-idle batch steps", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)])]);
    adapter.networkRequests = [
      { id: "locked", tabId: 101, url: "https://example.test/locked" },
      { id: "active-after-select", tabId: 102, url: "https://example.test/active" },
    ];

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          target: { tab: { kind: "id", id: 101 } },
          steps: [
            { command: "tab.select", params: { target: { tab: { kind: "id", id: 102 } } } },
            { command: "network", params: { action: "list" } },
            { command: "wait", params: { kind: "load-state", state: "networkidle" } },
          ],
        },
        "batch-network-locked-target",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        ok: true,
        steps: [
          { index: 0, command: "tab.select", ok: true },
          {
            index: 1,
            command: "network",
            ok: true,
            result: { requests: [{ id: "locked" }] },
          },
          { index: 2, command: "wait", ok: true, result: { target: { tabId: 101 } } },
        ],
      },
    });
    expect(adapter.networkListRequests).toEqual([{ tabId: 101 }]);
    expect(adapter.networkIdleWaits).toEqual([{ tabId: 101, timeoutMs: 30_000, idleMs: 100 }]);
  });

  it("preserves explicit network batch step target overrides", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)])]);
    adapter.networkRequests = [
      { id: "default", tabId: 101, url: "https://example.test/default" },
      { id: "override", tabId: 102, url: "https://example.test/override" },
    ];

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          target: { tab: { kind: "id", id: 101 } },
          steps: [
            {
              command: "network",
              params: { target: { tab: { kind: "id", id: 102 } }, action: "list" },
            },
            {
              command: "wait",
              params: {
                target: { tab: { kind: "id", id: 102 } },
                kind: "load-state",
                state: "networkidle",
              },
            },
          ],
        },
        "batch-network-step-override",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        ok: true,
        steps: [
          { index: 0, command: "network", ok: true, result: { requests: [{ id: "override" }] } },
          { index: 1, command: "wait", ok: true, result: { target: { tabId: 102 } } },
        ],
      },
    });
    expect(adapter.networkListRequests).toEqual([{ tabId: 102 }]);
    expect(adapter.networkIdleWaits).toEqual([{ tabId: 102, timeoutMs: 30_000, idleMs: 100 }]);
  });

  it("continues failed steps unless bail is enabled", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);
    adapter.contentFailure = new Error("Cannot access tab");

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          steps: [
            { command: "snapshot", params: {} },
            { command: "click", params: { selector: "button" } },
          ],
        },
        "batch-continue",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        ok: false,
        firstFailedIndex: 0,
        steps: [
          { index: 0, ok: false, error: { code: "SCRIPT_INJECTION_FAILED" } },
          { index: 1, ok: false, error: { code: "SCRIPT_INJECTION_FAILED" } },
        ],
      },
    });

    const bailAdapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);
    bailAdapter.contentFailure = new Error("Cannot access tab");

    const bailResponse = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          bail: true,
          steps: [
            { command: "snapshot", params: {} },
            { command: "click", params: { selector: "button" } },
          ],
        },
        "batch-bail",
      ),
      bailAdapter,
    );

    expect(bailResponse).toMatchObject({
      ok: true,
      result: {
        ok: false,
        firstFailedIndex: 0,
        steps: [{ index: 0, ok: false }],
      },
    });
  });

  it("keeps nested batch dispatcher errors inside the nested batch result", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);
    adapter.contentFailure = new Error("Cannot access tab");

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          steps: [
            {
              command: "batch",
              params: { steps: [{ command: "snapshot", params: {} }] },
            },
          ],
        },
        "batch-nested-error",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        ok: true,
        steps: [
          {
            index: 0,
            command: "batch",
            ok: true,
            result: {
              ok: false,
              firstFailedIndex: 0,
              steps: [
                {
                  index: 0,
                  command: "snapshot",
                  ok: false,
                  error: { code: "SCRIPT_INJECTION_FAILED" },
                },
              ],
            },
          },
        ],
      },
    });
  });
});
