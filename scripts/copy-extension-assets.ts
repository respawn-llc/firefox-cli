import { cp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import { extensionManifestSchema, readJsonManifestFile } from "./manifest-validation.js";

const sourceDir = resolve("packages/extension/src");
const outputDir = resolve("dist/extension");

export async function copyExtensionAssets(options: {
  readonly sourceDir: string;
  readonly outputDir: string;
  readonly version: string;
}): Promise<void> {
  await mkdir(options.outputDir, { recursive: true });

  const manifest = await readJsonManifestFile(
    resolve(options.sourceDir, "manifest.json"),
    "source extension manifest",
    extensionManifestSchema,
  );
  manifest.version = options.version;

  await writeFile(
    resolve(options.outputDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await cp(resolve(options.sourceDir, "popup.html"), resolve(options.outputDir, "popup.html"));
  await cp(resolve(options.sourceDir, "popup.css"), resolve(options.outputDir, "popup.css"));
}

if (import.meta.main) {
  await copyExtensionAssets({
    sourceDir,
    outputDir,
    version: rootPackage.version,
  });

  console.log(`Copied extension assets to ${outputDir}`);
}
