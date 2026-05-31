import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { MarionetteClient } from "../marionette-client.js";

const servers: ReturnType<typeof createServer>[] = [];
const clients: MarionetteClient[] = [];
const sockets: Socket[] = [];

describe("Marionette client timing", () => {
  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.close();
    }
    for (const socket of sockets.splice(0)) {
      socket.destroy();
    }
    await Promise.all(
      servers.splice(0).map(
        async (server) =>
          new Promise<void>((resolve) => {
            server.close(() => {
              resolve();
            });
          }),
      ),
    );
  });

  it("times out commands without poisoning later Marionette responses", async () => {
    const { port, socket } = await startMarionetteServer();
    const client = await MarionetteClient.connect(port, { commandTimeoutMs: 1 });
    clients.push(client);
    const serverSocket = await socket;

    await expect(client.send("Test:NeverAnswers", {})).rejects.toThrow("Marionette command timed out");

    const response = client.send("Test:Answers", {});
    serverSocket.write(marionetteFrame([1, 2, null, { value: 42 }]));

    await expect(response).resolves.toEqual({ value: 42 });
  });

  it("rejects in-flight commands when the Marionette socket closes", async () => {
    const { port, socket } = await startMarionetteServer();
    const client = await MarionetteClient.connect(port, { commandTimeoutMs: 1_000 });
    clients.push(client);
    const serverSocket = await socket;

    const response = client.send("Test:SocketCloses", {});
    serverSocket.end();

    await expect(response).rejects.toThrow("Marionette socket closed");
  });

  it("rejects overlarge Marionette frames instead of buffering them indefinitely", async () => {
    const { port, socket } = await startMarionetteServer();
    const client = await MarionetteClient.connect(port, {
      commandTimeoutMs: 1_000,
      maxFrameBytes: 8,
    });
    clients.push(client);
    const serverSocket = await socket;

    const response = client.send("Test:OverlargeFrame", {});
    serverSocket.write("9:123456789");

    await expect(response).rejects.toThrow("Marionette frame length 9 exceeds 8 bytes");
  });
});

async function startMarionetteServer(): Promise<{
  readonly port: number;
  readonly socket: Promise<Socket>;
}> {
  let resolveSocket: (socket: Socket) => void = () => undefined;
  const socketPromise = new Promise<Socket>((resolve) => {
    resolveSocket = resolve;
  });
  const server = createServer((socket) => {
    sockets.push(socket);
    resolveSocket(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not expose a TCP port");
  }
  return { port: address.port, socket: socketPromise };
}

function marionetteFrame(message: unknown): string {
  const payload = JSON.stringify(message);
  return `${String(Buffer.byteLength(payload))}:${payload}`;
}
