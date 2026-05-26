import { basename } from "node:path";
import { FIREFOX_CLI_EXTENSION_ID, NATIVE_HOST_NAME } from "@firefox-cli/protocol";

export { FIREFOX_CLI_EXTENSION_ID, NATIVE_HOST_NAME };

export type NativeHostLaunchDetection =
  | {
      readonly kind: "cli";
    }
  | {
      readonly kind: "native-host";
      readonly manifestPath: string;
      readonly extensionId: string;
    }
  | {
      readonly kind: "invalid-native-host";
      readonly code: "EXTENSION_ID_MISMATCH" | "MANIFEST_NAME_MISMATCH";
      readonly message: string;
      readonly details: Record<string, unknown>;
    };

export type NativeHostLaunchDetectionOptions = {
  readonly expectedExtensionId?: string;
  readonly nativeHostName?: string;
};

export function detectNativeHostLaunch(
  args: readonly string[],
  options: NativeHostLaunchDetectionOptions = {},
): NativeHostLaunchDetection {
  const expectedExtensionId = options.expectedExtensionId ?? FIREFOX_CLI_EXTENSION_ID;
  const nativeHostName = options.nativeHostName ?? NATIVE_HOST_NAME;

  if (args.length !== 2) {
    return { kind: "cli" };
  }

  const [manifestPath, extensionId] = args;
  if (manifestPath === undefined || extensionId === undefined || !manifestPath.endsWith(".json")) {
    return { kind: "cli" };
  }

  const expectedManifestFileName = `${nativeHostName}.json`;
  if (basename(manifestPath) !== expectedManifestFileName) {
    return {
      kind: "invalid-native-host",
      code: "MANIFEST_NAME_MISMATCH",
      message: "Native host was launched with an unexpected manifest path.",
      details: {
        expectedManifestFileName,
        receivedManifestPath: manifestPath,
      },
    };
  }

  if (extensionId !== expectedExtensionId) {
    return {
      kind: "invalid-native-host",
      code: "EXTENSION_ID_MISMATCH",
      message: "Native host was launched by an unexpected extension ID.",
      details: {
        expectedExtensionId,
        receivedExtensionId: extensionId,
      },
    };
  }

  return {
    kind: "native-host",
    manifestPath,
    extensionId,
  };
}
