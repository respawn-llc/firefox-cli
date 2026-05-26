import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import rootPackage from "../package.json" with { type: "json" };
import { createTempDir } from "@firefox-cli/test-support";
import { getBinaryName, getPlatformKey, type PlatformInput } from "@firefox-cli/native-host";
import { verifyPackageLayout } from "./package-check.js";

const platform: PlatformInput = {
  platform: "linux",
  arch: "x64",
};

describe("verifyPackageLayout", () => {
  it("accepts a complete development package layout", async () => {
    const packageRoot = await createPackageRoot();
    await verifyPackageLayout({ packageRoot, platform });
  });

  it("requires the real platform binary", async () => {
    const packageRoot = await createPackageRoot({ includeBinary: false });
    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow();
  });

  it("requires signed XPI for release checks", async () => {
    const packageRoot = await createPackageRoot();
    await expect(
      verifyPackageLayout({ packageRoot, platform, requireSignedXpi: true }),
    ).rejects.toThrow();
  });

  it("fails when packaged extension metadata drifts from the product version", async () => {
    const packageRoot = await createPackageRoot({ extensionVersion: "9.9.9" });

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow(
      "Expected extension version",
    );
  });

  it("rejects extension bundles with shared JavaScript chunks", async () => {
    const packageRoot = await createPackageRoot();
    await mkdir(join(packageRoot, "extension/development/chunks"), { recursive: true });
    await writeFile(join(packageRoot, "extension/development/chunks/index.js"), "export {};\n");

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow(
      "Unexpected extension JavaScript artifacts",
    );
  });

  it("rejects extension entry scripts that import generated chunks", async () => {
    const packageRoot = await createPackageRoot();
    await writeFile(
      join(packageRoot, "extension/development/background.js"),
      'import "./chunks/index.js";\n',
    );

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow(
      "Expected standalone extension script",
    );
  });
});

async function createPackageRoot(
  options: { readonly includeBinary?: boolean; readonly extensionVersion?: string } = {},
): Promise<string> {
  const packageRoot = await createTempDir("firefox-cli-package-check");
  const platformKey = getPlatformKey(platform);

  await mkdir(join(packageRoot, "bin", platformKey), { recursive: true });
  await mkdir(join(packageRoot, "extension/development"), { recursive: true });

  await writeFile(
    join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "firefox-cli",
        version: rootPackage.version,
        type: "module",
        bin: {
          "firefox-cli": "./bin/firefox-cli.js",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(packageRoot, "README.md"), "# test\n");
  await writeFile(join(packageRoot, "LICENSE"), "MIT\n");
  await writeFile(join(packageRoot, "bin/firefox-cli.js"), "#!/usr/bin/env node\n");
  await mkdir(join(packageRoot, "lib"), { recursive: true });
  await writeFile(join(packageRoot, "lib/platform-binary.js"), "export {};\n");
  await writeFile(
    join(packageRoot, "extension/development/manifest.json"),
    `${JSON.stringify(
      {
        version: options.extensionVersion ?? rootPackage.version,
        background: { scripts: ["background.js"] },
        content_scripts: [{ js: ["content.js"] }],
        action: { default_popup: "popup.html" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(packageRoot, "extension/development/background.js"), "console.log('bg');\n");
  await writeFile(join(packageRoot, "extension/development/content.js"), "console.log('cs');\n");
  await writeFile(join(packageRoot, "extension/development/popup.js"), "console.log('popup');\n");
  await writeFile(join(packageRoot, "extension/development/popup.html"), "<!doctype html>\n");

  if (options.includeBinary !== false) {
    await writeFile(join(packageRoot, "bin", platformKey, getBinaryName(platform)), "");
  }

  return packageRoot;
}
