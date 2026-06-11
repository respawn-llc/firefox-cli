import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getBinaryName, getPlatformKey } from "@firefox-cli/native-host";
import rootPackage from "../package.json" with { type: "json" };
import { resetGeneratedArtifact } from "./generated-artifacts.js";
import { copyPackagedBinary } from "./packaged-binary.js";

const packageRoot = resolve("dist/package");
const platformKey = getPlatformKey();
const binaryName = getBinaryName();

await resetGeneratedPackage(packageRoot);

await mkdir(resolve(packageRoot, "bin", platformKey), { recursive: true });
await writePackageJson(packageRoot);
await cp("README.md", resolve(packageRoot, "README.md"));
await cp("LICENSE", resolve(packageRoot, "LICENSE"));
await mkdir(resolve(packageRoot, "lib"), { recursive: true });
await cp("packages/cli/src/launcher-template.js", resolve(packageRoot, "bin/firefox-cli.js"));
await cp("packages/native-host/src/platform-binary-runtime.js", resolve(packageRoot, "lib/platform-binary.js"));
await chmod(resolve(packageRoot, "bin/firefox-cli.js"), 0o755);

await copyPackagedBinary({ sourcePath: resolve("dist/bin", platformKey, binaryName), packageRoot, platformKey, binaryName });

console.log(`Assembled package at ${packageRoot}`);

async function resetGeneratedPackage(path: string): Promise<void> {
  await resetGeneratedArtifact(path);
}

async function writePackageJson(path: string): Promise<void> {
  const packageJson = {
    name: "firefox-cli",
    version: rootPackage.version,
    description: "Firefox automation CLI for AI agents",
    type: "module",
    bin: {
      "firefox-cli": "bin/firefox-cli.js",
    },
    files: ["bin", "lib", "README.md", "LICENSE"],
    license: "AGPL-3.0-only",
  };

  await writeFile(resolve(path, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}
