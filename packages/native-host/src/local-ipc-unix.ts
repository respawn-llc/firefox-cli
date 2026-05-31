import { chmod, lstat, mkdir, stat, unlink } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname } from "node:path";
import { LocalIpcError } from "./local-ipc-types.js";
import { withDeadline } from "./reliability.js";

const DEFAULT_STALE_SOCKET_PROBE_TIMEOUT_MS = 100;

export interface PathIdentity {
  readonly dev: number;
  readonly ino: number;
}

export async function prepareUnixSocketParent(socketPath: string): Promise<void> {
  const directory = dirname(socketPath);
  await mkdir(directory, { mode: 0o700, recursive: true });
  await validateCurrentUserDirectory(directory);
  await chmod(directory, 0o700);
  await validateCurrentUserDirectory(directory);
}

export async function unlinkStaleUnixSocketAfterProbe(socketPath: string): Promise<void> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(socketPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  if (!stats.isSocket() || stats.isSymbolicLink()) {
    throw new LocalIpcError("SOCKET_FAILED", `IPC endpoint exists but is not a socket: ${socketPath}`);
  }
  validateCurrentUserOwner(stats.uid, `IPC endpoint is not owned by the current user: ${socketPath}`);

  const probe = await probeUnixSocket(socketPath);
  if (probe === "active") {
    throw new LocalIpcError("SOCKET_FAILED", "A firefox-cli native host is already listening.");
  }

  await unlink(socketPath).catch((error: unknown) => {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  });
}

export async function readPathIdentity(path: string): Promise<PathIdentity> {
  const stats = await stat(path);
  return { dev: stats.dev, ino: stats.ino };
}

export async function unlinkOwnedSocket(path: string, identity: PathIdentity): Promise<void> {
  try {
    const current = await readPathIdentity(path);
    if (current.dev === identity.dev && current.ino === identity.ino) {
      await unlink(path);
    }
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}

export function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

async function validateCurrentUserDirectory(directory: string): Promise<void> {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new LocalIpcError("SOCKET_FAILED", `IPC directory is not a real directory: ${directory}`);
  }
  validateCurrentUserOwner(stats.uid, `IPC directory is not owned by the current user: ${directory}`);
  if (process.platform !== "win32" && (stats.mode & 0o777) !== 0o700) {
    await chmod(directory, 0o700);
  }
}

function validateCurrentUserOwner(uid: number, message: string): void {
  if (typeof process.getuid !== "function") {
    return;
  }

  if (uid !== process.getuid()) {
    throw new LocalIpcError("SOCKET_FAILED", message);
  }
}

async function probeUnixSocket(socketPath: string): Promise<"active" | "stale"> {
  const socket = createConnection(socketPath);
  return withDeadline(
    new Promise<"active" | "stale">((resolve) => {
      const cleanup = (): void => {
        socket.off("connect", onConnect);
        socket.off("error", onError);
      };
      const onConnect = (): void => {
        cleanup();
        socket.destroy();
        resolve("active");
      };
      const onError = (error: NodeJS.ErrnoException): void => {
        cleanup();
        socket.destroy();
        resolve(error.code === "ECONNREFUSED" || error.code === "ENOENT" ? "stale" : "active");
      };
      socket.once("connect", onConnect);
      socket.once("error", onError);
    }),
    {
      timeoutMs: DEFAULT_STALE_SOCKET_PROBE_TIMEOUT_MS,
      message: "Timed out probing existing IPC socket.",
      onTimeout: () => socket.destroy(),
    },
  ).catch(() => "active");
}
