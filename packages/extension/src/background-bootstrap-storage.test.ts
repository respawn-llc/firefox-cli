import { createOkResponse, parseBoundaryRequest, type RequestEnvelope } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { type BackgroundBrowserApi, startBackground } from "./background-bootstrap.js";
import type { NativePortLike } from "./background-controller.js";

const PAIR_TOKEN_STORAGE_KEY = "firefoxCliPairToken";

describe("background bootstrap storage", () => {
  it("persists popup approval tokens in extension storage", async () => {
    const port = new FakeNativePort();
    const browser = createFakeBrowserApi(port);
    const lifecycle = startBackground({
      browser,
      manifest: { version: "0.0.0" },
      controllerOptions: { reconnectDelaysMs: [] },
    });
    await completeNativeHello(port);

    const approval = lifecycle.controller.handleRuntimeMessage({ type: "firefox-cli:approve" });
    const approve = latestHostRequest(port);
    expect(approve.command).toBe("pair.approve");
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

    await expect(browser.storage.local.get(PAIR_TOKEN_STORAGE_KEY)).resolves.toEqual({
      [PAIR_TOKEN_STORAGE_KEY]: "paired-token",
    });
  });

  it("restores stored approval tokens from extension storage on startup", async () => {
    const port = new FakeNativePort();
    const browser = createFakeBrowserApi(port, { [PAIR_TOKEN_STORAGE_KEY]: "stored-token" });

    startBackground({
      browser,
      manifest: { version: "0.0.0" },
      controllerOptions: { reconnectDelaysMs: [] },
    });
    await flushPromises();

    expect(
      port.messages.some((message) => {
        const parsed = parseBoundaryRequest("host-to-extension", message, { protocolVersion: 1 });
        return parsed.ok && parsed.value.command === "hello" && parsed.value.params.pairToken === "stored-token";
      }),
    ).toBe(true);
  });
});

class FakeNativePort implements NativePortLike {
  readonly messages: unknown[] = [];
  readonly onMessage = createEvent<unknown>();
  readonly onDisconnect = createEvent<{ readonly message?: string } | undefined>();

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  emitMessage(message: unknown): void {
    this.onMessage.emit(message);
  }
}

function createFakeBrowserApi(port: NativePortLike, initialStorage: Record<string, unknown> = {}): BackgroundBrowserApi {
  const runtimeOnMessage = createEvent<{ readonly type?: string }, unknown>();
  const storageValues: Record<string, unknown> = { ...initialStorage };

  return {
    runtime: {
      onMessage: runtimeOnMessage,
      connectNative: () => port,
      sendMessage: async <T = unknown>(): Promise<T> => {
        throw new Error("runtime.sendMessage is not implemented in this fake.");
      },
      reload: () => undefined,
    },
    windows: {
      getAll: async () => [],
      create: async () => ({ id: 1 }),
      update: async (id: number) => ({ id, focused: true }),
      remove: async () => undefined,
    },
    tabs: {
      create: async () => ({ id: 1, index: 0, active: true, windowId: 1 }),
      update: async (id: number) => ({ id, index: 0, active: true, windowId: 1 }),
      get: async (id: number) => ({ id, index: 0, active: true, windowId: 1 }),
      remove: async () => undefined,
      goBack: async () => undefined,
      goForward: async () => undefined,
      reload: async () => undefined,
      sendMessage: async () => ({}),
      captureVisibleTab: async () => "data:image/png;base64,",
      onRemoved: createEvent<number>(),
    },
    permissions: {
      contains: async () => true,
      request: async () => true,
    },
    scripting: {
      executeScript: async () => [],
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storageValues[key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(storageValues, values);
        },
      },
    },
    downloads: {
      download: async () => 1,
      search: async () => [],
    },
    cookies: {
      getAll: async () => [],
      set: async (cookie) => cookie,
      remove: async () => undefined,
    },
  };
}

async function completeNativeHello(port: FakeNativePort): Promise<void> {
  const hello = latestHostRequest(port);
  expect(hello.command).toBe("hello");
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
  await flushPromises();
}

function latestHostRequest(port: FakeNativePort): RequestEnvelope {
  const raw = port.messages.at(-1);
  if (raw === undefined) {
    throw new Error("Expected native-host request.");
  }
  const parsed = parseBoundaryRequest("host-to-extension", raw, { protocolVersion: 1 });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
}

function createEvent<T, TResult = void>() {
  const listeners: ((value: T) => TResult)[] = [];
  return {
    addListener(listener: (value: T) => TResult): void {
      listeners.push(listener);
    },
    removeListener(listener: (value: T) => TResult): void {
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    emit(value: T): readonly TResult[] {
      return listeners.map((listener) => listener(value));
    },
  };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
