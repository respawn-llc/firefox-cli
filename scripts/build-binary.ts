import { chmod, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getBinaryName, getPlatformKey } from "@firefox-cli/native-host";

const platformKey = getPlatformKey();
const rootDir = process.cwd();
const outputPath = resolve("dist/bin", platformKey, getBinaryName());
const entrypointPath = resolve("packages/cli/src/entrypoint.ts");

await mkdir(dirname(outputPath), { recursive: true });

const buildWorkdir = await mkdtemp(join(tmpdir(), "firefox-cli-bun-build-"));

let exitCode = 1;
try {
  const build = Bun.spawn(["bun", "build", entrypointPath, "--compile", "--outfile", outputPath], {
    cwd: buildWorkdir,
    stderr: "inherit",
    stdout: "inherit",
  });

  exitCode = await build.exited;
} finally {
  await moveToTrash(buildWorkdir);
}

if (exitCode !== 0) {
  process.exit(exitCode);
}

await assertNoRootBunBuildArtifacts(rootDir);

if (process.platform !== "win32") {
  await chmod(outputPath, 0o755);
}

console.log(`Built ${outputPath}`);

async function moveToTrash(path: string): Promise<void> {
  const trash = Bun.spawn(["trash", path], {
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await trash.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to move temporary Bun build directory to Trash: ${path}`);
  }
}

async function assertNoRootBunBuildArtifacts(root: string): Promise<void> {
  const artifacts = (await readdir(root)).filter(isRootBunBuildArtifact);
  if (artifacts.length > 0) {
    throw new Error(
      `Bun compile left root build artifacts: ${artifacts.slice(0, 5).join(", ")}${
        artifacts.length > 5 ? `, and ${artifacts.length - 5} more` : ""
      }`,
    );
  }
}

function isRootBunBuildArtifact(name: string): boolean {
  return name.startsWith(".") && name.endsWith(".bun-build");
}
