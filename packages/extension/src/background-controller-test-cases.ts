import { createOkResponse, createRequest, isPrivilegeSensitiveRequest, kernelCapabilities } from "@firefox-cli/protocol";
import { expect } from "vitest";
import { FirefoxCliBackgroundController } from "./background-controller.js";

import {
  approveWithNativeHost,
  completeNativeHello,
  createTestBrowserAdapter,
  FakeNativePort,
  flushPromises,
  latestHelloRequest,
} from "./background-controller-test-support.js";

export function runCase01() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    connectNative: (name) => {
      expect(name).toBe("firefox_cli");
      return port;
    },
    productVersion: "0.0.0",
  });

  controller.start();

  expect(controller.getStatus()).toMatchObject({ connected: true, approved: false });
  expect(port.messages[0]).toMatchObject({
    command: "hello",
    params: {
      component: "extension",
    },
  });
}

export async function runCase02() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();
  const hello = latestHelloRequest(port);

  port.emitMessage(
    createOkResponse(hello, {
      accepted: true,
      negotiatedProtocolVersion: 1,
      peer: {
        component: "native-host",
        productName: "firefox-cli",
        productVersion: "0.0.0",
        protocolMin: 1,
        protocolMax: 1,
        features: [],
      },
    }),
  );
  await Promise.resolve();

  expect(controller.getStatus().lastError).toBeUndefined();
}

export async function runCase03() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();
  await approveWithNativeHost(controller, port);

  const capabilities = createRequest("capabilities", {}, "request-1");
  port.emitMessage(capabilities);
  const noop = createRequest("noop", {}, "request-2");
  port.emitMessage(noop);
  await Promise.resolve();

  expect(port.messages.slice(2)).toEqual([
    {
      protocolVersion: capabilities.protocolVersion,
      id: "request-1",
      ok: true,
      result: {
        capabilities: [...kernelCapabilities],
      },
    },
    {
      protocolVersion: noop.protocolVersion,
      id: "request-2",
      ok: true,
      result: {
        ok: true,
      },
    },
  ]);
}

export async function runCase04() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    browserAdapter: {
      ...createTestBrowserAdapter([
        {
          id: 7,
          focused: true,
          private: false,
          tabs: [
            {
              id: 42,
              index: 0,
              active: true,
              title: "Example",
              url: "https://example.com/",
              windowId: 7,
              private: false,
            },
          ],
        },
      ]),
    },
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();
  await approveWithNativeHost(controller, port);

  const request = createRequest("tabs.list", {}, "request-1");
  port.emitMessage(request);
  await flushPromises();

  expect(port.messages[2]).toMatchObject({
    protocolVersion: request.protocolVersion,
    id: "request-1",
    ok: true,
    result: {
      target: {
        windowId: 7,
        tabId: 42,
      },
      tabs: [
        {
          id: 42,
          index: 0,
          active: true,
          title: "Example",
          url: "https://example.com/",
          windowId: 7,
          private: false,
        },
      ],
    },
  });
}

export async function runCase05() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();
  await completeNativeHello(port);

  const noop = createRequest("noop", {}, "request-1");
  port.emitMessage(noop);
  await Promise.resolve();

  expect(port.messages[1]).toEqual({
    protocolVersion: noop.protocolVersion,
    id: "request-1",
    ok: false,
    error: {
      code: "NOT_APPROVED",
      message: "Approve firefox-cli in the extension popup before running CLI commands.",
    },
  });
}

export async function runCase06() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    browserAdapter: createTestBrowserAdapter([], {
      openExtensionPage: async (path) => `moz-extension://test/${path}`,
    }),
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();
  await completeNativeHello(port);

  const request = createRequest("pair.openApproval", {}, "approval-page-1");
  port.emitMessage(request);
  await flushPromises();

  expect(port.messages[1]).toEqual({
    protocolVersion: request.protocolVersion,
    id: "approval-page-1",
    ok: true,
    result: {
      ok: true,
      url: "moz-extension://test/popup.html",
    },
  });
}

export async function runCase07() {
  const port = new FakeNativePort();
  const browserCalls: string[] = [];
  const controller = new FirefoxCliBackgroundController({
    browserAdapter: createTestBrowserAdapter(
      [
        {
          id: 7,
          focused: true,
          private: false,
          tabs: [
            {
              id: 42,
              index: 0,
              active: true,
              title: "Example",
              url: "https://example.com/",
              windowId: 7,
              private: false,
            },
          ],
        },
      ],
      {
        listWindows: async () => {
          browserCalls.push("listWindows");
          return [];
        },
        executeEval: async () => {
          browserCalls.push("executeEval");
          return {
            ok: true,
            value: { type: "json", value: "unreachable" },
            elapsedMs: 1,
          };
        },
      },
    ),
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();
  await completeNativeHello(port);

  const request = createRequest("eval", { script: "document.title", source: "argv" }, "sensitive-request");
  expect(isPrivilegeSensitiveRequest(request)).toBe(true);
  port.emitMessage(request);
  await flushPromises();

  expect(port.messages[1]).toEqual({
    protocolVersion: request.protocolVersion,
    id: "sensitive-request",
    ok: false,
    error: {
      code: "NOT_APPROVED",
      message: "Approve firefox-cli in the extension popup before running CLI commands.",
    },
  });
  expect(browserCalls).toEqual([]);
}

export async function runCase08() {
  const port = new FakeNativePort();
  const browserCalls: string[] = [];
  const controller = new FirefoxCliBackgroundController({
    browserAdapter: createTestBrowserAdapter([], {
      listWindows: async () => {
        browserCalls.push("listWindows");
        return [];
      },
      executeEval: async () => {
        browserCalls.push("executeEval");
        return {
          ok: true,
          value: { type: "json", value: "unreachable" },
          elapsedMs: 1,
        };
      },
    }),
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();
  await approveWithNativeHost(controller, port);

  const malformedEval = {
    ...createRequest("eval", { script: "document.title", source: "argv" }, "malformed-eval"),
    params: { script: 42, source: "argv" },
  };
  port.emitMessage(malformedEval);
  await flushPromises();

  expect(port.messages[2]).toMatchObject({
    protocolVersion: malformedEval.protocolVersion,
    id: "malformed-eval",
    ok: false,
    error: {
      code: "INVALID_ENVELOPE",
    },
  });
  expect(browserCalls).toEqual([]);
}
