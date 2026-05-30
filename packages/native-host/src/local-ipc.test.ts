import { dirname, join } from "node:path";
import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { createServer, Socket, type Server } from "node:net";
import { createTempDir } from "@firefox-cli/test-support";
import {
  PROTOCOL_VERSION,
  createOkResponse,
  createRequest,
  kernelCapabilities,
} from "@firefox-cli/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FIREFOX_CLI_EXTENSION_ID } from "./host-launch.js";
import { NativeHostBroker } from "./host-broker.js";
import {
  FileLocalIpcAuthTokenStore,
  LocalIpcServer,
  MAX_LOCAL_IPC_MESSAGE_BYTES,
  createLocalIpcEndpointScope,
  getOrCreateLocalIpcAuthToken,
  planLocalIpcEndpoint,
  sendNegotiatedLocalIpcRequest,
  sendLocalIpcRequest,
  type LocalIpcEndpoint,
  type LocalIpcEndpointOptions,
} from "./local-ipc.js";
import { createHostIdentity } from "./pair-state.js";

const servers: LocalIpcServer[] = [];
const rawServers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(
    rawServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) {
              resolve();
              return;
            }
            reject(error);
          });
        }),
    ),
  );
});

describe("local IPC", () => {
  it("plans a current-user endpoint under the provided state root", () => {
    const endpointScope = createLocalIpcEndpointScope("ipc-token");
    expect(planLocalIpcEndpoint({ platform: "darwin", rootDir: "/tmp/firefox-cli" })).toEqual({
      kind: "unix-socket",
      path: join("/tmp/firefox-cli", "ipc", "firefox_cli.sock"),
    });
    expect(planLocalIpcEndpoint({ platform: "linux", rootDir: "/tmp/firefox-cli" })).toEqual({
      kind: "unix-socket",
      path: join("/tmp/firefox-cli", "ipc", "firefox_cli.sock"),
    });
    expect(planLocalIpcEndpoint({ platform: "win32", rootDir: "ignored", endpointScope })).toEqual({
      kind: "windows-named-pipe",
      path: `\\\\.\\pipe\\firefox-cli-firefox_cli-${endpointScope}`,
    });
    expect(() =>
      planLocalIpcEndpoint({ platform: "win32", rootDir: "ignored" } as LocalIpcEndpointOptions),
    ).toThrow(/require an auth-token-derived scope/);
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
      handleMessage: (message) => broker.handleCliRequest(message),
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
      handleMessage: (message) => broker.handleCliRequest(message),
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
    await expect(
      sendLocalIpcRequest(endpoint, request, { authToken: "wrong-token" }),
    ).resolves.toEqual({
      protocolVersion: request.protocolVersion,
      id: request.id,
      ok: false,
      error: {
        code: "PERMISSION_DENIED",
        message: "Local IPC authentication failed.",
      },
    });
    await expect(sendLocalIpcRequest(endpoint, request, { authToken: token })).resolves.toEqual(
      createOkResponse(request, { ok: true }),
    );
  });

  it("returns OUTPUT_TOO_LARGE before connecting when the outbound request exceeds the IPC budget", async () => {
    const endpoint = planTestLocalIpcEndpoint(await createTempDir("fc-ipc-out"));
    const request = createRequest(
      "eval",
      { script: "x".repeat(MAX_LOCAL_IPC_MESSAGE_BYTES), source: "argv" },
      "oversized-outbound",
    );

    await expect(sendLocalIpcRequest(endpoint, request)).resolves.toMatchObject({
      protocolVersion: request.protocolVersion,
      id: request.id,
      ok: false,
      error: {
        code: "OUTPUT_TOO_LARGE",
      },
    });
  });

  it("returns OUTPUT_TOO_LARGE without invoking the handler when inbound requests exceed the IPC budget", async () => {
    const rootDir = await createTempDir("fc-ipc-in");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    let handled = false;
    const server = new LocalIpcServer({
      endpoint,
      handleMessage: () => {
        handled = true;
        return createOkResponse(createRequest("noop", {}, "unused"), { ok: true });
      },
    });
    servers.push(server);
    await server.start();

    const response = await sendOversizedRawLocalIpcMessage(
      endpoint,
      MAX_LOCAL_IPC_MESSAGE_BYTES + 1,
    );

    expect(handled).toBe(false);
    expect(response).toMatchObject({
      id: "invalid-request",
      ok: false,
      error: {
        code: "OUTPUT_TOO_LARGE",
      },
    });
  });

  it("returns OUTPUT_TOO_LARGE with the request ID when handler responses exceed the IPC budget", async () => {
    const rootDir = await createTempDir("fc-ipc-big-res");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    const request = createRequest("noop", {}, "oversized-response");
    const server = new LocalIpcServer({
      endpoint,
      handleMessage: () => ({
        protocolVersion: request.protocolVersion,
        id: request.id,
        ok: true,
        result: { payload: "x".repeat(MAX_LOCAL_IPC_MESSAGE_BYTES) },
      }),
    });
    servers.push(server);
    await server.start();

    await expect(sendLocalIpcRequest(endpoint, request)).resolves.toMatchObject({
      protocolVersion: request.protocolVersion,
      id: request.id,
      ok: false,
      error: {
        code: "OUTPUT_TOO_LARGE",
      },
    });
  });

  it("returns OUTPUT_TOO_LARGE and closes the socket when raw peers send oversized responses", async () => {
    const rootDir = await createTempDir("fc-ipc-peer-res");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    let peerClosed: Promise<void> | undefined;
    await startRawLocalIpcServer(endpoint, (socket) => {
      peerClosed = new Promise((resolve) => socket.once("close", () => resolve()));
      socket.once("data", () => {
        socket.write(
          `${JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            id: "raw-oversized-response",
            ok: true,
            result: { payload: "x".repeat(MAX_LOCAL_IPC_MESSAGE_BYTES) },
          })}\n`,
        );
      });
    });

    const request = createRequest("noop", {}, "raw-oversized-response");

    await expect(sendLocalIpcRequest(endpoint, request)).resolves.toMatchObject({
      protocolVersion: request.protocolVersion,
      id: request.id,
      ok: false,
      error: {
        code: "OUTPUT_TOO_LARGE",
      },
    });
    await expect(peerClosed).resolves.toBeUndefined();
  });

  it("returns INVALID_ENVELOPE with a recovered ID when requests are missing the newline delimiter", async () => {
    const rootDir = await createTempDir("fc-ipc-no-nl");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    let handled = false;
    const request = createRequest("noop", {}, "missing-newline");
    const server = new LocalIpcServer({
      endpoint,
      requestLineTimeoutMs: 10,
      handleMessage: () => {
        handled = true;
        return createOkResponse(request, { ok: true });
      },
    });
    servers.push(server);
    await server.start();

    const response = await sendRawLocalIpcMessage(endpoint, JSON.stringify(request), {
      endAfterWrite: false,
    });

    expect(handled).toBe(false);
    expect(response).toMatchObject({
      id: request.id,
      ok: false,
      error: {
        code: "INVALID_ENVELOPE",
      },
    });
  });

  it("returns INVALID_ENVELOPE with invalid-request for malformed missing-newline requests", async () => {
    const rootDir = await createTempDir("fc-ipc-bad-nl");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    let handled = false;
    const server = new LocalIpcServer({
      endpoint,
      requestLineTimeoutMs: 10,
      handleMessage: () => {
        handled = true;
        return createOkResponse(createRequest("noop", {}, "unused"), { ok: true });
      },
    });
    servers.push(server);
    await server.start();

    const response = await sendRawLocalIpcMessage(endpoint, '{"id":', { endAfterWrite: false });

    expect(handled).toBe(false);
    expect(response).toMatchObject({
      id: "invalid-request",
      ok: false,
      error: {
        code: "INVALID_ENVELOPE",
      },
    });
  });

  it("returns INVALID_ENVELOPE when raw peer responses are missing the newline delimiter", async () => {
    const rootDir = await createTempDir("fc-ipc-no-nl-res");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    await startRawLocalIpcServer(endpoint, (socket) => {
      socket.once("data", () => {
        socket.end(
          JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            id: "ignored-peer-id",
            ok: true,
            result: {},
          }),
        );
      });
    });

    const request = createRequest("noop", {}, "missing-newline-response");

    await expect(sendLocalIpcRequest(endpoint, request)).resolves.toMatchObject({
      protocolVersion: request.protocolVersion,
      id: request.id,
      ok: false,
      error: {
        code: "INVALID_ENVELOPE",
      },
    });
  });

  it("falls back to invalid-request when a recovered ID makes the structured error too large", async () => {
    const rootDir = await createTempDir("fc-ipc-huge-id");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    const baseRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: "",
      command: "noop",
      params: {},
    };
    const baseBytes = Buffer.byteLength(JSON.stringify(baseRequest), "utf8");
    const hugeId = "x".repeat(MAX_LOCAL_IPC_MESSAGE_BYTES - baseBytes);
    const server = new LocalIpcServer({
      endpoint,
      requestLineTimeoutMs: 100,
      handleMessage: () => createOkResponse(createRequest("noop", {}, "unused"), { ok: true }),
    });
    servers.push(server);
    await server.start();

    const response = await sendRawLocalIpcMessage(
      endpoint,
      JSON.stringify({
        ...baseRequest,
        id: hugeId,
      }),
      { endAfterWrite: false },
    );

    expect(response).toMatchObject({
      id: "invalid-request",
      ok: false,
      error: {
        code: "OUTPUT_TOO_LARGE",
      },
    });
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

    const [first, second] = await Promise.all([
      getOrCreateLocalIpcAuthToken(store),
      getOrCreateLocalIpcAuthToken(store),
    ]);

    expect(first).toBe(second);
    await expect(readFile(join(rootDir, "ipc", "auth-token"), "utf8")).resolves.toBe(`${first}\n`);
  });

  it("rejects non-socket Unix endpoint paths without deleting them", async () => {
    if (process.platform === "win32") {
      return;
    }
    const rootDir = await createTempDir("fc-ipc-non-socket");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    if (endpoint.kind !== "unix-socket") {
      return;
    }
    await mkdir(dirname(endpoint.path), { recursive: true });
    await writeFile(endpoint.path, "not a socket");
    const server = new LocalIpcServer({
      endpoint,
      handleMessage: () => createOkResponse(createRequest("noop", {}, "unused"), { ok: true }),
    });

    await expect(server.start()).rejects.toMatchObject({ code: "SOCKET_FAILED" });
    await expect(readFile(endpoint.path, "utf8")).resolves.toBe("not a socket");
  });

  it("rejects symlinked Unix IPC parent directories before chmod or bind", async () => {
    if (process.platform === "win32") {
      return;
    }
    const rootDir = await createTempDir("fc-ipc-parent-symlink");
    const realDir = await createTempDir("fc-ipc-parent-real");
    await symlink(realDir, join(rootDir, "ipc"), "dir");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    const server = new LocalIpcServer({
      endpoint,
      handleMessage: () => createOkResponse(createRequest("noop", {}, "unused"), { ok: true }),
    });

    await expect(server.start()).rejects.toMatchObject({ code: "SOCKET_FAILED" });
  });

  it("does not unlink active Unix sockets during startup", async () => {
    if (process.platform === "win32") {
      return;
    }
    const rootDir = await createTempDir("fc-ipc-active-socket");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    await startRawLocalIpcServer(endpoint, (socket) => {
      socket.end(`${JSON.stringify({ ok: true })}\n`);
    });
    const server = new LocalIpcServer({
      endpoint,
      handleMessage: () => createOkResponse(createRequest("noop", {}, "unused"), { ok: true }),
    });

    await expect(server.start()).rejects.toMatchObject({ code: "SOCKET_FAILED" });
    await expectRawSocketConnects(endpoint);
  });

  it("replaces stale Unix socket paths only after probe refusal", async () => {
    if (process.platform === "win32") {
      return;
    }
    const rootDir = await createTempDir("fc-ipc-stale-socket");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    await startRawLocalIpcServer(endpoint, (socket) => {
      socket.end();
    });
    await Promise.all(
      rawServers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error === undefined ? resolve() : reject(error)));
          }),
      ),
    );
    const request = createRequest("noop", {}, "after-stale");
    const server = new LocalIpcServer({
      endpoint,
      handleMessage: () => createOkResponse(request, { ok: true }),
    });
    servers.push(server);

    await server.start();

    await expect(sendLocalIpcRequest(endpoint, request)).resolves.toEqual(
      createOkResponse(request, { ok: true }),
    );
  });

  it("returns TIMEOUT when a local IPC peer accepts but never responds", async () => {
    const rootDir = await createTempDir("fc-ipc-timeout");
    const endpoint = planTestLocalIpcEndpoint(rootDir);
    await startRawLocalIpcServer(endpoint, (socket) => {
      setTimeout(() => socket.destroy(), 50).unref?.();
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
    await startRawLocalIpcServer(endpoint, (socket) => {
      setTimeout(() => socket.destroy(), 50).unref?.();
    });
    const request = createRequest("noop", {}, "timeout-negotiated");

    await expect(
      sendNegotiatedLocalIpcRequest(endpoint, request, { timeoutMs: 10 }),
    ).resolves.toMatchObject({
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
      handleMessage: (message, context) => broker.handleCliRequest(message, context),
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
      handleMessage: (message, context) => broker.handleCliRequest(message, context),
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
      handleMessage: (message, context) => broker.handleCliRequest(message, context),
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

async function startRawLocalIpcServer(
  endpoint: LocalIpcEndpoint,
  handleConnection: (socket: Socket) => void,
): Promise<void> {
  if (endpoint.kind === "unix-socket") {
    await mkdir(dirname(endpoint.path), { recursive: true });
  }

  const server = createServer(handleConnection);
  rawServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint.path, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function planTestLocalIpcEndpoint(rootDir: string): LocalIpcEndpoint {
  return planLocalIpcEndpoint({
    platform: process.platform,
    rootDir,
    endpointScope: createLocalIpcEndpointScope("test-ipc-token"),
  });
}

async function expectRawSocketConnects(endpoint: LocalIpcEndpoint): Promise<void> {
  const socket = new Socket();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error("Timed out connecting to raw IPC socket."));
    }, 1000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = (): void => {
      cleanup();
      socket.destroy();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    socket.once("connect", onConnect);
    socket.once("error", onError);
    socket.connect(endpoint.path);
  });
}

async function sendRawLocalIpcMessage(
  endpoint: LocalIpcEndpoint,
  payload: string,
  options: { readonly endAfterWrite?: boolean } = {},
): Promise<unknown> {
  const socket = new Socket({ allowHalfOpen: true });
  return new Promise<unknown>((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error("Timed out waiting for a raw local IPC response line."));
    }, 1000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      cleanup();
      socket.destroy();
      try {
        resolve(JSON.parse(buffer.slice(0, newlineIndex)) as unknown);
      } catch (error) {
        reject(error);
      }
    };
    const onEnd = (): void => {
      if (buffer.length > 0) {
        cleanup();
        reject(new Error("Raw local IPC socket ended before a response line was sent."));
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
    socket.connect(endpoint.path);
    socket.once("connect", () => {
      socket.write(payload, () => {
        if (options.endAfterWrite ?? true) {
          socket.end();
        }
      });
    });
  });
}

async function sendOversizedRawLocalIpcMessage(
  endpoint: LocalIpcEndpoint,
  totalBytes: number,
): Promise<unknown> {
  const socket = new Socket({ allowHalfOpen: true });
  return new Promise<unknown>((resolve, reject) => {
    let remaining = totalBytes;
    let buffer = "";
    const timeout = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error("Timed out waiting for an oversized raw local IPC response line."));
    }, 1000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("connect", writeMore);
      socket.off("drain", writeMore);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      cleanup();
      socket.destroy();
      try {
        resolve(JSON.parse(buffer.slice(0, newlineIndex)) as unknown);
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const writeMore = (): void => {
      while (remaining > 0) {
        const chunkBytes = Math.min(remaining, 16 * 1024);
        remaining -= chunkBytes;
        if (!socket.write("x".repeat(chunkBytes))) {
          socket.once("drain", writeMore);
          return;
        }
      }
    };

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("connect", writeMore);
    socket.connect(endpoint.path);
  });
}
