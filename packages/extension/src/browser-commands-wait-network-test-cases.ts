import { actionKinds, createErrorResponse, createRequest, PROTOCOL_VERSION } from "@firefox-cli/protocol";
import { expect } from "vitest";
import { handleBrowserRequest } from "./browser-commands.js";
import { actionParamsFor, FakeBrowserAdapter, parseTestBrowserRequest, tabSummary, windowSnapshot } from "./browser-commands-test-utils.js";
import { ContentScriptDeliveryError } from "./content-script-delivery.js";

export async function runCase01() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  for (const protocolVersion of [1, 2]) {
    const consoleResponse = await handleBrowserRequest(
      createRequest("console", { action: "list" }, `console-v${String(protocolVersion)}`, protocolVersion),
      adapter,
    );
    const errorsResponse = await handleBrowserRequest(
      createRequest("errors", { action: "list" }, `errors-v${String(protocolVersion)}`, protocolVersion),
      adapter,
    );
    const batchResponse = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          steps: [
            { command: "console", params: { action: "list" } },
            { command: "errors", params: { action: "list" } },
          ],
        },
        `batch-v${String(protocolVersion)}`,
        protocolVersion,
      ),
      adapter,
    );

    expect(consoleResponse).toMatchObject({ ok: true, protocolVersion });
    expect(errorsResponse).toMatchObject({ ok: true, protocolVersion });
    expect(batchResponse).toMatchObject({ ok: true, protocolVersion });
    if (consoleResponse.ok) {
      expect("truncated" in consoleResponse.result).toBe(false);
      expect("droppedEntries" in consoleResponse.result).toBe(false);
    }
    if (errorsResponse.ok) {
      expect("truncated" in errorsResponse.result).toBe(false);
      expect("droppedEntries" in errorsResponse.result).toBe(false);
    }
    if (batchResponse.ok) {
      expect(batchResponse.result).toMatchObject({
        steps: [
          { ok: true, result: { entries: [] } },
          { ok: true, result: { errors: [] } },
        ],
      });
    }
  }
}

export async function runCase02() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  const consoleResponse = await handleBrowserRequest(createRequest("console", { action: "list" }, "console-v3"), adapter);
  const batchResponse = await handleBrowserRequest(
    createRequest(
      "batch",
      {
        steps: [{ command: "console", params: { action: "list" } }],
      },
      "batch-v3",
    ),
    adapter,
  );

  expect(consoleResponse).toMatchObject({
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    result: { truncated: true, droppedEntries: 2 },
  });
  expect(batchResponse).toMatchObject({
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    result: {
      steps: [
        {
          ok: true,
          result: { truncated: true, droppedEntries: 2 },
        },
      ],
    },
  });
}

export async function runCase03() {
  for (const command of actionKinds) {
    const adapter = new FakeBrowserAdapter([
      {
        ...windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { private: true })]),
        private: true,
      },
    ]);

    const response = await handleBrowserRequest(
      parseTestBrowserRequest({
        protocolVersion: PROTOCOL_VERSION,
        id: `${command}-private-1`,
        command,
        params: actionParamsFor(command),
      }),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_CAPABILITY",
      },
    });
    expect(adapter.contentRequests).toEqual([]);
  }
}

export async function runCase04() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { url: "https://example.test/loading" })])]);

  const response = await handleBrowserRequest(
    createRequest("wait", { kind: "url", urlGlob: "https://example.test/done", timeoutMs: 1, intervalMs: 1 }, "wait-url-1"),
    adapter,
  );

  expect(response).toMatchObject({
    ok: false,
    error: {
      code: "TIMEOUT",
    },
  });
}

export async function runCase05() {
  class HangingWindowsAdapter extends FakeBrowserAdapter {
    override async listWindows(): Promise<never> {
      return new Promise<never>(() => undefined);
    }
  }
  const adapter = new HangingWindowsAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { url: "https://example.test/loading" })])]);

  const response = await handleBrowserRequest(
    createRequest("wait", { kind: "url", urlGlob: "https://example.test/done", timeoutMs: 1, intervalMs: 1 }, "wait-url-hung-target"),
    adapter,
  );

  expect(response).toMatchObject({
    ok: false,
    error: {
      code: "TIMEOUT",
    },
  });
}

export async function runCase06() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);
  adapter.contentFailure = new Error("Cannot access a restricted Firefox page");

  const response = await handleBrowserRequest(createRequest("is", { kind: "visible", selector: "body" }, "is-1"), adapter);

  expect(response).toMatchObject({
    ok: false,
    error: {
      code: "SCRIPT_INJECTION_FAILED",
    },
  });
}

export async function runCase07() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);
  adapter.contentFailure = new Error("Missing host permission for the tab");

  const response = await handleBrowserRequest(createRequest("snapshot", { interactiveOnly: true }, "snapshot-1", 1), adapter);

  expect(response).toMatchObject({
    protocolVersion: 1,
    ok: false,
    error: {
      code: "SCRIPT_INJECTION_FAILED",
    },
  });
  expect(response.ok ? "" : response.error.message).toContain("Open a normal web page");
}

export async function runCase08() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);
  const permissionMessageMatcher: unknown = expect.stringContaining("denied extension host access");
  adapter.contentFailure = new ContentScriptDeliveryError({
    cause: "permission-denied",
    stage: "send",
    originalMessage: "Missing host permission for the tab",
    retried: false,
  });

  const response = await handleBrowserRequest(createRequest("snapshot", { interactiveOnly: true }, "snapshot-delivery-1", 1), adapter);

  expect(response).toMatchObject({
    protocolVersion: 1,
    ok: false,
    error: {
      code: "SCRIPT_INJECTION_FAILED",
      message: permissionMessageMatcher,
      details: {
        cause: "permission-denied",
        stage: "send",
        retried: false,
      },
    },
  });
}

export async function runCase09() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);
  const request = createRequest("snapshot", { interactiveOnly: true }, "snapshot-1", 1);
  const reloadMessageMatcher: unknown = expect.stringContaining("Reload the tab");
  adapter.contentResponse = createErrorResponse(
    "snapshot-1",
    {
      code: "VERSION_MISMATCH",
      message: "Protocol version is not supported.",
      details: { supported: 1, actual: 2 },
    },
    PROTOCOL_VERSION,
  );

  const response = await handleBrowserRequest(request, adapter);

  expect(response).toMatchObject({
    protocolVersion: 1,
    ok: false,
    error: {
      code: "VERSION_MISMATCH",
      message: reloadMessageMatcher,
    },
  });
  expect(adapter.contentRequests).toEqual([{ tabId: 101, command: "snapshot" }]);
}
