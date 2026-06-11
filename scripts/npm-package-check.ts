import { cp, lstat, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import rootPackage from "../package.json" with { type: "json" };
import { parseJsonManifestContent } from "./manifest-validation.js";
import { resolveCurrentBinaryTarget, supportedBinaryTargets } from "./platform-targets.js";
import { runProcess } from "./process-runner.js";
import { readRegularFileUnder } from "./safe-extension-files.js";

const npmRoot = resolve("dist/npm");
const cliPackageRoot = resolve(npmRoot, "firefox-cli");

const packageJsonSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    bin: z.record(z.string(), z.string()).optional(),
    optionalDependencies: z.record(z.string(), z.string()).optional(),
    os: z.array(z.string().min(1)).optional(),
    cpu: z.array(z.string().min(1)).optional(),
  })
  .loose();

await verifyCliPackage();
await Promise.all(supportedBinaryTargets.map(verifyNativePackage));
await verifyTempInstall();

console.log("Npm package layout check passed.");

async function verifyCliPackage(): Promise<void> {
  await Promise.all(
    ["README.md", "LICENSE", "bin/firefox-cli.js", "lib/platform-binary.js"].map(async (path) => readRegularFileUnder(cliPackageRoot, path, path)),
  );
  const packageJson = await readPackageJson(resolve(cliPackageRoot, "package.json"));
  if (packageJson.name !== "firefox-cli") {
    throw new Error(`Expected CLI npm package name firefox-cli, received ${packageJson.name}`);
  }
  if (packageJson.version !== rootPackage.version) {
    throw new Error(`Expected CLI npm package version ${rootPackage.version}, received ${packageJson.version}`);
  }
  if (packageJson.bin?.["firefox-cli"] !== "bin/firefox-cli.js") {
    throw new Error("Expected CLI npm package bin to point at bin/firefox-cli.js");
  }
  const optionalDependencies = packageJson.optionalDependencies ?? {};
  for (const target of supportedBinaryTargets) {
    if (optionalDependencies[target.npmPackageName] !== rootPackage.version) {
      throw new Error(`Expected optional dependency ${target.npmPackageName}@${rootPackage.version}`);
    }
  }
}

async function verifyNativePackage(target: (typeof supportedBinaryTargets)[number]): Promise<void> {
  const nativeRoot = resolve(npmRoot, target.npmPackageName);
  const binaryPath = resolve(nativeRoot, "bin", target.binaryName);
  await readRegularFileUnder(nativeRoot, `bin/${target.binaryName}`, `${target.platformKey} binary`);
  const binaryInfo = await lstat(binaryPath);
  if (binaryInfo.size === 0) {
    throw new Error(`Expected ${target.npmPackageName} binary to be non-empty`);
  }
  const packageJson = await readPackageJson(resolve(nativeRoot, "package.json"));
  if (packageJson.name !== target.npmPackageName) {
    throw new Error(`Expected native package name ${target.npmPackageName}, received ${packageJson.name}`);
  }
  if (packageJson.version !== rootPackage.version) {
    throw new Error(`Expected native package version ${rootPackage.version}, received ${packageJson.version}`);
  }
  if (packageJson.os?.length !== 1 || packageJson.os[0] !== target.platform) {
    throw new Error(`Expected ${target.npmPackageName} os selector ${target.platform}`);
  }
  if (packageJson.cpu?.length !== 1 || packageJson.cpu[0] !== target.arch) {
    throw new Error(`Expected ${target.npmPackageName} cpu selector ${target.arch}`);
  }
}

async function verifyTempInstall(): Promise<void> {
  const target = resolveCurrentBinaryTarget();
  const tempRoot = await mkdtemp(join(tmpdir(), "firefox-cli-npm-package-check-"));
  const installRoot = join(tempRoot, "node_modules");
  await cp(cliPackageRoot, join(installRoot, "firefox-cli"), { recursive: true });
  await cp(resolve(npmRoot, target.npmPackageName), join(installRoot, target.npmPackageName), { recursive: true });
  const result = await runProcess(process.execPath, [join(installRoot, "firefox-cli/bin/firefox-cli.js"), "--version"], {
    timeoutMs: 30_000,
    label: "npm temp install",
  });
  if (result.stdout.trim() !== rootPackage.version) {
    throw new Error(`Expected npm temp install version ${rootPackage.version}, received ${result.stdout.trim()}`);
  }
}

async function readPackageJson(path: string): Promise<z.infer<typeof packageJsonSchema>> {
  return parseJsonManifestContent(await readFile(path, "utf8"), "npm package manifest", path, packageJsonSchema);
}
