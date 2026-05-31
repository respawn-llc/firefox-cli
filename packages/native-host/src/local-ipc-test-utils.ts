import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createServer, Socket, type Server } from "node:net";
import { createLocalIpcEndpointScope, planLocalIpcEndpoint, type LocalIpcEndpoint } from "./local-ipc.js";

export async function stopRawServers(rawServers: Server[]): Promise<void> {
  await Promise.all(rawServers.splice(0).map(async (server) => stopRawServer(server)));
}

export async function startRawLocalIpcServer(rawServers: Server[], endpoint: LocalIpcEndpoint, handleConnection: (socket: Socket) => void): Promise<void> {
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

export function planTestLocalIpcEndpoint(rootDir: string): LocalIpcEndpoint {
  return planLocalIpcEndpoint({
    platform: process.platform,
    rootDir,
    endpointScope: createLocalIpcEndpointScope("test-ipc-token"),
  });
}

export async function expectRawSocketConnects(endpoint: LocalIpcEndpoint): Promise<void> {
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

export async function sendRawLocalIpcMessage(
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
        resolve(JSON.parse(buffer.slice(0, newlineIndex)));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
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

export async function sendOversizedRawLocalIpcMessage(endpoint: LocalIpcEndpoint, totalBytes: number): Promise<unknown> {
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
        resolve(JSON.parse(buffer.slice(0, newlineIndex)));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
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

export async function stopRawServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}
