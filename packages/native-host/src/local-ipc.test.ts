import { dirname, join } from "node:path";
import { mkdir, readFile, stat } from "node:fs/promises";
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
  getOrCreateLocalIpcAuthToken,
  planLocalIpcEndpoint,
  sendLocalIpcRequest,
  type LocalIpcEndpoint,
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
    expect(planLocalIpcEndpoint({ platform: "darwin", rootDir: "/tmp/firefox-cli" })).toEqual({
      kind: "unix-socket",
      path: join("/tmp/firefox-cli", "ipc", "firefox_cli.sock"),
    });
    expect(planLocalIpcEndpoint({ platform: "linux", rootDir: "/tmp/firefox-cli" })).toEqual({
      kind: "unix-socket",
      path: join("/tmp/firefox-cli", "ipc", "firefox_cli.sock"),
    });
    expect(planLocalIpcEndpoint({ platform: "win32", rootDir: "ignored" })).toEqual({
      kind: "windows-named-pipe",
      path: "\\\\.\\pipe\\firefox-cli-firefox_cli",
    });
  });

  it("sends a CLI request to a running host broker and validates the response", async () => {
    const rootDir = await createTempDir("firefox-cli-ipc");
    const endpoint = planLocalIpcEndpoint({ platform: process.platform, rootDir });
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
    const endpoint = planLocalIpcEndpoint({ platform: process.platform, rootDir });
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
    const endpoint = planLocalIpcEndpoint({ platform: process.platform, rootDir });
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
    const endpoint = planLocalIpcEndpoint({
      platform: process.platform,
      rootDir: await createTempDir("fc-ipc-out"),
    });
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
    const endpoint = planLocalIpcEndpoint({ platform: process.platform, rootDir });
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
    const endpoint = planLocalIpcEndpoint({ platform: process.platform, rootDir });
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
    const endpoint = planLocalIpcEndpoint({ platform: process.platform, rootDir });
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
    const endpoint = planLocalIpcEndpoint({ platform: process.platform, rootDir });
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
    const endpoint = planLocalIpcEndpoint({ platform: process.platform, rootDir });
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
    const endpoint = planLocalIpcEndpoint({ platform: process.platform, rootDir });
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
    const endpoint = planLocalIpcEndpoint({ platform: process.platform, rootDir });
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
