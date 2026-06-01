import { createOkResponse } from "@firefox-cli/protocol";
import { expect } from "vitest";
import { FirefoxCliBackgroundController } from "./background-controller.js";

import {
  completeNativeHello,
  FakeNativePort,
  flushPromises,
  latestHelloRequest,
  latestPairApproveRequest,
  sleep,
} from "./background-controller-test-support.js";

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
