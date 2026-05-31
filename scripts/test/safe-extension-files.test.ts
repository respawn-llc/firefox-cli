import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { listRegularFilesUnder, readRegularFileUnder } from "../safe-extension-files.js";

describe("safe extension file traversal", () => {
  it("rejects symlinks before listing extension archive inputs", async () => {
    const root = await createTempDir("firefox-cli-safe-files");
    const outsideRoot = await createTempDir("firefox-cli-safe-files-outside");
    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(join(outsideRoot, "secret.txt"), "outside\n");
    await symlink(join(outsideRoot, "secret.txt"), join(root, "nested/secret.txt"));

    await expect(listRegularFilesUnder(root, "test extension archive")).rejects.toThrow("Refusing to traverse symlink");
  });

  it("rejects symlinks before reading package-validation inputs", async () => {
    const root = await createTempDir("firefox-cli-safe-read");
    const outsideRoot = await createTempDir("firefox-cli-safe-read-outside");
    await writeFile(join(outsideRoot, "manifest.json"), "{}\n");
    await symlink(join(outsideRoot, "manifest.json"), join(root, "manifest.json"));

    await expect(readRegularFileUnder(root, "manifest.json", "test manifest")).rejects.toThrow("Refusing to read symlink");
  });
});
