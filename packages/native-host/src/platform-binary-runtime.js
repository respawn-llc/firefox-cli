import { access } from "node:fs/promises";
import { join } from "node:path";

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
  const binaryPath = join(packageRoot, "bin", getPlatformKey(input), getBinaryName(input));
  await access(binaryPath);
  return binaryPath;
}

function isSupportedPlatform(platform) {
  return platform === "darwin" || platform === "linux" || platform === "win32";
}

function isSupportedArch(arch) {
  return arch === "arm64" || arch === "x64";
}
