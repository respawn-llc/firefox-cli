import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { copyExtensionAssets } from "../copy-extension-assets.js";
import { extensionDisplayMetadata } from "../extension-display-metadata.js";

describe("copyExtensionAssets", () => {
  it("validates and versions source extension manifests before copying", async () => {
    const { sourceDir, outputDir } = await createExtensionAssetFixture();

    await copyExtensionAssets({ sourceDir, outputDir, version: "1.2.3" });

    await expect(readFile(join(outputDir, "manifest.json"), "utf8")).resolves.toContain('"version": "1.2.3"');
  });

  it("rejects malformed source extension manifest JSON", async () => {
    const { sourceDir, outputDir } = await createExtensionAssetFixture();
    await writeFile(join(sourceDir, "manifest.json"), "{");

    await expect(copyExtensionAssets({ sourceDir, outputDir, version: "1.2.3" })).rejects.toThrow("Invalid source extension manifest JSON");
  });

  it("rejects wrong-shape source extension manifests", async () => {
    const { sourceDir, outputDir } = await createExtensionAssetFixture();
    await writeFile(
      join(sourceDir, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: extensionDisplayMetadata.name,
        version: "0.0.0",
        background: { scripts: "background.js" },
        permissions: "scripting",
        action: { default_popup: "popup.html" },
      }),
    );

    await expect(copyExtensionAssets({ sourceDir, outputDir, version: "1.2.3" })).rejects.toThrow("Invalid source extension manifest");
  });
});

async function createExtensionAssetFixture(): Promise<{
  readonly sourceDir: string;
  readonly outputDir: string;
}> {
  const root = await createTempDir("firefox-cli-copy-extension");
  const sourceDir = join(root, "source");
  const outputDir = join(root, "output");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    join(sourceDir, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: extensionDisplayMetadata.name,
      version: "0.0.0",
      background: { scripts: ["background.js"] },
      permissions: ["nativeMessaging", "scripting"],
      action: { default_popup: "popup.html" },
      browser_specific_settings: {
        gecko: { id: "ff-cli-bridge@respawn.pro", update_url: extensionDisplayMetadata.updateUrl },
      },
    }),
  );
  await writeFile(join(sourceDir, "popup.html"), "<!doctype html>\n");
  await writeFile(join(sourceDir, "popup.css"), "body {}\n");
  await writeFile(join(sourceDir, "approval-request.html"), "<!doctype html>\n");
  await writeFile(join(sourceDir, "approval-request.css"), "body {}\n");
  return { sourceDir, outputDir };
}
