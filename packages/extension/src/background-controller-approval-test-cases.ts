import { createRequest, createOkResponse } from "@firefox-cli/protocol";
import { expect } from "vitest";
import { FirefoxCliBackgroundController } from "./background-controller.js";

import {
  completeNativeHello,
  createTestBrowserAdapter,
  FakeNativePort,
  flushPromises,
  latestHelloRequest,
  latestPairApproveRequest,
  sleep,
} from "./background-controller-test-support.js";
import { USER_DENIED_APPROVAL_MESSAGE } from "./approval-request-service.js";

export async function runCase01() {
  const port = new FakeNativePort();
  const storedTokens: (string | null)[] = [];
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
    requestTimeoutMs: 10,
    storageAdapter: {
      getPairToken: async () => null,
      setPairToken: async (token) => {
        storedTokens.push(token);
      },
    },
  });
  controller.start();
  await completeNativeHello(port);

  const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });
  const request = latestPairApproveRequest(port);

  await sleep(20);
  await approval;
  port.emitMessage(
    createOkResponse(request, {
      hostId: "host-1",
      extensionId: "ff-cli-bridge@respawn.pro",
      token: "late-token",
      generation: 1,
      approvedAt: "2026-01-02T03:04:05.000Z",
    }),
  );
  await flushPromises();

  expect(controller.getStatus()).toMatchObject({
    approved: false,
    lastError: "Timed out waiting for native host response to pair.approve.",
  });
  expect(storedTokens).toEqual([]);
}

export function runCase02() {
  const firstPort = new FakeNativePort();
  const secondPort = new FakeNativePort();
  const ports = [firstPort, secondPort];
  const scheduled: { readonly delayMs: number; readonly callback: () => void }[] = [];
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => {
      const port = ports.shift();
      if (port === undefined) {
        throw new Error("unexpected reconnect");
      }
      return port;
    },
    productVersion: "0.0.0",
    reconnectDelaysMs: [25],
    scheduleTimer: (callback, delayMs) => {
      scheduled.push({ callback, delayMs });
    },
  });
  controller.start();

  expect(firstPort.messages[0]).toMatchObject({ command: "hello" });
  expect(scheduled).toEqual([]);
  expect(controller.getStatus().connected).toBe(true);

  firstPort.emitDisconnect({ message: "Native app exited." });
  expect(controller.getStatus()).toMatchObject({
    connected: false,
    lastError: "Native app exited.",
  });
  expect(scheduled).toHaveLength(1);
  expect(scheduled[0]?.delayMs).toBe(25);

  scheduled[0]?.callback();

  expect(controller.getStatus()).toMatchObject({
    connected: true,
  });
  expect(secondPort.messages[0]).toMatchObject({ command: "hello" });
}

export async function runCase03() {
  const firstPort = new FakeNativePort();
  const secondPort = new FakeNativePort();
  const ports = [firstPort, secondPort];
  const scheduled: { readonly callback: () => void }[] = [];
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => {
      const port = ports.shift();
      if (port === undefined) {
        throw new Error("unexpected reconnect");
      }
      return port;
    },
    productVersion: "0.0.0",
    reconnectDelaysMs: [1],
    scheduleTimer: (callback) => {
      scheduled.push({ callback });
    },
  });
  controller.start();
  const firstHello = latestHelloRequest(firstPort);
  firstPort.emitMessage({
    protocolVersion: 2,
    id: firstHello.id,
    ok: false,
    error: {
      code: "VERSION_MISMATCH",
      message: "Protocol version ranges do not overlap.",
    },
  });
  await flushPromises();

  firstPort.emitDisconnect({ message: "Native app exited." });
  scheduled[0]?.callback();
  await completeNativeHello(secondPort);
  const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });
  const approve = latestPairApproveRequest(secondPort);

  expect(approve.command).toBe("pair.approve");
  secondPort.emitMessage(
    createOkResponse(approve, {
      hostId: "host-1",
      extensionId: "ff-cli-bridge@respawn.pro",
      token: "paired-token",
      generation: 1,
      approvedAt: "2026-01-02T03:04:05.000Z",
    }),
  );
  await approval;

  expect(controller.getStatus()).toMatchObject({
    connected: true,
    approved: true,
  });
}

export async function runCase04() {
  const port = new FakeNativePort();
  const scheduled: { readonly callback: () => void }[] = [];
  const storedTokens: (string | null)[] = [];
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
    reconnectDelaysMs: [1],
    scheduleTimer: (callback) => {
      scheduled.push({ callback });
    },
    storageAdapter: {
      getPairToken: async () => null,
      setPairToken: async (token) => {
        storedTokens.push(token);
      },
    },
  });
  controller.start();
  await completeNativeHello(port);

  const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });
  const approve = latestPairApproveRequest(port);
  controller.stop();
  await approval;

  expect(controller.getStatus()).toMatchObject({
    connected: false,
    approved: false,
    lastError: "Extension background stopped before the native host responded.",
  });

  port.emitMessage(
    createOkResponse(approve, {
      hostId: "host-1",
      extensionId: "ff-cli-bridge@respawn.pro",
      token: "late-token",
      generation: 1,
      approvedAt: "2026-01-02T03:04:05.000Z",
    }),
  );
  port.emitDisconnect({ message: "Native app exited." });
  await flushPromises();

  expect(controller.getStatus()).toMatchObject({
    connected: false,
    approved: false,
  });
  expect(storedTokens).toEqual([]);
  expect(scheduled).toEqual([]);
}

export function runCase05() {
  const firstPort = new FakeNativePort();
  const secondPort = new FakeNativePort();
  const ports = [firstPort, secondPort];
  const scheduled: { readonly callback: () => void }[] = [];
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => {
      const port = ports.shift();
      if (port === undefined) {
        throw new Error("unexpected reconnect");
      }
      return port;
    },
    productVersion: "0.0.0",
    reconnectDelaysMs: [1],
    scheduleTimer: (callback) => {
      scheduled.push({ callback });
    },
  });
  controller.start();

  firstPort.emitDisconnect({ message: "Native app exited." });
  expect(scheduled).toHaveLength(1);
  controller.stop();
  scheduled[0]?.callback();

  expect(secondPort.messages).toEqual([]);
  expect(controller.getStatus().connected).toBe(false);
}

export async function runCase06() {
  const port = new FakeNativePort();
  const closedTabs: number[] = [];
  const controller = new FirefoxCliBackgroundController({
    browserAdapter: createTestBrowserAdapter([], {
      openExtensionPage: async (path) => `moz-extension://test/${path}`,
      closeTab: async (tabId) => {
        closedTabs.push(tabId);
      },
    }),
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();
  await completeNativeHello(port);

  const request = createRequest("pair.requestApproval", {}, "approval-deny-1");
  port.emitMessage(request);
  await flushPromises();

  await expect(
    controller.handleRuntimeMessage({ type: "firefox-cli:deny-approval-request", requestId: "approval-deny-1" }, { sourceTabId: 456 }),
  ).resolves.toEqual({
    active: false,
  });
  await flushPromises();

  expect(port.messages[1]).toEqual({
    protocolVersion: request.protocolVersion,
    id: "approval-deny-1",
    ok: false,
    error: {
      code: "ACTION_REJECTED",
      message: USER_DENIED_APPROVAL_MESSAGE,
    },
  });
  expect(closedTabs).toEqual([456]);
}

export async function runCase07() {
  let nowMs = 1000;
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    browserAdapter: createTestBrowserAdapter([], {
      openExtensionPage: async (path) => `moz-extension://test/${path}`,
    }),
    connectNative: () => port,
    productVersion: "0.0.0",
    nowMs: () => nowMs,
  });
  controller.start();
  await completeNativeHello(port);

  const first = createRequest("pair.requestApproval", {}, "approval-rate-1");
  port.emitMessage(first);
  await flushPromises();
  await controller.handleRuntimeMessage({ type: "firefox-cli:deny-approval-request", requestId: "approval-rate-1" });
  await flushPromises();

  nowMs = 2000;
  const second = createRequest("pair.requestApproval", {}, "approval-rate-2");
  port.emitMessage(second);
  await flushPromises();

  expect(port.messages[2]).toEqual({
    protocolVersion: second.protocolVersion,
    id: "approval-rate-2",
    ok: false,
    error: {
      code: "ACTION_REJECTED",
      message:
        "Request rate-limited: to prevent disturbing the user, approval auto-denied. If the user wants you to request approval again, ask them to manually open the extension popup and approve; otherwise wait 3 seconds before trying again.",
      details: { remainingSeconds: 3 },
    },
  });

  nowMs = 3000;
  const third = createRequest("pair.requestApproval", {}, "approval-rate-3");
  port.emitMessage(third);
  await flushPromises();

  expect(port.messages[3]).toEqual({
    protocolVersion: third.protocolVersion,
    id: "approval-rate-3",
    ok: false,
    error: {
      code: "ACTION_REJECTED",
      message:
        "Request rate-limited: to prevent disturbing the user, approval auto-denied. If the user wants you to request approval again, ask them to manually open the extension popup and approve; otherwise wait 27 seconds before trying again.",
      details: { remainingSeconds: 27 },
    },
  });
}

export async function runCase08() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    browserAdapter: createTestBrowserAdapter([], {
      getExtensionInstance: async () => ({ extensionUrl: "moz-extension://test/", focusedWindowId: 17 }),
    }),
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();
  await completeNativeHello(port);
  const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });
  const approve = latestPairApproveRequest(port);
  port.emitMessage(
    createOkResponse(approve, {
      hostId: "host-1",
      extensionId: "ff-cli-bridge@respawn.pro",
      token: "paired-token",
      generation: 1,
      approvedAt: "2026-01-02T03:04:05.000Z",
    }),
  );
  await approval;

  const request = createRequest("pair.requestApproval", {}, "approval-approved-1");
  port.emitMessage(request);
  await flushPromises();

  expect(port.messages[2]).toEqual({
    protocolVersion: request.protocolVersion,
    id: "approval-approved-1",
    ok: false,
    error: {
      code: "ACTION_REJECTED",
      message: "firefox-cli is already approved for Firefox extension instance moz-extension://test/, focused window id 17.",
    },
  });
}
