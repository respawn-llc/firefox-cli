import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import { getBinaryName, getPlatformKey } from "@firefox-cli/native-host";

const packageRoot = resolve("dist/package");
const platformKey = getPlatformKey();
const binaryName = getBinaryName();

await resetGeneratedPackage(packageRoot);

await mkdir(resolve(packageRoot, "bin", platformKey), { recursive: true });
await mkdir(resolve(packageRoot, "extension/development"), { recursive: true });

await writePackageJson(packageRoot);
await cp("README.md", resolve(packageRoot, "README.md"));
await cp("LICENSE", resolve(packageRoot, "LICENSE"));
await mkdir(resolve(packageRoot, "lib"), { recursive: true });
await cp("packages/cli/src/launcher-template.js", resolve(packageRoot, "bin/firefox-cli.js"));
await cp(
  "packages/native-host/src/platform-binary-runtime.js",
  resolve(packageRoot, "lib/platform-binary.js"),
);
await chmod(resolve(packageRoot, "bin/firefox-cli.js"), 0o755);

await cp(
  resolve("dist/bin", platformKey, binaryName),
  resolve(packageRoot, "bin", platformKey, binaryName),
);
if (process.platform !== "win32") {
  await chmod(resolve(packageRoot, "bin", platformKey, binaryName), 0o755);
}

await cp("dist/extension", resolve(packageRoot, "extension/development"), {
  recursive: true,
});

await copyExtensionArchive(packageRoot);
await copySignedExtensionXpi(packageRoot);

console.log(`Assembled package at ${packageRoot}`);

async function resetGeneratedPackage(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await rm(path, { force: true, recursive: true });
  await mkdir(path, { recursive: true });
}

async function writePackageJson(path: string): Promise<void> {
  const packageJson = {
    name: "firefox-cli",
    version: rootPackage.version,
    description: "Firefox automation CLI for AI agents",
    type: "module",
    bin: {
      "firefox-cli": "./bin/firefox-cli.js",
    },
    files: ["bin", "lib", "extension", "README.md", "LICENSE"],
    license: "MIT",
  };

  await writeFile(resolve(path, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function copyExtensionArchive(path: string): Promise<void> {
  const artifactName = `firefox-cli-${rootPackage.version}.zip`;
  const artifactPath = resolve("dist/extension-artifacts", artifactName);

  try {
    await cp(artifactPath, resolve(path, "extension/development", artifactName));
    return;
  } catch {
    // The development directory is still useful for local extension loading.
  }

  const manifest = await readFile(resolve(path, "extension/development/manifest.json"), "utf8");
  await writeFile(
    resolve(path, "extension/development/README.md"),
    `Development extension directory only. Manifest:\n\n${manifest}`,
  );
}

async function copySignedExtensionXpi(path: string): Promise<void> {
  const envPath = process.env.FIREFOX_CLI_SIGNED_XPI;
  const sourcePath =
    envPath === undefined || envPath.length === 0
      ? resolve("dist/extension-artifacts", `firefox-cli-${rootPackage.version}.xpi`)
      : resolve(envPath);

  try {
    await cp(sourcePath, resolve(path, "extension/firefox-cli.xpi"));
  } catch (error) {
    if (envPath !== undefined && envPath.length > 0) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to copy FIREFOX_CLI_SIGNED_XPI from ${sourcePath}: ${message}`);
    }
  }
}
