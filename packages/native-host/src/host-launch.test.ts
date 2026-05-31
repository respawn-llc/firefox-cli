import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIREFOX_CLI_EXTENSION_ID, NATIVE_HOST_NAME, detectNativeHostLaunch } from "./host-launch.js";

describe("detectNativeHostLaunch", () => {
  it("detects Firefox native-host invocation by manifest path and extension ID", () => {
    const manifestPath = join("/Users/test/Library/Application Support", `${NATIVE_HOST_NAME}.json`);

    expect(
      detectNativeHostLaunch([manifestPath, FIREFOX_CLI_EXTENSION_ID], {
        expectedExtensionId: FIREFOX_CLI_EXTENSION_ID,
        nativeHostName: NATIVE_HOST_NAME,
      }),
    ).toEqual({
      kind: "native-host",
      manifestPath,
      extensionId: FIREFOX_CLI_EXTENSION_ID,
    });
  });

  it("keeps normal CLI invocations in CLI mode", () => {
    expect(detectNativeHostLaunch(["doctor"])).toEqual({ kind: "cli" });
    expect(detectNativeHostLaunch(["setup", "native-host"])).toEqual({ kind: "cli" });
    expect(detectNativeHostLaunch(["--version"])).toEqual({ kind: "cli" });
    expect(detectNativeHostLaunch([])).toEqual({ kind: "cli" });
  });

  it("rejects a Firefox-style invocation with an unexpected extension ID", () => {
    const manifestPath = join("/tmp", `${NATIVE_HOST_NAME}.json`);

    expect(detectNativeHostLaunch([manifestPath, "other@example.invalid"])).toEqual({
      kind: "invalid-native-host",
      code: "EXTENSION_ID_MISMATCH",
      message: "Native host was launched by an unexpected extension ID.",
      details: {
        expectedExtensionId: FIREFOX_CLI_EXTENSION_ID,
        receivedExtensionId: "other@example.invalid",
      },
    });
  });

  it("rejects a Firefox-style invocation with the wrong manifest file name", () => {
    expect(detectNativeHostLaunch([join("/tmp", "other_host.json"), FIREFOX_CLI_EXTENSION_ID])).toEqual({
      kind: "invalid-native-host",
      code: "MANIFEST_NAME_MISMATCH",
      message: "Native host was launched with an unexpected manifest path.",
      details: {
        expectedManifestFileName: `${NATIVE_HOST_NAME}.json`,
        receivedManifestPath: join("/tmp", "other_host.json"),
      },
    });
  });

  it("does not treat extra CLI arguments as native-host mode", () => {
    expect(
      detectNativeHostLaunch([join("/tmp", `${NATIVE_HOST_NAME}.json`), FIREFOX_CLI_EXTENSION_ID, "doctor"]),
    ).toEqual({ kind: "cli" });
  });
});
