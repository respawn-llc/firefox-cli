import { commandSchemas, createRequest, isCommandId, PROTOCOL_VERSION } from "@firefox-cli/protocol";
import { expect } from "vitest";
import { handleBrowserRequest } from "./browser-commands.js";
import { browserSmokeRequests } from "./browser-commands-test-smoke.js";
import { FakeBrowserAdapter, parseTestBrowserRequest, tabSummary, windowSnapshot } from "./browser-commands-test-utils.js";

export async function runCase01() {
  const expectedCommands = Object.keys(commandSchemas)
    .filter(isCommandId)
    .filter(
      (command) =>
        commandSchemas[command].owner === "extension" &&
        command !== "capabilities" &&
        command !== "noop" &&
        command !== "pair.requestApproval" &&
        command !== "pair.openApproval",
    );
  const unsupportedPdfMessage: unknown = expect.stringContaining("PDF export is unsupported");

  expect([...browserSmokeRequests.keys()].sort()).toEqual(expectedCommands.sort());

  for (const [command, params] of browserSmokeRequests) {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [
        tabSummary(101, 0, true, 10, {
          url: "https://example.test/done",
          title: "Expected title",
        }),
      ]),
    ]);
    const response = await handleBrowserRequest(
      parseTestBrowserRequest({
        protocolVersion: PROTOCOL_VERSION,
        id: `${command}-smoke`,
        command,
        params,
      }),
      adapter,
    );

    if (command === "pdf") {
      expect(response).toMatchObject({
        ok: false,
        error: {
          code: "UNSUPPORTED_CAPABILITY",
          message: unsupportedPdfMessage,
        },
      });
      continue;
    }

    expect(response).not.toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_CAPABILITY" },
    });
  }
}

export async function runCase02() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);
  adapter.hostAccess = false;
  const approvalMessage: unknown = expect.stringContaining("Approve host access");

  const response = await handleBrowserRequest(createRequest("snapshot", {}, "snapshot-1"), adapter);

  expect(response).toMatchObject({
    ok: false,
    error: {
      code: "PERMISSION_DENIED",
      message: approvalMessage,
    },
  });
}

export async function runCase03() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]), windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  const response = await handleBrowserRequest(createRequest("tabs.list", { target: { window: { kind: "active" } } }, "request-1"), adapter);

  expect(response).toMatchObject({
    ok: true,
    result: {
      tabs: [{ id: 101 }],
    },
  });
}

export async function runCase04() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]), windowSnapshot(20, false, [tabSummary(201, 0, true, 20)])]);

  const response = await handleBrowserRequest(createRequest("tab.select", { target: { tab: { kind: "id", id: 201 } } }, "request-1"), adapter);

  expect(response).toMatchObject({
    ok: true,
    result: {
      target: {
        windowId: 20,
        tabId: 201,
      },
    },
  });
  expect(adapter.selectedTabs).toEqual([201]);
}

export async function runCase05() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  const response = await handleBrowserRequest(createRequest("open", { url: "https://example.com/", newTab: false }, "request-1"), adapter);

  expect(response).toMatchObject({
    ok: true,
    result: {
      target: {
        tabId: 101,
        url: "https://example.com/",
      },
    },
  });
  expect(adapter.navigations).toEqual([{ tabId: 101, url: "https://example.com/" }]);
}

export async function runCase06() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  const response = await handleBrowserRequest(createRequest("tab.new", { url: "https://example.com/" }, "request-1"), adapter);

  expect(response).toMatchObject({
    ok: true,
    result: {
      target: {
        windowId: 10,
        tabId: 102,
        url: "https://example.com/",
      },
    },
  });
}

export async function runCase07() {
  const adapter = new FakeBrowserAdapter([
    {
      ...windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { private: true })]),
      private: true,
    },
  ]);

  const response = await handleBrowserRequest(createRequest("open", { url: "https://example.com/", newTab: false }, "request-1"), adapter);

  expect(response).toMatchObject({
    ok: false,
    error: {
      code: "UNSUPPORTED_CAPABILITY",
    },
  });
}

export async function runCase08() {
  const adapter = new FakeBrowserAdapter([{ ...windowSnapshot(10, true, [tabSummary(101, 0, true, 10)]), private: true }]);

  await expect(handleBrowserRequest(createRequest("tab.new", {}, "tab-new-1"), adapter)).resolves.toMatchObject({
    ok: false,
    error: { code: "UNSUPPORTED_CAPABILITY" },
  });
  await expect(
    handleBrowserRequest(createRequest("window.close", { target: { window: { kind: "active" } } }, "window-close-1"), adapter),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: "UNSUPPORTED_CAPABILITY" },
  });
}

export async function runCase09() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  const request = createRequest("snapshot", { interactiveOnly: true }, "snapshot-1");
  const response = await handleBrowserRequest(request, adapter);

  expect(response).toMatchObject({
    ok: true,
    result: {
      target: {
        tabId: 101,
      },
      text: '@e1 button "Submit"',
      generationId: "g1",
      refs: 1,
    },
  });
  expect(adapter.contentRequests).toEqual([{ tabId: 101, command: "snapshot" }]);
}

export async function runCase10() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  const response = await handleBrowserRequest(createRequest("snapshot", { interactiveOnly: true }, "snapshot-v1", 1), adapter);

  expect(response).toMatchObject({ protocolVersion: 1, ok: true });
  expect(adapter.contentRequestVersions).toEqual([PROTOCOL_VERSION]);
}

export async function runCase11() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  await handleBrowserRequest(createRequest("snapshot", { interactiveOnly: true }, "snapshot-1"), adapter);
  const response = await handleBrowserRequest(createRequest("ref.resolve", { ref: "@e1", generationId: "g1" }, "ref-1"), adapter);

  expect(response).toMatchObject({
    ok: true,
    result: {
      target: {
        tabId: 101,
      },
      element: {
        ref: "@e1",
        generationId: "g1",
        role: "button",
      },
    },
  });
  expect(adapter.contentRequests).toEqual([
    { tabId: 101, command: "snapshot" },
    { tabId: 101, command: "ref.resolve" },
  ]);
}

export async function runCase12() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10, { url: "https://example.test/", title: "Example title" })])]);

  await expect(handleBrowserRequest(createRequest("get", { kind: "title" }, "get-title-1"), adapter)).resolves.toMatchObject({
    ok: true,
    result: {
      kind: "title",
      value: "Example title",
      target: {
        tabId: 101,
      },
    },
  });
  await expect(handleBrowserRequest(createRequest("get", { kind: "url" }, "get-url-1"), adapter)).resolves.toMatchObject({
    ok: true,
    result: {
      kind: "url",
      value: "https://example.test/",
    },
  });
  expect(adapter.contentRequests).toEqual([]);
}

export async function runCase13() {
  const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

  const response = await handleBrowserRequest(createRequest("get", { kind: "text", selector: "#main" }, "get-1"), adapter);

  expect(response).toMatchObject({
    ok: true,
    result: {
      kind: "text",
      value: "Submit",
      target: {
        tabId: 101,
      },
    },
  });
  expect(adapter.contentRequests).toEqual([{ tabId: 101, command: "get" }]);
}
