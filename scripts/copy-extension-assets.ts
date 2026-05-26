import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };

const sourceDir = resolve("packages/extension/src");
const outputDir = resolve("dist/extension");

await mkdir(outputDir, { recursive: true });

const manifest = JSON.parse(await readFile(resolve(sourceDir, "manifest.json"), "utf8")) as {
  version: string;
};
manifest.version = rootPackage.version;

await writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(resolve(sourceDir, "popup.html"), resolve(outputDir, "popup.html"));
await cp(resolve(sourceDir, "popup.css"), resolve(outputDir, "popup.css"));

console.log(`Copied extension assets to ${outputDir}`);
