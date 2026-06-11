import { chmod, lstat, mkdir, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { copyPackagedBinary } from "./packaged-binary.js";
import {
  resolveBinaryTargetByBunTarget,
  resolveBinaryTargetByPlatformKey,
  resolveCurrentBinaryTarget,
  type SupportedBinaryTarget,
} from "./platform-targets.js";
import { runProcess } from "./process-runner.js";

const rootDir = process.cwd();
const entrypointPath = resolve("packages/cli/src/entrypoint.ts");
const packageRoot = resolve("dist/package");

if (import.meta.main) {
  const target = resolveRequestedTarget(process.argv.slice(2));
  await buildBinary(target);
}

export async function buildBinary(target: SupportedBinaryTarget): Promise<string> {
  const outputPath = resolve("dist/bin", target.platformKey, target.binaryName);
  await mkdir(dirname(outputPath), { recursive: true });

  const buildWorkdir = await mkdtemp(join(tmpdir(), "firefox-cli-bun-build-"));

  try {
    await runProcess("bun", ["build", entrypointPath, "--compile", `--target=${target.bunTarget}`, "--outfile", outputPath], {
      cwd: buildWorkdir,
      stderr: "inherit",
      stdout: "inherit",
    });
  } finally {
    await removeBuildWorkdir(buildWorkdir);
  }

  await cleanupRootBunBuildArtifacts(rootDir);

  if (target.platform !== "win32") {
    await chmod(outputPath, 0o755);
  }

  console.log(`Built ${outputPath}`);
  const syncedPackageBinaryPath = await copyPackagedBinary({
    sourcePath: outputPath,
    packageRoot,
    platformKey: target.platformKey,
    binaryName: target.binaryName,
    skipWhenPackageBinMissing: true,
  });
  if (syncedPackageBinaryPath !== undefined) {
    console.log(`Updated packaged binary ${syncedPackageBinaryPath}`);
  }
  return outputPath;
}

function resolveRequestedTarget(args: readonly string[]): SupportedBinaryTarget {
  const platformKey = readOption(args, "--platform-key");
  if (platformKey !== undefined) {
    return resolveBinaryTargetByPlatformKey(platformKey);
  }
  const bunTarget = readOption(args, "--target");
  if (bunTarget !== undefined) {
    return resolveBinaryTargetByBunTarget(bunTarget);
  }
  return resolveCurrentBinaryTarget();
}

function readOption(args: readonly string[], name: string): string | undefined {
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed !== undefined) {
    return prefixed.slice(name.length + 1);
  }
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Expected value after ${name}`);
  }
  return value;
}

async function removeBuildWorkdir(path: string): Promise<void> {
  const resolvedPath = resolve(path);
  const resolvedTempDir = resolve(tmpdir());
  const relativePath = relative(resolvedTempDir, resolvedPath);
  if (relativePath.startsWith("..") || relativePath.includes(`..${sep}`) || !relativePath.startsWith("firefox-cli-bun-build-")) {
    throw new Error(`Refusing to remove unexpected Bun build directory: ${path}`);
  }
  await rm(resolvedPath, { recursive: true, force: true });
}

export async function cleanupRootBunBuildArtifacts(root: string): Promise<void> {
  const artifacts = (await readdir(root)).filter(isRootBunBuildArtifact);
  await Promise.all(
    artifacts.map(async (artifact) => {
      const artifactPath = resolve(root, artifact);
      const info = await lstat(artifactPath);
      if (info.isSymbolicLink()) {
        throw new Error(`Refusing to clean symlinked Bun build artifact: ${artifactPath}`);
      }
      if (!info.isFile()) {
        throw new Error(`Refusing to clean unsupported Bun build artifact file type: ${artifactPath}`);
      }
      await assertBunBuildArtifactSignature(artifactPath);
      await rm(artifactPath, { recursive: false, force: false });
    }),
  );
  if (artifacts.length > 0) {
    console.log(`Cleaned Bun root build artifacts: ${artifacts.join(", ")}`);
  }
}

function isRootBunBuildArtifact(name: string): boolean {
  return name.startsWith(".") && name.endsWith(".bun-build");
}

async function assertBunBuildArtifactSignature(path: string): Promise<void> {
  const file = await open(path, "r");
  const prefix = Buffer.alloc(4);
  const { bytesRead } = await file.read(prefix, 0, prefix.length, 0).finally(async () => file.close());
  const data = prefix.subarray(0, bytesRead);
  if (!hasKnownExecutableSignature(data)) {
    throw new Error(`Refusing to clean Bun build artifact without executable signature: ${path}`);
  }
}

function hasKnownExecutableSignature(data: Buffer): boolean {
  return [Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from([0x4d, 0x5a])].some((signature) =>
    data.subarray(0, signature.length).equals(signature),
  );
}
