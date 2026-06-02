import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { verifyPackageLayout } from "../package-check.js";
import { createPackageRoot, packageCheckPlatform } from "./package-check-test-utils.js";

const platform = packageCheckPlatform;

describe("verifyPackageLayout", () => {
  it("accepts a complete package layout without embedded extension artifacts", async () => {
    const packageRoot = await createPackageRoot();
    await verifyPackageLayout({ packageRoot, platform });
  });

  it("requires the real platform binary", async () => {
    const packageRoot = await createPackageRoot({ includeBinary: false });
    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow();
  });

  it("does not satisfy signed-XPI release checks from package contents", async () => {
    const packageRoot = await createPackageRoot();
    await expect(verifyPackageLayout({ packageRoot, platform, requireSignedXpi: true })).rejects.toThrow(
      "Signed extension XPIs are downloadable release artifacts",
    );
  });

  it("rejects embedded extension artifacts", async () => {
    const packageRoot = await createPackageRoot({ includeExtensionPayload: true });
    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow("Package must not contain embedded extension artifacts");
  });

  it("rejects copied extension update manifests", async () => {
    const packageRoot = await createPackageRoot();
    await mkdir(join(packageRoot, "docs/firefox-cli"), { recursive: true });
    await writeFile(join(packageRoot, "docs/firefox-cli/updates.json"), "{}\n");

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow("Package must not contain a copied extension update manifest");
  });

  it("rejects malformed and wrong-shape package manifests", async () => {
    const malformed = await createPackageRoot();
    await writeFile(join(malformed, "package.json"), "{");
    await expect(verifyPackageLayout({ packageRoot: malformed, platform })).rejects.toThrow("Invalid package manifest JSON");

    const wrongShape = await createPackageRoot();
    await writeFile(join(wrongShape, "package.json"), JSON.stringify({ name: "firefox-cli", version: 1, bin: "bin/firefox-cli.js" }));
    await expect(verifyPackageLayout({ packageRoot: wrongShape, platform })).rejects.toThrow("Invalid package manifest");
  });

  it("rejects symlinked packaged binaries before reading them", async () => {
    const packageRoot = await createPackageRoot({ includeBinary: false });
    const outsideFile = join(await createTempDir("firefox-cli-outside-binary"), "firefox-cli");
    await writeFile(outsideFile, "outside package\n");
    await mkdir(join(packageRoot, "bin/linux-x64"), { recursive: true });
    await symlink(outsideFile, join(packageRoot, "bin/linux-x64/firefox-cli"));

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow("Refusing to read symlink");
  });
});
