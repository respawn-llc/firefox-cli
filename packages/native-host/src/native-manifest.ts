import { join, posix, win32 } from "node:path";
import { z } from "zod";
import { resolvePackagedBinary, type PlatformInput } from "./platform-binary.js";
import { FIREFOX_CLI_EXTENSION_ID, NATIVE_HOST_NAME } from "./host-launch.js";
import { parsePersistedJson } from "./persisted-json.js";
import { writeFileAtomically } from "./reliability.js";

export type NativeMessagingManifest = {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly type: "stdio";
  readonly allowed_extensions: readonly string[];
};

export const nativeMessagingManifestSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    path: z.string().min(1),
    type: z.literal("stdio"),
    allowed_extensions: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type NativeMessagingManifestRegistration =
  | {
      readonly kind: "file";
      readonly manifestPath: string;
    }
  | {
      readonly kind: "windows-registry";
      readonly hive: "HKEY_CURRENT_USER";
      readonly key: string;
      readonly valueName: "";
      readonly value: string;
    };

export type NativeMessagingManifestPlan = {
  readonly manifestPath: string;
  readonly manifest: NativeMessagingManifest;
  readonly registration: NativeMessagingManifestRegistration;
};

export type NativeMessagingManifestOptions = {
  readonly binaryPath: string;
  readonly name?: string;
  readonly allowedExtensions?: readonly string[];
};

export type NativeMessagingManifestPlanOptions =
  | ({
      readonly binaryPath: string;
      readonly packageRoot?: never;
      readonly arch?: never;
    } & NativeMessagingManifestPlanBaseOptions)
  | ({
      readonly binaryPath?: never;
      readonly packageRoot: string;
      readonly arch: PlatformInput["arch"];
    } & NativeMessagingManifestPlanBaseOptions);

type NativeMessagingManifestPlanBaseOptions = {
  readonly platform: PlatformInput["platform"];
  readonly homeDir: string;
  readonly appDataDir?: string;
  readonly name?: string;
  readonly allowedExtensions?: readonly string[];
};

export function createNativeMessagingManifest(
  options: NativeMessagingManifestOptions,
): NativeMessagingManifest {
  return {
    name: options.name ?? NATIVE_HOST_NAME,
    description: "Native messaging host for firefox-cli.",
    path: options.binaryPath,
    type: "stdio",
    allowed_extensions: options.allowedExtensions ?? [FIREFOX_CLI_EXTENSION_ID],
  };
}

export async function planNativeMessagingManifest(
  options: Extract<NativeMessagingManifestPlanOptions, { readonly packageRoot: string }>,
): Promise<NativeMessagingManifestPlan>;
export function planNativeMessagingManifest(
  options: Extract<NativeMessagingManifestPlanOptions, { readonly binaryPath: string }>,
): NativeMessagingManifestPlan;
export function planNativeMessagingManifest(
  options: NativeMessagingManifestPlanOptions,
): NativeMessagingManifestPlan | Promise<NativeMessagingManifestPlan> {
  if ("packageRoot" in options && options.packageRoot !== undefined) {
    return resolvePackagedBinary(options.packageRoot, {
      platform: options.platform,
      arch: options.arch,
    }).then((binaryPath) => createManifestPlan({ ...options, binaryPath }));
  }

  return createManifestPlan(options);
}

export async function writeNativeMessagingManifest(
  plan: NativeMessagingManifestPlan,
): Promise<void> {
  await writeFileAtomically(plan.manifestPath, `${JSON.stringify(plan.manifest, null, 2)}\n`);
}

export function parseNativeMessagingManifestJson(
  content: string,
  filePath: string,
): NativeMessagingManifest {
  return parsePersistedJson(content, nativeMessagingManifestSchema, {
    filePath,
    label: "Native messaging manifest",
  });
}

function createManifestPlan(
  options: NativeMessagingManifestPlanBaseOptions & { readonly binaryPath: string },
): NativeMessagingManifestPlan {
  const name = options.name ?? NATIVE_HOST_NAME;
  const manifestPath = getPerUserManifestPath(
    options.platform,
    options.homeDir,
    name,
    optionalAppDataDir(options.appDataDir),
  );
  const manifest = createNativeMessagingManifest({
    binaryPath: options.binaryPath,
    name,
    ...optionalAllowedExtensions(options.allowedExtensions),
  });

  return {
    manifestPath,
    manifest,
    registration: getRegistrationPlan(options.platform, manifestPath, name),
  };
}

function optionalAppDataDir(appDataDir: string | undefined): { readonly appDataDir?: string } {
  return appDataDir === undefined ? {} : { appDataDir };
}

function optionalAllowedExtensions(allowedExtensions: readonly string[] | undefined): {
  readonly allowedExtensions?: readonly string[];
} {
  return allowedExtensions === undefined ? {} : { allowedExtensions };
}

function getPerUserManifestPath(
  platform: PlatformInput["platform"],
  homeDir: string,
  name: string,
  options: { readonly appDataDir?: string },
): string {
  if (platform === "darwin") {
    return join(
      homeDir,
      "Library/Application Support/Mozilla/NativeMessagingHosts",
      `${name}.json`,
    );
  }

  if (platform === "linux") {
    return posix.join(homeDir, ".mozilla/native-messaging-hosts", `${name}.json`);
  }

  if (platform === "win32") {
    const appDataDir = options.appDataDir ?? win32.join(homeDir, "AppData", "Roaming");
    return win32.join(appDataDir, "firefox-cli", "native-messaging-hosts", `${name}.json`);
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

function getRegistrationPlan(
  platform: PlatformInput["platform"],
  manifestPath: string,
  name: string,
): NativeMessagingManifestRegistration {
  if (platform === "win32") {
    return {
      kind: "windows-registry",
      hive: "HKEY_CURRENT_USER",
      key: `SOFTWARE\\Mozilla\\NativeMessagingHosts\\${name}`,
      valueName: "",
      value: manifestPath,
    };
  }

  return {
    kind: "file",
    manifestPath,
  };
}
