import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { getBinaryName, getPlatformKey } from "@firefox-cli/native-host";
import { copyPackagedBinary } from "./packaged-binary.js";
import { runProcess } from "./process-runner.js";

const platformKey = getPlatformKey();
const binaryName = getBinaryName();
const rootDir = process.cwd();
const outputPath = resolve("dist/bin", platformKey, binaryName);
const entrypointPath = resolve("packages/cli/src/entrypoint.ts");
const packageRoot = resolve("dist/package");

await mkdir(dirname(outputPath), { recursive: true });

const buildWorkdir = await mkdtemp(join(tmpdir(), "firefox-cli-bun-build-"));

try {
  await runProcess("bun", ["build", entrypointPath, "--compile", "--outfile", outputPath], {
    cwd: buildWorkdir,
    stderr: "inherit",
    stdout: "inherit",
  });
} finally {
  await removeBuildWorkdir(buildWorkdir);
}

await assertNoRootBunBuildArtifacts(rootDir);

if (process.platform !== "win32") {
  await chmod(outputPath, 0o755);
}

console.log(`Built ${outputPath}`);
const syncedPackageBinaryPath = await copyPackagedBinary({
  sourcePath: outputPath,
  packageRoot,
  platformKey,
  binaryName,
  skipWhenPackageBinMissing: true,
});
if (syncedPackageBinaryPath !== undefined) {
  console.log(`Updated packaged binary ${syncedPackageBinaryPath}`);
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

async function assertNoRootBunBuildArtifacts(root: string): Promise<void> {
  const artifacts = (await readdir(root)).filter(isRootBunBuildArtifact);
  if (artifacts.length > 0) {
    throw new Error(
      `Bun compile left root build artifacts: ${artifacts.slice(0, 5).join(", ")}${artifacts.length > 5 ? `, and ${String(artifacts.length - 5)} more` : ""}`,
    );
  }
}

function isRootBunBuildArtifact(name: string): boolean {
  return name.startsWith(".") && name.endsWith(".bun-build");
}
