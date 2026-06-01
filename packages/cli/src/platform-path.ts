import { posix, win32 } from "node:path";

export function resolvePlatformPath(platform: NodeJS.Platform, ...segments: readonly string[]): string {
  return platform === "win32" ? win32.resolve(...segments) : posix.resolve(...segments);
}
