import { createOkResponse, createRequest, isPrivilegeSensitiveRequest } from "@firefox-cli/protocol";
import { expect } from "vitest";
import { FirefoxCliBackgroundController } from "./background-controller.js";

import {
  approveWithNativeHost,
  completeNativeHello,
  createTestBrowserAdapter,
  FakeNativePort,
  flushPromises,
  latestHelloRequest,
  latestPairApproveRequest,
  latestPairResetRequest,
  sleep,
} from "./background-controller-test-support.js";

export async function runCase01() {
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
          return [
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
          ];
        },
        executeEval: async (tabId, payload) => {
          browserCalls.push(`executeEval:${String(tabId)}:${payload.script}`);
          return {
            ok: true,
            value: { type: "json", value: "Example" },
            elapsedMs: 2,
          };
        },
      },
    ),
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();
  await approveWithNativeHost(controller, port);

  const request = createRequest("eval", { script: "document.title", source: "argv" }, "approved-sensitive-request");
  expect(isPrivilegeSensitiveRequest(request)).toBe(true);
  port.emitMessage(request);
  await flushPromises();

  expect(port.messages[2]).toMatchObject({
    protocolVersion: request.protocolVersion,
    id: "approved-sensitive-request",
    ok: true,
    result: {
      value: { type: "json", value: "Example" },
      elapsedMs: 2,
      target: {
        windowId: 7,
        tabId: 42,
      },
    },
  });
  expect(browserCalls).toEqual(["listWindows", "executeEval:42:document.title"]);
}

export async function runCase02() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();

  const noop = createRequest("noop", {}, "request-1");
  port.emitMessage(noop);
  await Promise.resolve();

  expect(port.messages[1]).toMatchObject({
    protocolVersion: noop.protocolVersion,
    id: "request-1",
    ok: false,
    error: {
      code: "NATIVE_HOST_UNAVAILABLE",
    },
  });
}

export async function runCase03() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();
  const hello = latestHelloRequest(port);

  port.emitMessage({
    protocolVersion: 2,
    id: hello.id,
    ok: false,
    error: {
      code: "VERSION_MISMATCH",
      message: "Protocol version ranges do not overlap.",
    },
  });
  await flushPromises();

  const approvalStatus = await controller.handleRuntimeMessage({ type: "firefox-cli:approve" });

  expect(approvalStatus).toMatchObject({
    connected: true,
    approved: false,
    lastError: "Protocol version ranges do not overlap.",
  });
}

export async function runCase04() {
  const port = new FakeNativePort();
  const storedTokens: (string | null)[] = [];
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
    storageAdapter: {
      getPairToken: async () => null,
      setPairToken: async (token) => {
        storedTokens.push(token);
      },
    },
  });
  controller.start();

  await approveWithNativeHost(controller, port);
  expect(controller.getStatus().approved).toBe(true);
  const resetStatus = controller.handleRuntimeMessage({ type: "firefox-cli:reset" });
  const reset = latestPairResetRequest(port);
  expect(reset.command).toBe("pair.reset");
  port.emitMessage(createOkResponse(reset, { ok: true }));
  await resetStatus;

  expect(controller.getStatus()).toMatchObject({
    connected: true,
    approved: false,
  });
  expect(controller.getStatus().lastError).toBeUndefined();
  expect(storedTokens).toEqual(["paired-token", null]);
}

export async function runCase05() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
    storageAdapter: {
      getPairToken: async () => "stored-token",
      setPairToken: async () => undefined,
    },
  });
  controller.start();

  await flushPromises();

  expect(controller.getStatus().approved).toBe(true);
  expect(port.messages.at(-1)).toMatchObject({
    command: "hello",
    params: {
      pairToken: "stored-token",
    },
  });
}

export async function runCase06() {
  const port = new FakeNativePort();
  const storedTokens: (string | null)[] = [];
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
    storageAdapter: {
      getPairToken: async () => "stored-token",
      setPairToken: async (token) => {
        storedTokens.push(token);
      },
    },
  });
  controller.start();
  await flushPromises();
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
      pairing: {
        hostId: "host-1",
        extensionId: "ff-cli-bridge@respawn.pro",
        approved: false,
        status: "invalid-pair-state",
        message: "Stored pair state is invalid.",
      },
    }),
  );
  await flushPromises();

  expect(controller.getStatus()).toMatchObject({
    approved: false,
    lastError: "Stored pair state is invalid.",
  });
  expect(storedTokens).toEqual([]);
}

export function runCase07() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
    reconnectDelaysMs: [],
  });
  controller.start();

  port.emitDisconnect({ message: "Native app exited." });

  expect(controller.getStatus()).toMatchObject({
    connected: false,
    lastError: "Native app exited.",
  });
}

export async function runCase08() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
    reconnectDelaysMs: [],
  });
  controller.start();
  await completeNativeHello(port);

  const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });
  const request = latestPairApproveRequest(port);
  expect(request.command).toBe("pair.approve");

  port.emitDisconnect({ message: "Native app exited." });
  await approval;

  expect(controller.getStatus()).toMatchObject({
    connected: false,
    approved: false,
    lastError: "Native host disconnected before responding.",
  });
}

export async function runCase09() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
    requestTimeoutMs: 10,
  });
  controller.start();
  await completeNativeHello(port);

  const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });

  await sleep(20);
  await approval;

  expect(controller.getStatus()).toMatchObject({
    connected: true,
    approved: false,
    lastError: "Timed out waiting for native host response to pair.approve.",
  });
}
