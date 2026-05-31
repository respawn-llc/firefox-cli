import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export class NativeHostReliabilityError extends Error {
  readonly code: "ATOMIC_WRITE_FAILED" | "LOCK_TIMEOUT" | "LOCK_INVALID" | "TRANSPORT_TIMEOUT";

  constructor(
    code: NativeHostReliabilityError["code"],
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "NativeHostReliabilityError";
    this.code = code;
  }
}

export type AtomicWriteOptions = {
  readonly mode?: number;
  readonly beforeRename?: (tempPath: string) => Promise<void> | void;
};

export async function writeFileAtomically(
  filePath: string,
  data: string | Buffer,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = join(
    directory,
    `.${basename(filePath)}.${process.pid}.${Date.now()}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let tempCreated = false;

  try {
    const handle = await open(tempPath, "wx", options.mode ?? 0o600);
    tempCreated = true;
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (options.mode !== undefined && process.platform !== "win32") {
      await chmod(tempPath, options.mode);
    }
    await options.beforeRename?.(tempPath);
    await rename(tempPath, filePath);
    if (options.mode !== undefined && process.platform !== "win32") {
      await chmod(filePath, options.mode);
    }
    await fsyncDirectoryBestEffort(directory);
  } catch (error) {
    if (tempCreated) {
      await unlink(tempPath).catch(() => undefined);
    }
    throw new NativeHostReliabilityError("ATOMIC_WRITE_FAILED", "Atomic file write failed.", {
      cause: error,
    });
  }
}

export type FileLockOptions = {
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly now?: () => number;
  readonly pid?: number;
  readonly uid?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly sleep?: (durationMs: number) => Promise<void>;
};

type LockOwner = {
  readonly pid: number;
  readonly uid?: number;
  readonly createdAt: string;
};

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_RETRY_DELAY_MS = 25;
const LOCK_OWNER_FILE = "owner.json";

export async function withFileLock<T>(
  lockPath: string,
  callback: () => Promise<T> | T,
  options: FileLockOptions = {},
): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_LOCK_RETRY_DELAY_MS;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;
  const sleep = options.sleep ?? delay;
  const isProcessAlive = options.isProcessAlive ?? isPidAlive;
  const ownerUid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : undefined);
  const owner: LockOwner = {
    pid: options.pid ?? process.pid,
    ...(ownerUid === undefined ? {} : { uid: ownerUid }),
    createdAt: new Date(now()).toISOString(),
  };

  while (true) {
    const acquired = await tryAcquireLock(lockPath, owner);
    if (acquired) {
      try {
        return await callback();
      } finally {
        await releaseLock(lockPath);
      }
    }

    await recoverDeadOwnerLock(lockPath, isProcessAlive);
    if (now() >= deadline) {
      throw new NativeHostReliabilityError(
        "LOCK_TIMEOUT",
        `Timed out waiting for native-host lock: ${lockPath}`,
      );
    }
    await sleep(Math.min(retryDelayMs, Math.max(0, deadline - now())));
  }
}

export function createLocalIpcEndpointScope(token: string): string {
  return createHash("sha256").update(token).digest("base64url").slice(0, 24);
}

export async function withDeadline<T>(
  promise: Promise<T>,
  options: {
    readonly timeoutMs: number;
    readonly message: string;
    readonly onTimeout?: () => void;
  },
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          options.onTimeout?.();
          reject(new NativeHostReliabilityError("TRANSPORT_TIMEOUT", options.message));
        }, options.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function tryAcquireLock(lockPath: string, owner: LockOwner): Promise<boolean> {
  try {
    await mkdir(lockPath, { mode: 0o700 });
    try {
      await writeFile(join(lockPath, LOCK_OWNER_FILE), `${JSON.stringify(owner)}\n`, {
        mode: 0o600,
      });
    } catch (error) {
      await rmdir(lockPath).catch(() => undefined);
      throw error;
    }
    return true;
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      return false;
    }
    throw error;
  }
}

async function recoverDeadOwnerLock(
  lockPath: string,
  isProcessAlive: (pid: number) => boolean,
): Promise<void> {
  const owner = await readLockOwner(lockPath);
  if (owner === null || isProcessAlive(owner.pid)) {
    return;
  }

  await unlink(join(lockPath, LOCK_OWNER_FILE)).catch(() => undefined);
  await rmdir(lockPath).catch(() => undefined);
}

async function readLockOwner(lockPath: string): Promise<LockOwner | null> {
  try {
    const parsed = JSON.parse(await readFile(join(lockPath, LOCK_OWNER_FILE), "utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "pid" in parsed &&
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      "createdAt" in parsed &&
      typeof parsed.createdAt === "string"
    ) {
      return {
        pid: parsed.pid,
        ...("uid" in parsed && typeof parsed.uid === "number" ? { uid: parsed.uid } : {}),
        createdAt: parsed.createdAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  await unlink(join(lockPath, LOCK_OWNER_FILE)).catch(() => undefined);
  await rmdir(lockPath).catch(() => undefined);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
  }
}

async function fsyncDirectoryBestEffort(directory: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }

  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is platform/filesystem-dependent; file fsync + rename remains atomic.
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

async function delay(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}
