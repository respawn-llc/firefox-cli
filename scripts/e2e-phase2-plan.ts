import { join } from "node:path";
import { getDefaultStateRoot } from "@firefox-cli/cli";
import {
  planLocalIpcEndpoint,
  planNativeMessagingManifest,
  type LocalIpcEndpoint,
  type NativeMessagingManifestPlan,
} from "@firefox-cli/native-host";

export type Phase2E2ePlan = {
  readonly env: NodeJS.ProcessEnv;
  readonly stateRoot: string;
  readonly endpoint: LocalIpcEndpoint;
  readonly manifestPlan: NativeMessagingManifestPlan;
};

export function planPhase2E2e(options: {
  readonly binaryPath: string;
  readonly homeDir: string;
  readonly platform: NodeJS.Platform;
  readonly baseEnv?: NodeJS.ProcessEnv;
}): Phase2E2ePlan {
  const appDataDir = join(options.homeDir, "AppData", "Roaming");
  const env: NodeJS.ProcessEnv = {
    ...options.baseEnv,
    HOME: options.homeDir,
    USERPROFILE: options.homeDir,
    APPDATA: appDataDir,
  };
  const stateRoot = getDefaultStateRoot(options.platform, options.homeDir, appDataDir);
  return {
    env,
    stateRoot,
    endpoint: planLocalIpcEndpoint({ platform: options.platform, rootDir: stateRoot }),
    manifestPlan: planNativeMessagingManifest({
      binaryPath: options.binaryPath,
      platform: options.platform,
      homeDir: options.homeDir,
      appDataDir,
    }),
  };
}
