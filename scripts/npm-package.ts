import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import { resetGeneratedArtifact } from "./generated-artifacts.js";
import { copyPackagedBinary } from "./packaged-binary.js";
import { supportedBinaryTargets, type SupportedBinaryTarget } from "./platform-targets.js";

const packageRoot = resolve("dist/npm");
const cliPackageRoot = resolve(packageRoot, "firefox-cli");
const repositoryMetadata = {
  type: "git",
  url: "git+https://github.com/respawn-llc/firefox-cli.git",
};

await resetGeneratedArtifact(packageRoot);
await writeCliPackage();
await Promise.all(supportedBinaryTargets.map(writeNativePackage));

console.log(`Assembled npm packages at ${packageRoot}`);

async function writeCliPackage(): Promise<void> {
  await mkdir(resolve(cliPackageRoot, "bin"), { recursive: true });
  await mkdir(resolve(cliPackageRoot, "lib"), { recursive: true });
  await writePackageJson(resolve(cliPackageRoot, "package.json"), {
    name: "firefox-cli",
    version: rootPackage.version,
    description: "Firefox automation CLI for AI agents",
    type: "module",
    bin: {
      "firefox-cli": "bin/firefox-cli.js",
    },
    files: ["bin", "lib", "README.md", "LICENSE"],
    optionalDependencies: Object.fromEntries(supportedBinaryTargets.map((target) => [target.npmPackageName, rootPackage.version])),
    license: "AGPL-3.0-only",
    repository: repositoryMetadata,
  });
  await cp("README.md", resolve(cliPackageRoot, "README.md"));
  await cp("LICENSE", resolve(cliPackageRoot, "LICENSE"));
  await cp("packages/cli/src/launcher-template.js", resolve(cliPackageRoot, "bin/firefox-cli.js"));
  await cp("packages/cli/src/npm-platform-binary-runtime.js", resolve(cliPackageRoot, "lib/platform-binary.js"));
  await chmod(resolve(cliPackageRoot, "bin/firefox-cli.js"), 0o755);
}

async function writeNativePackage(target: SupportedBinaryTarget): Promise<void> {
  const nativePackageRoot = resolve(packageRoot, target.npmPackageName);
  await mkdir(nativePackageRoot, { recursive: true });
  await writePackageJson(resolve(nativePackageRoot, "package.json"), {
    name: target.npmPackageName,
    version: rootPackage.version,
    description: `Firefox CLI native executable for ${target.platformKey}`,
    files: ["bin"],
    os: [target.platform],
    cpu: [target.arch],
    license: "AGPL-3.0-only",
    repository: repositoryMetadata,
  });
  await copyPackagedBinary({
    sourcePath: resolve("dist/bin", target.platformKey, target.binaryName),
    packageRoot: nativePackageRoot,
    platformKey: "",
    binaryName: target.binaryName,
  });
}

async function writePackageJson(path: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
