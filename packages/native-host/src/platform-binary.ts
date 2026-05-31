export type SupportedPlatform = "darwin" | "linux" | "win32";
export type SupportedArch = "arm64" | "x64";

export interface PlatformInput {
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
}

export { getBinaryName, getPlatformKey, resolvePackagedBinary } from "./platform-binary-runtime.js";
