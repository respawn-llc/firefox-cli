import { chmod, cp, lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface PackagedBinaryPathOptions {
  readonly packageRoot: string;
  readonly platformKey: string;
  readonly binaryName: string;
}

interface CopyPackagedBinaryOptions extends PackagedBinaryPathOptions {
  readonly sourcePath: string;
  readonly skipWhenPackageBinMissing?: boolean;
}

export function packagedBinaryPath(options: PackagedBinaryPathOptions): string {
  return resolve(options.packageRoot, "bin", options.platformKey, options.binaryName);
}

export async function copyPackagedBinary(options: CopyPackagedBinaryOptions): Promise<string | undefined> {
  const targetPath = packagedBinaryPath(options);
  const targetDir = dirname(targetPath);
  if (options.skipWhenPackageBinMissing === true && !(await pathExists(targetDir))) {
    return undefined;
  }

  await mkdir(targetDir, { recursive: true });
  await cp(options.sourcePath, targetPath);
  if (process.platform !== "win32") {
    await chmod(targetPath, 0o755);
  }
  return targetPath;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
