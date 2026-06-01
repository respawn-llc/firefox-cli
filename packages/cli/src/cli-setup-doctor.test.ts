import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { createErrorResponse } from "@firefox-cli/protocol";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { baseDependencies, baseDependenciesWithoutExtensionPath, parseSetupDryRunOutput } from "./cli-test-support.js";
import { runCli } from "./index.js";

describe("runCli setup and doctor", () => {
  it("writes a temp-safe native-host manifest during setup", async () => {
    const homeDir = await createTempDir("firefox-cli-home");
    const binaryPath = "/opt/firefox-cli/bin/darwin-arm64/firefox-cli";
    const output = await runCli(["setup", "native-host"], {
      ...baseDependencies(),
      binaryPath,
      homeDir,
      platform: "darwin",
    });

    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain("Native host manifest installed:");
    expect(output.stdout).toContain(darwinManifestPath(homeDir));
    await expect(readFile(darwinManifestPath(homeDir), "utf8")).resolves.toContain(binaryPath);
  });

  it("prints setup guidance with extension artifact location", async () => {
    const output = await runCli(["setup"], {
      ...baseDependencies(),
      extensionPath: "/opt/firefox-cli/extension/development",
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: [
        "firefox-cli setup",
        "Extension: load /opt/firefox-cli/extension/development in Firefox about:debugging.",
        "Native host: run `firefox-cli setup native-host`.",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  it("prefers packaged signed extension path in setup guidance", async () => {
    const packageRoot = await createTempDir("firefox-cli-package");
    await mkdir(join(packageRoot, "extension"), { recursive: true });
    await writeFile(join(packageRoot, "extension/firefox-cli.xpi"), "signed xpi\n");
    const dependencies = baseDependenciesWithoutExtensionPath();

    const jsonOutput = await runCli(["setup", "--json"], {
      ...dependencies,
      packageRoot,
    });
    const textOutput = await runCli(["setup"], {
      ...dependencies,
      packageRoot,
    });

    expect(JSON.parse(jsonOutput.stdout)).toMatchObject({
      extensionPath: join(packageRoot, "extension/firefox-cli.xpi"),
    });
    expect(textOutput.stdout).toContain(`Extension: install ${join(packageRoot, "extension/firefox-cli.xpi")} in Firefox.`);
  });

  it("prints setup native-host dry-run JSON without writing the manifest", async () => {
    const homeDir = await createTempDir("firefox-cli-home");
    const binaryPath = "/opt/firefox-cli/bin/darwin-arm64/firefox-cli";
    const output = await runCli(["setup", "native-host", "--dry-run", "--json"], {
      ...baseDependencies(),
      binaryPath,
      homeDir,
      platform: "darwin",
    });
    const parsed = parseSetupDryRunOutput(output.stdout);

    expect(output.exitCode).toBe(0);
    expect(parsed.manifest.path).toBe(binaryPath);
    await expect(access(parsed.manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports doctor setup state and fixes a missing manifest", async () => {
    const homeDir = await createTempDir("firefox-cli-home");
    const binaryPath = "/opt/firefox-cli/bin/darwin-arm64/firefox-cli";
    const output = await runCli(["doctor", "--fix"], {
      ...baseDependencies(),
      binaryPath,
      homeDir,
      platform: "darwin",
      sendRequest: async (request) =>
        createErrorResponse(request.id, {
          code: "EXTENSION_NOT_CONNECTED",
          message: "Firefox extension is not connected to the native host.",
        }),
    });

    expect(output.exitCode).toBe(1);
    expect(output.stdout).toContain("Native host manifest: installed");
    expect(output.stdout).toContain("Extension connection: disconnected");
    await expect(readFile(darwinManifestPath(homeDir), "utf8")).resolves.toContain(binaryPath);
  });

  it("repairs a stale native-host manifest path during doctor fix", async () => {
    const homeDir = await createTempDir("firefox-cli-home");
    const oldBinaryPath = "/old/firefox-cli";
    const newBinaryPath = "/opt/firefox-cli/bin/darwin-arm64/firefox-cli";
    await runCli(["setup", "native-host"], {
      ...baseDependencies(),
      binaryPath: oldBinaryPath,
      homeDir,
      platform: "darwin",
    });

    const beforeFix = await runCli(["doctor", "--json"], {
      ...baseDependencies(),
      binaryPath: newBinaryPath,
      homeDir,
      platform: "darwin",
    });
    expect(JSON.parse(beforeFix.stdout)).toMatchObject({
      nativeHostManifest: {
        status: "stale",
        expectedPath: newBinaryPath,
        installedPath: oldBinaryPath,
      },
    });

    const fixed = await runCli(["doctor", "--fix", "--json"], {
      ...baseDependencies(),
      binaryPath: newBinaryPath,
      homeDir,
      platform: "darwin",
    });

    expect(JSON.parse(fixed.stdout)).toMatchObject({
      nativeHostManifest: {
        status: "installed",
      },
    });
    await expect(readFile(darwinManifestPath(homeDir), "utf8")).resolves.toContain(newBinaryPath);
  });

  it("reports and repairs invalid native-host manifest files during doctor", async () => {
    const homeDir = await createTempDir("firefox-cli-home");
    const binaryPath = "/opt/firefox-cli/bin/darwin-arm64/firefox-cli";
    await runCli(["setup", "native-host"], {
      ...baseDependencies(),
      binaryPath,
      homeDir,
      platform: "darwin",
    });
    const manifestPath = darwinManifestPath(homeDir);
    await writeFile(manifestPath, "{");

    const checked = await runCli(["doctor", "--json"], {
      ...baseDependencies(),
      binaryPath,
      homeDir,
      platform: "darwin",
    });
    expect(JSON.parse(checked.stdout)).toMatchObject({
      nativeHostManifest: {
        status: "invalid",
        nextAction: "Run `firefox-cli doctor --fix`.",
      },
    });

    const fixed = await runCli(["doctor", "--fix", "--json"], {
      ...baseDependencies(),
      binaryPath,
      homeDir,
      platform: "darwin",
    });

    expect(JSON.parse(fixed.stdout)).toMatchObject({
      nativeHostManifest: {
        status: "installed",
      },
    });
    await expect(readFile(manifestPath, "utf8")).resolves.toContain(binaryPath);
  });

  it("does not treat wrong-shape or non-canonical native-host manifests as installed", async () => {
    const homeDir = await createTempDir("firefox-cli-home");
    const binaryPath = "/opt/firefox-cli/bin/darwin-arm64/firefox-cli";
    await runCli(["setup", "native-host"], {
      ...baseDependencies(),
      binaryPath,
      homeDir,
      platform: "darwin",
    });
    const manifestPath = darwinManifestPath(homeDir);
    await writeFile(manifestPath, `${JSON.stringify({ path: binaryPath })}\n`);

    const wrongShape = await runCli(["doctor", "--json"], {
      ...baseDependencies(),
      binaryPath,
      homeDir,
      platform: "darwin",
    });
    expect(JSON.parse(wrongShape.stdout)).toMatchObject({
      nativeHostManifest: {
        status: "invalid",
      },
    });

    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          name: "firefox_cli",
          description: "Native messaging host for firefox-cli.",
          path: binaryPath,
          type: "stdio",
          allowed_extensions: ["ff-cli-bridge@respawn.pro"],
          unexpected: true,
        },
        null,
        2,
      )}\n`,
    );
    const extraFields = await runCli(["doctor", "--json"], {
      ...baseDependencies(),
      binaryPath,
      homeDir,
      platform: "darwin",
    });
    expect(JSON.parse(extraFields.stdout)).toMatchObject({
      nativeHostManifest: {
        status: "invalid",
      },
    });

    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          name: "firefox_cli",
          description: "Native messaging host for firefox-cli.",
          path: binaryPath,
          type: "stdio",
          allowed_extensions: ["other@example.invalid"],
        },
        null,
        2,
      )}\n`,
    );
    const stale = await runCli(["doctor", "--json"], {
      ...baseDependencies(),
      binaryPath,
      homeDir,
      platform: "darwin",
    });
    expect(JSON.parse(stale.stdout)).toMatchObject({
      nativeHostManifest: {
        status: "stale",
        installedPath: binaryPath,
        expectedPath: binaryPath,
      },
    });
  });

  it("reports protocol version mismatch with upgrade remediation", async () => {
    const output = await runCli(["doctor"], {
      ...baseDependencies(),
      sendRequest: async (request) =>
        createErrorResponse(request.id, {
          code: "VERSION_MISMATCH",
          message: "Protocol version is not supported.",
        }),
    });

    expect(output.exitCode).toBe(1);
    expect(output.stdout).toContain("Extension connection: version-mismatch");
    expect(output.stdout).toContain("Upgrade/rebuild firefox-cli, the native host, and the extension");
  });

  it("reports pairing mismatches from doctor without treating the extension as disconnected", async () => {
    const output = await runCli(["doctor"], {
      ...baseDependencies(),
      sendRequest: async (request) =>
        createErrorResponse(request.id, {
          code: "PAIRING_MISMATCH",
          message: "Stored pair state is invalid. Run `firefox-cli unpair`.",
        }),
    });

    expect(output.exitCode).toBe(1);
    expect(output.stdout).toContain("Extension connection: pairing-mismatch");
    expect(output.stdout).toContain("Connection next action: Stored pair state is invalid.");
  });

  it("clears pair state on unpair", async () => {
    const unpairCalls: string[] = [];
    const output = await runCli(["unpair"], {
      ...baseDependencies(),
      clearPairState: async () => {
        unpairCalls.push("cleared");
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "Pair state cleared. Approve firefox-cli again from the extension popup.\n",
      stderr: "",
    });
    expect(unpairCalls).toEqual(["cleared"]);
  });
});

function darwinManifestPath(homeDir: string): string {
  return posix.join(homeDir, "Library/Application Support/Mozilla/NativeMessagingHosts/firefox_cli.json");
}
