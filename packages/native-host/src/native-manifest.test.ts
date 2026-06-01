import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, posix, resolve, win32 } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { FIREFOX_CLI_EXTENSION_ID, NATIVE_HOST_NAME } from "./host-launch.js";
import { createNativeMessagingManifest, planNativeMessagingManifest, writeNativeMessagingManifest } from "./native-manifest.js";

describe("native messaging manifest generation", () => {
  it("creates Firefox native messaging manifest content", () => {
    const binaryPath = resolve("/tmp/package/bin/darwin-arm64/firefox-cli");

    expect(createNativeMessagingManifest({ binaryPath })).toEqual({
      name: NATIVE_HOST_NAME,
      description: "Native messaging host for firefox-cli.",
      path: binaryPath,
      type: "stdio",
      allowed_extensions: [FIREFOX_CLI_EXTENSION_ID],
    });
  });

  it("plans the macOS per-user manifest location", () => {
    const homeDir = "/Users/tester";
    const binaryPath = "/opt/firefox-cli/bin/darwin-arm64/firefox-cli";

    expect(planNativeMessagingManifest({ binaryPath, homeDir, platform: "darwin" })).toEqual({
      manifestPath: posix.join(homeDir, "Library/Application Support/Mozilla/NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`),
      manifest: createNativeMessagingManifest({ binaryPath }),
      registration: {
        kind: "file",
        manifestPath: posix.join(homeDir, "Library/Application Support/Mozilla/NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`),
      },
    });
  });

  it("plans the Linux per-user manifest location", () => {
    const homeDir = "/home/tester";
    const binaryPath = "/opt/firefox-cli/bin/linux-x64/firefox-cli";

    expect(planNativeMessagingManifest({ binaryPath, homeDir, platform: "linux" }).manifestPath).toBe(
      posix.join(homeDir, ".mozilla/native-messaging-hosts", `${NATIVE_HOST_NAME}.json`),
    );
  });

  it("plans Windows manifest storage and registry data without touching the registry", () => {
    const appDataDir = win32.join("C:\\Users\\tester", "AppData", "Roaming");
    const binaryPath = win32.join("C:\\pkg", "bin", "win32-x64", "firefox-cli.exe");
    const plan = planNativeMessagingManifest({
      appDataDir,
      binaryPath,
      homeDir: "C:\\Users\\tester",
      platform: "win32",
    });

    expect(plan).toEqual({
      manifestPath: win32.join(appDataDir, "firefox-cli", "native-messaging-hosts", `${NATIVE_HOST_NAME}.json`),
      manifest: createNativeMessagingManifest({ binaryPath }),
      registration: {
        kind: "windows-registry",
        hive: "HKEY_CURRENT_USER",
        key: `SOFTWARE\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
        valueName: "",
        value: win32.join(appDataDir, "firefox-cli", "native-messaging-hosts", `${NATIVE_HOST_NAME}.json`),
      },
    });
  });

  it("resolves the packaged platform binary when packageRoot is provided", async () => {
    const packageRoot = await createTempDir("firefox-cli-package-root");
    const binaryPath = join(packageRoot, "bin", "darwin-arm64", "firefox-cli");
    await mkdir(join(packageRoot, "bin", "darwin-arm64"), { recursive: true });
    await writeFile(binaryPath, "#!/bin/sh\n");
    await chmod(binaryPath, 0o755);

    await expect(
      planNativeMessagingManifest({
        homeDir: "/Users/tester",
        packageRoot,
        platform: "darwin",
        arch: "arm64",
      }),
    ).resolves.toMatchObject({
      manifest: {
        path: binaryPath,
      },
    });
  });

  it("writes manifests only to the planned path", async () => {
    const homeDir = await createTempDir("firefox-cli-home");
    const binaryPath = "/opt/firefox-cli/bin/darwin-arm64/firefox-cli";
    const plan = planNativeMessagingManifest({ binaryPath, homeDir, platform: "darwin" });

    await writeNativeMessagingManifest(plan);

    await expect(readFile(plan.manifestPath, "utf8")).resolves.toBe(`${JSON.stringify(plan.manifest, null, 2)}\n`);
  });
});
