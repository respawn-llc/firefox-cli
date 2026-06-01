import { dirname, join, posix } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { Server } from "node:net";
import { createTempDir } from "@firefox-cli/test-support";
import { PROTOCOL_VERSION, createOkResponse, createRequest, kernelCapabilities } from "@firefox-cli/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FIREFOX_CLI_EXTENSION_ID } from "./host-launch.js";
import { NativeHostBroker } from "./host-broker.js";
import {
  FileLocalIpcAuthTokenStore,
  LocalIpcServer,
  createLocalIpcEndpointScope,
  getOrCreateLocalIpcAuthToken,
  planLocalIpcEndpoint,
  sendNegotiatedLocalIpcRequest,
  sendLocalIpcRequest,
} from "./local-ipc.js";
import { planTestLocalIpcEndpoint, startRawLocalIpcServer, stopRawServers } from "./local-ipc-test-utils.js";
import { createHostIdentity } from "./pair-state.js";

const servers: LocalIpcServer[] = [];
const rawServers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.stop()));
  await stopRawServers(rawServers);
});

describe("local IPC", () => {
  it("plans a current-user endpoint under the provided state root", () => {
    const endpointScope = createLocalIpcEndpointScope("ipc-token");
    expect(planLocalIpcEndpoint({ platform: "darwin", rootDir: "/tmp/firefox-cli" })).toEqual({
      kind: "unix-socket",
      path: posix.join("/tmp/firefox-cli", "ipc", "firefox_cli.sock"),
    });
    expect(planLocalIpcEndpoint({ platform: "linux", rootDir: "/tmp/firefox-cli" })).toEqual({
      kind: "unix-socket",
      path: posix.join("/tmp/firefox-cli", "ipc", "firefox_cli.sock"),
    });
    expect(planLocalIpcEndpoint({ platform: "win32", rootDir: "ignored", endpointScope })).toEqual({
      kind: "windows-named-pipe",
      path: `\\\\.\\pipe\\firefox-cli-firefox_cli-${endpointScope}`,
    });
    expect(() => planLocalIpcEndpoint({ platform: "win32", rootDir: "ignored", endpointScope: "" })).toThrow(/require an auth-token-derived scope/);
  });

  it("sends a CLI request to a running host broker and validates the response", async () => {
    const rootDir = await createTempDir("firefox-cli-ipc");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
    });
    broker.connectExtension({
      approved: true,
      token: undefined,
      send: async (request) => createOkResponse(request, { capabilities: [...kernelCapabilities] }),
    });
    const server = new LocalIpcServer({
      endpoint,
      handleMessage: async (message) => broker.handleCliRequest(message),
    });
    servers.push(server);
    await server.start();
    if (endpoint.kind === "unix-socket") {
      expect((await stat(dirname(endpoint.path))).mode & 0o777).toBe(0o700);
      expect((await stat(endpoint.path)).mode & 0o777).toBe(0o600);
    }

    const request = createRequest("capabilities", {}, "request-1");
    const response = await sendLocalIpcRequest(endpoint, request);

    expect(response).toEqual(createOkResponse(request, { capabilities: [...kernelCapabilities] }));
  });

  it("returns host protocol errors over IPC", async () => {
    const rootDir = await createTempDir("firefox-cli-ipc");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
    });
    const server = new LocalIpcServer({
      endpoint,
      handleMessage: async (message) => broker.handleCliRequest(message),
    });
    servers.push(server);
    await server.start();

    const request = createRequest("noop", {}, "request-1");

    await expect(sendLocalIpcRequest(endpoint, request)).resolves.toEqual({
      protocolVersion: request.protocolVersion,
      id: request.id,
      ok: false,
      error: {
        code: "EXTENSION_NOT_CONNECTED",
        message: "Firefox extension is not connected to the native host.",
      },
    });
  });

  it("requires a user-local auth token before accepting IPC requests", async () => {
    const rootDir = await createTempDir("firefox-cli-ipc");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    const token = "ipc-token";
    const request = createRequest("noop", {}, "request-1");
    const server = new LocalIpcServer({
      endpoint,
      authToken: token,
      handleMessage: () => createOkResponse(request, { ok: true }),
    });
    servers.push(server);
    await server.start();

    await expect(sendLocalIpcRequest(endpoint, request)).resolves.toEqual({
      protocolVersion: request.protocolVersion,
      id: request.id,
      ok: false,
      error: {
        code: "PERMISSION_DENIED",
        message: "Local IPC authentication failed.",
      },
    });
    await expect(sendLocalIpcRequest(endpoint, request, { authToken: "wrong-token" })).resolves.toEqual({
      protocolVersion: request.protocolVersion,
      id: request.id,
      ok: false,
      error: {
        code: "PERMISSION_DENIED",
        message: "Local IPC authentication failed.",
      },
    });
    await expect(sendLocalIpcRequest(endpoint, request, { authToken: token })).resolves.toEqual(createOkResponse(request, { ok: true }));
  });

  it("stores the IPC auth token in the user-local state directory", async () => {
    const rootDir = await createTempDir("firefox-cli-ipc-token");
    const store = new FileLocalIpcAuthTokenStore({ stateRoot: rootDir });

    const token = await getOrCreateLocalIpcAuthToken(store);
    const again = await getOrCreateLocalIpcAuthToken(store);

    expect(token).toBe(again);
    await expect(readFile(join(rootDir, "ipc", "auth-token"), "utf8")).resolves.toBe(`${token}\n`);

    if (process.platform !== "win32") {
      expect((await stat(dirname(store.filePath))).mode & 0o777).toBe(0o700);
      expect((await stat(store.filePath)).mode & 0o777).toBe(0o600);
    }
  });

  it("serializes concurrent first-start IPC auth token creation", async () => {
    const rootDir = await createTempDir("firefox-cli-ipc-token-race");
    const store = new FileLocalIpcAuthTokenStore({ stateRoot: rootDir });

    const [first, second] = await Promise.all([getOrCreateLocalIpcAuthToken(store), getOrCreateLocalIpcAuthToken(store)]);

    expect(first).toBe(second);
    await expect(readFile(join(rootDir, "ipc", "auth-token"), "utf8")).resolves.toBe(`${first}\n`);
  });

  it("returns TIMEOUT when a local IPC peer accepts but never responds", async () => {
    const rootDir = await createTempDir("fc-ipc-timeout");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    await startRawLocalIpcServer(rawServers, endpoint, (socket) => {
      const destroyTimer = setTimeout(() => {
        socket.destroy();
      }, 50);
      destroyTimer.unref();
    });
    const request = createRequest("noop", {}, "timeout-local-ipc");

    await expect(sendLocalIpcRequest(endpoint, request, { timeoutMs: 10 })).resolves.toMatchObject({
      id: request.id,
      ok: false,
      error: { code: "TIMEOUT" },
    });
  });

  it("returns TIMEOUT for the original request when negotiated hello hangs", async () => {
    const rootDir = await createTempDir("fc-ipc-hello-timeout");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    await startRawLocalIpcServer(rawServers, endpoint, (socket) => {
      const destroyTimer = setTimeout(() => {
        socket.destroy();
      }, 50);
      destroyTimer.unref();
    });
    const request = createRequest("noop", {}, "timeout-negotiated");

    await expect(sendNegotiatedLocalIpcRequest(endpoint, request, { timeoutMs: 10 })).resolves.toMatchObject({
      id: request.id,
      ok: false,
      error: { code: "TIMEOUT" },
    });
  });

  it("negotiates CLI-to-host protocol and sends the command on the same socket", async () => {
    const rootDir = await createTempDir("fc-ipc-negotiated");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    let forwardedRequest: unknown;
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
      protocolRange: { protocolMin: 1, protocolMax: 1 },
    });
    broker.connectExtension({
      approved: true,
      token: undefined,
      send: async (request) => {
        forwardedRequest = request;
        return createOkResponse(request, { capabilities: [...kernelCapabilities] });
      },
    });
    const server = new LocalIpcServer({
      endpoint,
      enableProtocolNegotiation: true,
      handleMessage: async (message, context) => broker.handleCliRequest(message, context),
    });
    servers.push(server);
    await server.start();

    const request = createRequest("capabilities", {}, "request-1", 2);
    const response = await sendNegotiatedLocalIpcRequest(endpoint, request, {
      protocolRange: { protocolMin: 1, protocolMax: 2 },
    });

    expect(forwardedRequest).toMatchObject({
      id: request.id,
      protocolVersion: PROTOCOL_VERSION,
      command: "capabilities",
    });
    expect(response).toEqual({
      protocolVersion: 1,
      id: request.id,
      ok: true,
      result: { capabilities: [...kernelCapabilities] },
    });
  });

  it("rejects scoped-network commands locally when negotiation falls back to protocol v1", async () => {
    const rootDir = await createTempDir("fc-ipc-scoped-network-v1");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    let forwardedRequest: unknown;
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
      protocolRange: { protocolMin: 1, protocolMax: 1 },
    });
    broker.connectExtension({
      approved: true,
      token: undefined,
      send: async (request) => {
        forwardedRequest = request;
        return createOkResponse(request, { action: "list", ok: true, requests: [] });
      },
    });
    const server = new LocalIpcServer({
      endpoint,
      enableProtocolNegotiation: true,
      handleMessage: async (message, context) => broker.handleCliRequest(message, context),
    });
    servers.push(server);
    await server.start();

    const request = createRequest("network", { action: "list" }, "network-v1", 2);
    const response = await sendNegotiatedLocalIpcRequest(endpoint, request, {
      protocolRange: { protocolMin: 1, protocolMax: 2 },
    });

    expect(forwardedRequest).toBeUndefined();
    expect(response).toMatchObject({
      protocolVersion: 1,
      id: request.id,
      ok: false,
      error: {
        code: "VERSION_MISMATCH",
        details: {
          requiredProtocolVersion: 2,
          negotiatedProtocolVersion: 1,
        },
      },
    });
  });

  it("returns VERSION_MISMATCH when negotiated CLI-to-host ranges do not overlap", async () => {
    const rootDir = await createTempDir("fc-ipc-no-overlap");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
      protocolRange: { protocolMin: 1, protocolMax: 1 },
    });
    const server = new LocalIpcServer({
      endpoint,
      enableProtocolNegotiation: true,
      handleMessage: async (message, context) => broker.handleCliRequest(message, context),
    });
    servers.push(server);
    await server.start();

    const request = createRequest("noop", {}, "request-1", 2);

    await expect(
      sendNegotiatedLocalIpcRequest(endpoint, request, {
        protocolRange: { protocolMin: 2, protocolMax: 2 },
      }),
    ).resolves.toMatchObject({
      protocolVersion: 1,
      id: request.id,
      ok: false,
      error: {
        code: "VERSION_MISMATCH",
      },
    });
  });
});
