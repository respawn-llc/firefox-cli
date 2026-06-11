import { getBinaryName, getPlatformKey, type PlatformInput } from "@firefox-cli/native-host";

export interface SupportedBinaryTarget extends PlatformInput {
  readonly bunTarget: string;
  readonly platformKey: string;
  readonly binaryName: string;
  readonly npmPackageName: string;
}

const targetInputs = [
  { platform: "darwin", arch: "arm64", bunTarget: "bun-darwin-arm64" },
  { platform: "darwin", arch: "x64", bunTarget: "bun-darwin-x64" },
  { platform: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
  { platform: "linux", arch: "x64", bunTarget: "bun-linux-x64" },
  { platform: "win32", arch: "arm64", bunTarget: "bun-windows-arm64" },
  { platform: "win32", arch: "x64", bunTarget: "bun-windows-x64" },
] satisfies readonly (PlatformInput & { readonly bunTarget: string })[];

export const supportedBinaryTargets: readonly SupportedBinaryTarget[] = targetInputs.map((target) => ({
  ...target,
  platformKey: getPlatformKey(target),
  binaryName: getBinaryName(target),
  npmPackageName: `@respawn-app/firefox-cli-native-${getPlatformKey(target)}`,
}));

export function resolveCurrentBinaryTarget(input: PlatformInput = process): SupportedBinaryTarget {
  const target = supportedBinaryTargets.find((candidate) => candidate.platform === input.platform && candidate.arch === input.arch);
  if (target === undefined) {
    throw new Error(`Unsupported binary target: ${input.platform}-${input.arch}`);
  }
  return target;
}

export function resolveBinaryTargetByPlatformKey(platformKey: string): SupportedBinaryTarget {
  const target = supportedBinaryTargets.find((candidate) => candidate.platformKey === platformKey);
  if (target === undefined) {
    throw new Error(`Unsupported platform key: ${platformKey}`);
  }
  return target;
}

export function resolveBinaryTargetByBunTarget(bunTarget: string): SupportedBinaryTarget {
  const target = supportedBinaryTargets.find((candidate) => candidate.bunTarget === bunTarget);
  if (target === undefined) {
    throw new Error(`Unsupported Bun executable target: ${bunTarget}`);
  }
  return target;
}
