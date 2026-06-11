import { createOkResponse, createRequest, PROTOCOL_VERSION, parseBoundaryRequest, type RequestEnvelope } from "@firefox-cli/protocol";
import { expect } from "vitest";
import type { BackgroundBrowserAdapter, BrowserWindowSnapshot, FirefoxCliBackgroundController, NativePortLike } from "./background-controller.js";

export class FakeNativePort implements NativePortLike {
  readonly messages: unknown[] = [];
  readonly onMessage = createEvent<unknown>();
  readonly onDisconnect = createEvent<{ readonly message?: string } | undefined>();

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  emitMessage(message: unknown): void {
    this.onMessage.emit(message);
  }

  emitDisconnect(error?: { readonly message?: string }): void {
    this.onDisconnect.emit(error);
  }
}

export function createEvent<T>() {
  const listeners: ((value: T) => void)[] = [];
  return {
    addListener(listener: (value: T) => void): void {
      listeners.push(listener);
    },
    emit(value: T): void {
      for (const listener of listeners) {
        listener(value);
      }
    },
  };
}

export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function createTestBrowserAdapter(
  windows: readonly BrowserWindowSnapshot[],
  overrides: Partial<BackgroundBrowserAdapter> = {},
): BackgroundBrowserAdapter {
  return {
    hasRequiredHostAccess: async () => true,
    listWindows: async () => windows,
    createTab: async () => {
      throw new Error("not implemented");
    },
    selectTab: async () => {
      throw new Error("not implemented");
    },
    closeTab: async () => undefined,
    createWindow: async () => {
      throw new Error("not implemented");
    },
    focusWindow: async () => {
      throw new Error("not implemented");
    },
    closeWindow: async () => undefined,
    navigateTab: async () => {
      throw new Error("not implemented");
    },
    goBack: async () => {
      throw new Error("not implemented");
    },
    goForward: async () => {
      throw new Error("not implemented");
    },
    reload: async () => {
      throw new Error("not implemented");
    },
    sendContentRequest: async () => {
      throw new Error("not implemented");
    },
    executeEval: async () => {
      throw new Error("not implemented");
    },
    captureVisibleTab: async () => {
      throw new Error("not implemented");
    },
    download: async () => {
      throw new Error("not implemented");
    },
    waitForDownload: async () => {
      throw new Error("not implemented");
    },
    readClipboard: async () => {
      throw new Error("not implemented");
    },
    writeClipboard: async () => {
      throw new Error("not implemented");
    },
    listCookies: async () => {
      throw new Error("not implemented");
    },
    setCookie: async () => {
      throw new Error("not implemented");
    },
    removeCookie: async () => {
      throw new Error("not implemented");
    },
    listNetworkRequests: async () => [],
    clearNetworkRequests: async () => undefined,
    waitForNetworkIdle: async () => undefined,
    showNotification: async (options) => ({
      ok: true,
      id: options.id ?? "notification-1",
    }),
    resizeWindow: async () => {
      throw new Error("not implemented");
    },
    ...overrides,
  };
}

export async function approveWithNativeHost(controller: FirefoxCliBackgroundController, port: FakeNativePort): Promise<void> {
  await completeNativeHello(port);
  const approval = controller.handleRuntimeMessage({ type: "firefox-cli:approve" });
  const request = latestPairApproveRequest(port);
  expect(request.command).toBe("pair.approve");
  port.emitMessage(
    createOkResponse(request, {
      hostId: "host-1",
      extensionId: "ff-cli-bridge@respawn.pro",
      token: "paired-token",
      generation: 1,
      approvedAt: "2026-01-02T03:04:05.000Z",
    }),
  );
  await approval;
}

export async function completeNativeHello(port: FakeNativePort): Promise<void> {
  const parsed = parseLatestRequest(port);
  if (parsed?.command !== "hello") {
    return;
  }

  const hello = parsed;
  const negotiatedProtocolVersion = hello.params.protocolMax;
  port.emitMessage(
    createOkResponse(
      hello,
      {
        accepted: true,
        negotiatedProtocolVersion,
        peer: {
          component: "native-host",
          productName: "firefox-cli",
          productVersion: "0.0.0",
          protocolMin: 1,
          protocolMax: negotiatedProtocolVersion,
          features: [],
        },
      },
      negotiatedProtocolVersion,
    ),
  );
  await flushPromises();
}

export function latestHelloRequest(port: FakeNativePort): RequestEnvelope<"hello"> {
  const request = requireLatestRequest(port);
  if (request.command !== "hello") {
    throw new Error(`Expected latest native message to be hello, got ${request.command}.`);
  }
  return request;
}

export function latestPairApproveRequest(port: FakeNativePort): RequestEnvelope<"pair.approve"> {
  const request = requireLatestRequest(port);
  if (request.command !== "pair.approve") {
    throw new Error(`Expected latest native message to be pair.approve, got ${request.command}.`);
  }
  return request;
}

export function latestPairResetRequest(port: FakeNativePort): RequestEnvelope<"pair.reset"> {
  const request = requireLatestRequest(port);
  if (request.command !== "pair.reset") {
    throw new Error(`Expected latest native message to be pair.reset, got ${request.command}.`);
  }
  return request;
}

function requireLatestRequest(port: FakeNativePort): RequestEnvelope {
  const request = parseLatestRequest(port);
  if (request === undefined) {
    throw new Error("Expected latest native message to be a request.");
  }
  return request;
}

function parseLatestRequest(port: FakeNativePort): RequestEnvelope | undefined {
  const raw = port.messages.at(-1);
  if (raw === undefined) {
    return undefined;
  }
  const hello = parseRawHelloRequest(raw);
  if (hello !== undefined) {
    return hello;
  }
  const parsed = parseBoundaryRequest("host-to-extension", raw, {
    protocolVersion: PROTOCOL_VERSION,
  });
  return parsed.ok ? parsed.value : undefined;
}

function parseRawHelloRequest(raw: unknown): RequestEnvelope<"hello"> | undefined {
  if (!isRecord(raw) || raw.command !== "hello" || typeof raw.id !== "string" || typeof raw.protocolVersion !== "number") {
    return undefined;
  }
  const params = raw.params;
  if (!isExtensionHelloParams(params)) {
    return undefined;
  }
  const features = params.features.filter((feature): feature is string => typeof feature === "string");
  if (features.length !== params.features.length) {
    return undefined;
  }
  return createRequest(
    "hello",
    {
      component: "extension",
      productName: params.productName,
      productVersion: params.productVersion,
      protocolMin: params.protocolMin,
      protocolMax: params.protocolMax,
      features,
    },
    raw.id,
    raw.protocolVersion,
  );
}

function isExtensionHelloParams(value: unknown): value is {
  readonly component: "extension";
  readonly productName: "firefox-cli";
  readonly productVersion: string;
  readonly protocolMin: number;
  readonly protocolMax: number;
  readonly features: readonly unknown[];
} {
  return (
    isRecord(value) &&
    value.component === "extension" &&
    value.productName === "firefox-cli" &&
    typeof value.productVersion === "string" &&
    typeof value.protocolMin === "number" &&
    typeof value.protocolMax === "number" &&
    Array.isArray(value.features)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
