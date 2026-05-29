import { dirname, resolve } from "node:path";
import {
  FileLocalIpcAuthTokenStore,
  FilePairStateStore,
  planLocalIpcEndpoint,
  sendLocalIpcRequest,
} from "@firefox-cli/native-host";
import type { CliDependencies } from "./types.js";

export function createDefaultDependencies(version: string): CliDependencies {
  const binaryPath = process.execPath;
  const packageRoot = resolve(dirname(binaryPath), "../..");
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";

  return {
    version,
    platform: process.platform,
    arch: process.arch,
    homeDir,
    ...(process.env.APPDATA === undefined ? {} : { appDataDir: process.env.APPDATA }),
    packageRoot,
    binaryPath,
    cwd: process.cwd(),
    sendRequest: async (request) => {
      const stateRoot = getUserStateRoot(process.platform, homeDir, process.env.APPDATA);
      const endpoint = planLocalIpcEndpoint({
        platform: process.platform,
        rootDir: stateRoot,
      });
      const authToken = await new FileLocalIpcAuthTokenStore({ stateRoot }).read();
      return sendLocalIpcRequest(endpoint, request, { authToken });
    },
    clearPairState: async () => {
      await new FilePairStateStore({
        rootDir: homeDir,
        platform: process.platform,
        ...(process.env.APPDATA === undefined ? {} : { appDataDir: process.env.APPDATA }),
      }).clear();
    },
  };
}

export function getDefaultStateRoot(
  platform: NodeJS.Platform,
  homeDir: string,
  appDataDir: string | undefined,
): string {
  return getUserStateRoot(platform, homeDir, appDataDir);
}

export function getUserStateRoot(
  platform: NodeJS.Platform,
  homeDir: string,
  appDataDir: string | undefined,
): string {
  if (platform === "win32") {
    return appDataDir ?? resolve(homeDir, "AppData", "Roaming");
  }

  return platform === "darwin"
    ? resolve(homeDir, "Library/Application Support/firefox-cli")
    : resolve(homeDir, ".config/firefox-cli");
}

export function optionalAppDataDir(appDataDir: string | undefined): {
  readonly appDataDir?: string;
} {
  return appDataDir === undefined ? {} : { appDataDir };
}

export function readProcessStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      content += chunk;
    });
    process.stdin.once("end", () => resolve(content));
    process.stdin.once("error", reject);
  });
}
