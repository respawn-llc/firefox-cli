import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { NativeHostReliabilityError, withFileLock, writeFileAtomically } from "./reliability.js";

describe("native host reliability helpers", () => {
  it("keeps the previous file when an atomic write fails before rename", async () => {
    const rootDir = await createTempDir("fc-atomic-write");
    const filePath = join(rootDir, "state.json");
    await writeFile(filePath, "stable\n");

    await expect(
      writeFileAtomically(filePath, "replacement\n", {
        beforeRename: () => {
          throw new Error("injected failure");
        },
      }),
    ).rejects.toBeInstanceOf(NativeHostReliabilityError);

    await expect(readFile(filePath, "utf8")).resolves.toBe("stable\n");
  });

  it("recovers locks owned by dead pids", async () => {
    const rootDir = await createTempDir("fc-lock-dead");
    const lockPath = join(rootDir, "state.lock");
    await mkdir(lockPath);
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({ pid: 12345, createdAt: new Date(0).toISOString() }));

    await expect(
      withFileLock(lockPath, () => "acquired", {
        isProcessAlive: () => false,
        timeoutMs: 50,
        retryDelayMs: 1,
      }),
    ).resolves.toBe("acquired");
  });

  it("does not recover locks owned by live pids or locks with invalid metadata", async () => {
    const rootDir = await createTempDir("fc-lock-live");
    const liveLockPath = join(rootDir, "live.lock");
    await mkdir(liveLockPath);
    await writeFile(join(liveLockPath, "owner.json"), JSON.stringify({ pid: 12345, createdAt: new Date(0).toISOString() }));

    await expect(
      withFileLock(liveLockPath, () => "not-used", {
        isProcessAlive: () => true,
        timeoutMs: 5,
        retryDelayMs: 1,
      }),
    ).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });

    const invalidLockPath = join(rootDir, "invalid.lock");
    await mkdir(invalidLockPath);
    await writeFile(join(invalidLockPath, "owner.json"), "{");

    await expect(
      withFileLock(invalidLockPath, () => "not-used", {
        isProcessAlive: () => false,
        timeoutMs: 5,
        retryDelayMs: 1,
      }),
    ).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });
  });
});
