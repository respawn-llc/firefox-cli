import { createOkResponse, createRequest, PROTOCOL_VERSION, type RequestEnvelope } from "@firefox-cli/protocol";
import { expect } from "vitest";
import { FirefoxCliBackgroundController } from "./background-controller.js";
import {
  completeNativeHello,
  createTestBrowserAdapter,
  FakeNativePort,
  flushPromises,
  latestHelloRequest,
  latestPairApproveRequest,
} from "./background-controller-test-support.js";

export async function runCase09() {
  let resolveOpenPage: ((url: string) => void) | undefined;
  const openPage = new Promise<string>((resolve) => {
    resolveOpenPage = resolve;
  });
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    browserAdapter: createTestBrowserAdapter([], {
      openExtensionPage: async () => openPage,
    }),
    connectNative: () => port,
    productVersion: "0.0.0",
  });
  controller.start();
  await completeNativeHello(port);

  port.emitMessage(createRequest("pair.requestApproval", {}, "approval-race-1"));
  await flushPromises();

  await expect(controller.handleRuntimeMessage({ type: "firefox-cli:get-approval-request", requestId: "approval-race-1" })).resolves.toEqual({
    active: true,
    url: "approval-request.html?request=approval-race-1",
  });
  resolveOpenPage?.("moz-extension://test/approval-request.html?request=approval-race-1");
  await controller.handleRuntimeMessage({ type: "firefox-cli:deny-approval-request", requestId: "approval-race-1" });
}

export async function runCase10() {
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

  const request = createRequest("pair.requestApproval", {}, "approval-atomic-1");
  port.emitMessage(request);
  await flushPromises();
  const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve-request", requestId: "approval-atomic-1" });
  await flushPromises();

  await expect(controller.handleRuntimeMessage({ type: "firefox-cli:deny-approval-request", requestId: "approval-atomic-1" })).resolves.toEqual({
    active: false,
  });
  expect(port.messages).toHaveLength(2);

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
  await flushPromises();

  expect(port.messages[2]).toEqual({
    protocolVersion: request.protocolVersion,
    id: "approval-atomic-1",
    ok: true,
    result: {
      ok: true,
      url: "moz-extension://test/approval-request.html?request=approval-atomic-1",
    },
  });
}

export async function runCase11() {
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

  const request = createRequest("pair.openApproval", {}, "legacy-approval-1");
  port.emitMessage(request);
  await flushPromises();

  expect(port.messages[1]).toEqual({
    protocolVersion: request.protocolVersion,
    id: "legacy-approval-1",
    ok: true,
    result: {
      ok: true,
      url: "moz-extension://test/approval-request.html?manual=1",
    },
  });
}

export async function runCase12() {
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    browserAdapter: createTestBrowserAdapter([], {
      openExtensionPage: async (path) => `moz-extension://test/${path}`,
    }),
    connectNative: () => port,
    productVersion: "0.0.0",
    storageAdapter: {
      getPairToken: async () => null,
      setPairToken: async () => {
        throw new Error("Could not persist pair token.");
      },
    },
  });
  controller.start();
  await completeNativeHello(port);

  const request = createRequest("pair.requestApproval", {}, "approval-throw-1");
  port.emitMessage(request);
  await flushPromises();
  const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve-request", requestId: "approval-throw-1" });
  await flushPromises();

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

  await expect(approval).resolves.toEqual({
    active: false,
    close: true,
  });
  await flushPromises();

  expect(port.messages[2]).toEqual({
    protocolVersion: request.protocolVersion,
    id: "approval-throw-1",
    ok: false,
    error: {
      code: "NATIVE_HOST_UNAVAILABLE",
      message: "Could not persist pair token.",
    },
  });
  await expect(controller.handleRuntimeMessage({ type: "firefox-cli:get-status" })).resolves.toMatchObject({
    approved: false,
  });
}

export async function runCase13() {
  let resolveStoredToken: ((token: string | null) => void) | undefined;
  const storedTokens: (string | null)[] = [];
  const port = new FakeNativePort();
  const controller = new FirefoxCliBackgroundController({
    connectNative: () => port,
    productVersion: "0.0.0",
    storageAdapter: {
      getPairToken: async () =>
        new Promise<string | null>((resolve) => {
          resolveStoredToken = resolve;
        }),
      setPairToken: async (token) => {
        storedTokens.push(token);
      },
    },
  });
  controller.start();
  const tokenlessHello = latestHelloRequest(port);
  expect(tokenlessHello.params.pairToken).toBeUndefined();

  resolveStoredToken?.("stored-token");
  await flushPromises();
  const tokenHello = latestHelloRequest(port);
  expect(tokenHello.params.pairToken).toBe("stored-token");

  respondToHello(port, tokenlessHello, false);
  await flushPromises();
  respondToHello(port, tokenHello, true);
  await flushPromises();

  expect(storedTokens).toEqual([]);
  expect(controller.getStatus()).toMatchObject({ approved: true });
}

function respondToHello(port: FakeNativePort, hello: RequestEnvelope<"hello">, approved: boolean): void {
  port.emitMessage(
    createOkResponse(hello, {
      accepted: true,
      negotiatedProtocolVersion: PROTOCOL_VERSION,
      peer: {
        component: "native-host",
        productName: "firefox-cli",
        productVersion: "0.0.0",
        protocolMin: PROTOCOL_VERSION,
        protocolMax: PROTOCOL_VERSION,
        features: [],
      },
      pairing: {
        hostId: "host-1",
        extensionId: "ff-cli-bridge@respawn.pro",
        approved,
        status: approved ? "approved" : "not-approved",
      },
    }),
  );
}
