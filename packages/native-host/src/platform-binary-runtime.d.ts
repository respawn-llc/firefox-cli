import type { PlatformInput } from "./platform-binary.js";

export declare function getPlatformKey(input?: PlatformInput): string;
export declare function getBinaryName(input?: PlatformInput): string;
export declare function resolvePackagedBinary(packageRoot: string, input?: PlatformInput): Promise<string>;
