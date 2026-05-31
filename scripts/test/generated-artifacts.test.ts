import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { resetGeneratedArtifact } from "../generated-artifacts.js";

describe("generated artifact reset", () => {
  it("resets only generated paths under dist", async () => {
    const repoRoot = await createTempDir("firefox-cli-generated-artifacts");
    const packageRoot = join(repoRoot, "dist/package");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "stale.txt"), "stale");

    await resetGeneratedArtifact(packageRoot, { repoRoot });

    await expect(readFile(join(packageRoot, "stale.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses to reset paths outside dist or the dist root itself", async () => {
    const repoRoot = await createTempDir("firefox-cli-generated-artifacts");

    await expect(resetGeneratedArtifact(join(repoRoot, "README.md"), { repoRoot })).rejects.toThrow(
      "outside",
    );
    await expect(resetGeneratedArtifact(join(repoRoot, "dist"), { repoRoot })).rejects.toThrow("dist root");
  });

  it("resets a generated symlink without trashing the symlink target", async () => {
    const repoRoot = await createTempDir("firefox-cli-generated-artifacts");
    const outsideTarget = join(repoRoot, "outside-target");
    const generatedLink = join(repoRoot, "dist/package");
    await mkdir(outsideTarget, { recursive: true });
    await mkdir(join(repoRoot, "dist"), { recursive: true });
    await writeFile(join(outsideTarget, "keep.txt"), "keep");
    await symlink(outsideTarget, generatedLink);

    await resetGeneratedArtifact(generatedLink, { repoRoot });

    await expect(readFile(join(outsideTarget, "keep.txt"), "utf8")).resolves.toBe("keep");
    await expect(readFile(join(generatedLink, "keep.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
