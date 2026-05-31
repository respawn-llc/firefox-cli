import { dirname, join } from "node:path";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import type { Server } from "node:net";
import { createTempDir } from "@firefox-cli/test-support";
import { createOkResponse, createRequest } from "@firefox-cli/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { LocalIpcServer, sendLocalIpcRequest } from "./local-ipc.js";
import { expectRawSocketConnects, planTestLocalIpcEndpoint, startRawLocalIpcServer, stopRawServer, stopRawServers } from "./local-ipc-test-utils.js";

const servers: LocalIpcServer[] = [];
const rawServers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.stop()));
  await stopRawServers(rawServers);
});

describe("local IPC Unix socket startup", () => {
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
    await startRawLocalIpcServer(rawServers, endpoint, (socket) => {
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
    await startRawLocalIpcServer(rawServers, endpoint, (socket) => {
      socket.end();
    });
    await Promise.all(rawServers.splice(0).map(async (server) => stopRawServer(server)));
    const request = createRequest("noop", {}, "after-stale");
    const server = new LocalIpcServer({
      endpoint,
      handleMessage: () => createOkResponse(request, { ok: true }),
    });
    servers.push(server);

    await server.start();

    await expect(sendLocalIpcRequest(endpoint, request)).resolves.toEqual(createOkResponse(request, { ok: true }));
  });
});
