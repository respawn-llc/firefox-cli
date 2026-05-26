import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { createErrorResponse, createOkResponse, kernelCapabilities } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { runCli, type CliDependencies } from "./index.js";

describe("runCli", () => {
  it("prints capabilities returned by the native host", async () => {
    const output = await runCli(["capabilities", "--json"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        if (request.command === "capabilities") {
          return createOkResponse(request, { capabilities: [...kernelCapabilities] });
        }

        return createErrorResponse(request.id, {
          code: "UNKNOWN_COMMAND",
          message: "Unexpected test command.",
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify({ capabilities: [...kernelCapabilities] }, null, 2)}\n`,
      stderr: "",
    });
  });

  it("maps not-approved capability responses to actionable CLI output", async () => {
    const output = await runCli(["capabilities"], {
      ...baseDependencies(),
      sendRequest: async (request) =>
        createErrorResponse(request.id, {
          code: "NOT_APPROVED",
          message: "Approve firefox-cli in the extension popup before running CLI commands.",
        }),
    });

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        "Not approved: Approve firefox-cli in the extension popup before running CLI commands.\n",
    });
  });

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
    expect(output.stdout).toContain(
      join(homeDir, "Library/Application Support/Mozilla/NativeMessagingHosts/firefox_cli.json"),
    );
    await expect(
      readFile(
        join(homeDir, "Library/Application Support/Mozilla/NativeMessagingHosts/firefox_cli.json"),
        "utf8",
      ),
    ).resolves.toContain(binaryPath);
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

  it("prints setup native-host dry-run JSON without writing the manifest", async () => {
    const homeDir = await createTempDir("firefox-cli-home");
    const binaryPath = "/opt/firefox-cli/bin/darwin-arm64/firefox-cli";
    const output = await runCli(["setup", "native-host", "--dry-run", "--json"], {
      ...baseDependencies(),
      binaryPath,
      homeDir,
      platform: "darwin",
    });
    const parsed = JSON.parse(output.stdout) as {
      readonly manifestPath: string;
      readonly manifest: { readonly path: string };
    };

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
    await expect(
      readFile(
        join(homeDir, "Library/Application Support/Mozilla/NativeMessagingHosts/firefox_cli.json"),
        "utf8",
      ),
    ).resolves.toContain(binaryPath);
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
    await expect(
      readFile(
        join(homeDir, "Library/Application Support/Mozilla/NativeMessagingHosts/firefox_cli.json"),
        "utf8",
      ),
    ).resolves.toContain(newBinaryPath);
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
    expect(output.stdout).toContain(
      "Upgrade/rebuild firefox-cli, the native host, and the extension",
    );
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

  it("lists Firefox tabs as JSON", async () => {
    const output = await runCli(["tab", "--json"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        if (request.command === "tabs.list") {
          return createOkResponse(request, {
            tabs: [
              {
                id: 42,
                index: 0,
                active: true,
                title: "Example",
                url: "https://example.com/",
                windowId: 7,
              },
            ],
          });
        }

        return createErrorResponse(request.id, {
          code: "UNKNOWN_COMMAND",
          message: "Unexpected test command.",
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify(
        {
          tabs: [
            {
              id: 42,
              index: 0,
              active: true,
              title: "Example",
              url: "https://example.com/",
              windowId: 7,
            },
          ],
        },
        null,
        2,
      )}\n`,
      stderr: "",
    });
  });

  it("lists Firefox tabs in compact text output", async () => {
    const output = await runCli(["tab"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        if (request.command === "tabs.list") {
          return createOkResponse(request, {
            tabs: [
              {
                id: 42,
                index: 0,
                active: true,
                title: "Example",
                url: "https://example.com/",
                windowId: 7,
              },
            ],
          });
        }

        return createErrorResponse(request.id, {
          code: "UNKNOWN_COMMAND",
          message: "Unexpected test command.",
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "* w7 t42 [0] Example https://example.com/\n",
      stderr: "",
    });
  });

  it("opens URLs with explicit new-tab navigation parameters", async () => {
    const output = await runCli(["open", "--new-tab", "example.com", "--json"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "open",
          params: {
            url: "https://example.com",
            newTab: true,
          },
        });
        return {
          protocolVersion: request.protocolVersion,
          id: request.id,
          ok: true,
          result: {
            target: targetSummary(),
            url: "https://example.com",
            loadState: "unknown",
          },
        };
      },
    });

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({
      target: {
        tabId: 42,
      },
    });
  });

  it("selects tabs by human index in CLI target syntax", async () => {
    const output = await runCli(["tab", "select", "0"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "tab.select",
          params: {
            target: {
              tab: { kind: "index", index: 0 },
            },
          },
        });
        return {
          protocolVersion: request.protocolVersion,
          id: request.id,
          ok: true,
          result: {
            target: targetSummary(),
          },
        };
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "w7 t42 [0] Example https://example.com/\n",
      stderr: "",
    });
  });

  it("rejects malformed target prefixes instead of silently retargeting", async () => {
    const output = await runCli(["tab", "close", "typo:0"], baseDependencies());

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid target prefix: typo\n",
    });
  });

  it("lists Firefox windows in compact text output", async () => {
    const output = await runCli(["window"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        if (request.command === "windows.list") {
          return createOkResponse(request, {
            windows: [
              {
                id: 7,
                index: 0,
                focused: true,
                activeTabId: 42,
                tabCount: 2,
              },
            ],
          });
        }

        return createErrorResponse(request.id, {
          code: "UNKNOWN_COMMAND",
          message: "Unexpected test command.",
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "* w7 [0] tabs=2 active=t42\n",
      stderr: "",
    });
  });

  it("requests an interactive scoped snapshot and prints text output", async () => {
    const output = await runCli(["snapshot", "-i", "-d", "3", "-s", "#main"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "snapshot",
          params: {
            interactiveOnly: true,
            compact: true,
            maxDepth: 3,
            selector: "#main",
          },
        });
        return createOkResponse(request, {
          generationId: "g1",
          text: '@e1 button "Submit"',
          refs: 1,
          truncated: false,
          frames: [],
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: '@e1 button "Submit"\n',
      stderr: "",
    });
  });

  it("prints snapshot JSON output with target metadata", async () => {
    const output = await runCli(["snapshot", "--json", "--tab", "id:42"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "snapshot",
          params: {
            target: {
              tab: { kind: "id", id: 42 },
            },
          },
        });
        return createOkResponse(request, {
          target: targetSummary(),
          generationId: "g1",
          text: '@e1 link "Example"',
          refs: 1,
          truncated: false,
          frames: [],
        });
      },
    });

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({
      target: { tabId: 42 },
      generationId: "g1",
      refs: 1,
    });
  });

  it("maps script injection failures to actionable snapshot output", async () => {
    const output = await runCli(["snapshot"], {
      ...baseDependencies(),
      sendRequest: async (request) =>
        createErrorResponse(request.id, {
          code: "SCRIPT_INJECTION_FAILED",
          message: "Cannot inject firefox-cli into this tab.",
        }),
    });

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        "SCRIPT_INJECTION_FAILED: Cannot inject firefox-cli into this tab. Try a normal web page tab and reload it after updating the extension.\n",
    });
  });

  it("resolves snapshot refs with optional generation IDs", async () => {
    const output = await runCli(["ref", "@e1", "--generation", "g1", "--tab", "id:42"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "ref.resolve",
          params: {
            ref: "@e1",
            generationId: "g1",
            target: {
              tab: { kind: "id", id: 42 },
            },
          },
        });
        return createOkResponse(request, {
          target: targetSummary(),
          element: {
            ref: "@e1",
            generationId: "g1",
            tagName: "button",
            role: "button",
            name: "Save",
            text: "Save",
            visible: true,
          },
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "@e1 button Save (g1)\n",
      stderr: "",
    });
  });

  it("prints help for unknown commands", async () => {
    const output = await runCli(["missing"], baseDependencies());

    expect(output.exitCode).toBe(1);
    expect(output.stdout).toContain("Usage:");
  });
});

function baseDependencies(): CliDependencies {
  return {
    version: "0.0.0",
    platform: "darwin",
    arch: "arm64",
    homeDir: "/Users/tester",
    binaryPath: "/opt/firefox-cli/bin/darwin-arm64/firefox-cli",
    extensionPath: "/opt/firefox-cli/extension/development",
    packageRoot: "/opt/firefox-cli",
    sendRequest: async (request) =>
      createErrorResponse(request.id, {
        code: "NATIVE_HOST_UNAVAILABLE",
        message: "firefox-cli native host is not running.",
      }),
    clearPairState: async () => undefined,
  };
}

function targetSummary() {
  return {
    windowId: 7,
    windowIndex: 0,
    tabId: 42,
    tabIndex: 0,
    title: "Example",
    url: "https://example.com/",
  };
}
