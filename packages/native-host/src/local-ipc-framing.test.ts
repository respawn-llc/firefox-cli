import { createTempDir } from "@firefox-cli/test-support";
import { PROTOCOL_VERSION, createOkResponse, createRequest } from "@firefox-cli/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { LocalIpcServer, MAX_LOCAL_IPC_MESSAGE_BYTES, sendLocalIpcRequest } from "./local-ipc.js";
import {
  planTestLocalIpcEndpoint,
  sendOversizedRawLocalIpcMessage,
  sendRawLocalIpcMessage,
  startRawLocalIpcServer,
  stopRawServers,
} from "./local-ipc-test-utils.js";
import type { Server } from "node:net";

const servers: LocalIpcServer[] = [];
const rawServers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.stop()));
  await stopRawServers(rawServers);
});

describe("local IPC framing", () => {
  it("returns OUTPUT_TOO_LARGE before connecting when the outbound request exceeds the IPC budget", async () => {
    const endpoint = planTestLocalIpcEndpoint(await createTempDir("fc-ipc-out"));
    const request = createRequest("eval", { script: "x".repeat(MAX_LOCAL_IPC_MESSAGE_BYTES), source: "argv" }, "oversized-outbound");

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

    const response = await sendOversizedRawLocalIpcMessage(endpoint, MAX_LOCAL_IPC_MESSAGE_BYTES + 1);

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
    await startRawLocalIpcServer(rawServers, endpoint, (socket) => {
      peerClosed = new Promise((resolve) =>
        socket.once("close", () => {
          resolve();
        }),
      );
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
    await startRawLocalIpcServer(rawServers, endpoint, (socket) => {
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
});
