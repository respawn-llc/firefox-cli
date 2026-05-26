import { dirname, join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { createTempDir } from "@firefox-cli/test-support";
import { createOkResponse, createRequest, kernelCapabilities } from "@firefox-cli/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FIREFOX_CLI_EXTENSION_ID } from "./host-launch.js";
import { NativeHostBroker } from "./host-broker.js";
import {
  FileLocalIpcAuthTokenStore,
  LocalIpcServer,
  getOrCreateLocalIpcAuthToken,
  planLocalIpcEndpoint,
  sendLocalIpcRequest,
} from "./local-ipc.js";
import { createHostIdentity } from "./pair-state.js";

const servers: LocalIpcServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
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
