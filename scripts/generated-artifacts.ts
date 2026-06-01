import { spawn } from "node:child_process";
import { lstat, mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export async function resetGeneratedArtifact(targetPath: string, options: { readonly repoRoot?: string } = {}): Promise<void> {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const distRoot = resolve(repoRoot, "dist");
  const target = resolve(repoRoot, targetPath);

  if (target === distRoot) {
    throw new Error("Refusing to reset the dist root directly.");
  }
  assertInsideDirectory(target, distRoot, "generated artifact");

  await mkdir(dirname(target), { recursive: true });
  if (await pathExists(target)) {
    await trashPath(target);
  }
  await mkdir(target, { recursive: true });
}

function assertInsideDirectory(path: string, directory: string, label: string): void {
  const inside = relative(directory, path);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error(`Refusing to reset ${label} outside ${directory}: ${path}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function trashPath(path: string): Promise<void> {
  if (process.env.CI === "true") {
    await rm(path, { recursive: true, force: true });
    return;
  }

  const trash = spawn("trash", [path], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  trash.stderr.setEncoding("utf8");
  trash.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
    trash.once("error", rejectExit);
    trash.once("close", (code) => {
      resolveExit(code ?? 1);
    });
  });
  if (exitCode !== 0) {
    throw new Error(`Failed to reset generated artifact ${path}: ${stderr.trim()}`);
  }
}
