import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export function getPlatformKey(input = process) {
  if (!isSupportedPlatform(input.platform)) {
    throw new Error(`Unsupported platform: ${input.platform}`);
  }
  if (!isSupportedArch(input.arch)) {
    throw new Error(`Unsupported architecture: ${input.arch}`);
  }

  return `${input.platform}-${input.arch}`;
}

export function getBinaryName(input = process) {
  return input.platform === "win32" ? "firefox-cli.exe" : "firefox-cli";
}

export async function resolvePackagedBinary(packageRoot, input = process) {
  void packageRoot;
  const platformKey = getPlatformKey(input);
  const packageName = `@firefox-cli/native-${platformKey}`;
  let packageJsonPath;
  try {
    packageJsonPath = require.resolve(`${packageName}/package.json`);
  } catch (error) {
    throw new Error(`Missing firefox-cli native package for ${platformKey}. Reinstall firefox-cli with optional dependencies enabled.`, { cause: error });
  }

  const binaryPath = join(dirname(packageJsonPath), "bin", getBinaryName(input));
  await access(binaryPath);
  return binaryPath;
}

function isSupportedPlatform(platform) {
  return platform === "darwin" || platform === "linux" || platform === "win32";
}

function isSupportedArch(arch) {
  return arch === "arm64" || arch === "x64";
}
