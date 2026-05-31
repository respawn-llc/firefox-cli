import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_BYTES,
  PROTOCOL_VERSION,
  createErrorResponse,
  createOkResponse,
  gatedCapabilities,
  kernelCapabilities,
  type CommandId,
  type RequestEnvelope,
  type ResponseEnvelope,
  type WaitResult,
} from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { runCli, type CliDependencies } from "./index.js";

describe("runCli", () => {
  it("rejects unsupported route options before sending requests", async () => {
    const cases: readonly { readonly argv: readonly string[]; readonly stderr: string }[] = [
      { argv: ["tab", "--bogus"], stderr: "Unsupported tab option: --bogus\n" },
      { argv: ["open", "example.com", "--bogus"], stderr: "Unsupported open option: --bogus\n" },
      { argv: ["snapshot", "--bogus"], stderr: "Unsupported snapshot option: --bogus\n" },
      { argv: ["get", "title", "--bogus"], stderr: "Unsupported get option: --bogus\n" },
      { argv: ["wait", "--bogus"], stderr: "Unsupported wait option: --bogus\n" },
      { argv: ["eval", "--bogus", "1"], stderr: "Unsupported eval option: --bogus\n" },
      { argv: ["screenshot", "--bogus"], stderr: "Unsupported screenshot option: --bogus\n" },
      { argv: ["find", "text", "Ready", "--bogus"], stderr: "Unsupported find option: --bogus\n" },
      { argv: ["frame", "--frame", "0"], stderr: "Unsupported frame option: --frame\n" },
      { argv: ["upload", "--bogus"], stderr: "Unsupported upload option: --bogus\n" },
      { argv: ["fill", "#email", "text", "--bogus"], stderr: "Unsupported fill option: --bogus\n" },
      {
        argv: ["keyboard", "type", "text", "--bogus"],
        stderr: "Unsupported keyboard option: --bogus\n",
      },
      { argv: ["batch", "[]", "--bogus"], stderr: "Unsupported batch option: --bogus\n" },
    ];

    for (const testCase of cases) {
      await expect(
        runCli(testCase.argv, {
          ...baseDependencies(),
          sendRequest: async () => {
            throw new Error(`Unexpected request for ${testCase.argv.join(" ")}`);
          },
        }),
      ).resolves.toEqual({
        exitCode: 1,
        stdout: "",
        stderr: testCase.stderr,
      });
    }
  });

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

  it("validates injected transport response payloads before formatting", async () => {
    const output = await runCli(["capabilities"], {
      ...baseDependencies(),
      sendRequest: async (request) => ({
        protocolVersion: request.protocolVersion,
        id: request.id,
        ok: true,
        result: { capabilities: "not an array" },
      }),
    });

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "INVALID_RESPONSE: Command result is invalid.\n",
    });
  });

  it("surfaces injected transport protocol version mismatches", async () => {
    const output = await runCli(["capabilities"], {
      ...baseDependencies(),
      sendRequest: async (request) => ({
        protocolVersion: PROTOCOL_VERSION + 1,
        id: request.id,
        ok: false,
        error: {
          code: "UNKNOWN_COMMAND",
          message: "wrong protocol",
        },
      }),
    });

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        "Version mismatch: Protocol version is not supported.. Upgrade/rebuild firefox-cli, the native host, and the extension.\n",
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

  it("prefers packaged signed extension path in setup guidance", async () => {
    const packageRoot = await createTempDir("firefox-cli-package");
    await mkdir(join(packageRoot, "extension"), { recursive: true });
    await writeFile(join(packageRoot, "extension/firefox-cli.xpi"), "signed xpi\n");
    const { extensionPath: _extensionPath, ...dependencies } = baseDependencies();

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
    expect(textOutput.stdout).toContain(
      `Extension: install ${join(packageRoot, "extension/firefox-cli.xpi")} in Firefox.`,
    );
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

  it("reports and repairs invalid native-host manifest files during doctor", async () => {
    const homeDir = await createTempDir("firefox-cli-home");
    const binaryPath = "/opt/firefox-cli/bin/darwin-arm64/firefox-cli";
    await runCli(["setup", "native-host"], {
      ...baseDependencies(),
      binaryPath,
      homeDir,
      platform: "darwin",
    });
    const manifestPath = join(
      homeDir,
      "Library/Application Support/Mozilla/NativeMessagingHosts/firefox_cli.json",
    );
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
    const manifestPath = join(
      homeDir,
      "Library/Application Support/Mozilla/NativeMessagingHosts/firefox_cli.json",
    );
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
          allowed_extensions: ["firefox-cli@example.invalid"],
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
    expect(output.stdout).toContain(
      "Upgrade/rebuild firefox-cli, the native host, and the extension",
    );
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

  it("rejects missing target flag values before sending requests", async () => {
    const cwd = await createTempDir("firefox-cli-target-flags");
    await writeFile(join(cwd, "fixture.txt"), "upload body");
    const cases: readonly {
      readonly name: string;
      readonly argv: readonly string[];
    }[] = [
      { name: "tab close", argv: ["tab", "close"] },
      { name: "window close", argv: ["window", "close"] },
      { name: "open", argv: ["open", "example.com"] },
      { name: "back", argv: ["back"] },
      { name: "forward", argv: ["forward"] },
      { name: "reload", argv: ["reload"] },
      { name: "snapshot", argv: ["snapshot"] },
      { name: "ref", argv: ["ref", "@e1"] },
      { name: "get", argv: ["get", "title"] },
      { name: "is", argv: ["is", "visible", "#main"] },
      { name: "wait", argv: ["wait", "#main"] },
      { name: "eval", argv: ["eval", "document.title"] },
      { name: "screenshot", argv: ["screenshot", "page.png"] },
      { name: "drag", argv: ["drag", "#source", "#target"] },
      { name: "upload", argv: ["upload", "#file", "fixture.txt"] },
      { name: "mouse", argv: ["mouse", "wheel", "#feed"] },
      { name: "keydown", argv: ["keydown", "A"] },
      { name: "keyup", argv: ["keyup", "A"] },
      { name: "find", argv: ["find", "text", "Ready"] },
      { name: "frame", argv: ["frame"] },
      { name: "dialog", argv: ["dialog", "status"] },
      { name: "clipboard", argv: ["clipboard", "copy", "#copy"] },
      { name: "storage", argv: ["storage", "local", "set", "phase", "8"] },
      { name: "console", argv: ["console", "list"] },
      { name: "errors", argv: ["errors", "clear"] },
      { name: "highlight", argv: ["highlight", "#save"] },
      { name: "pdf", argv: ["pdf", "page.pdf"] },
      { name: "set viewport", argv: ["set", "viewport", "1200", "800"] },
      { name: "diff", argv: ["diff", "title", "Expected title"] },
      { name: "batch", argv: ["batch", JSON.stringify([{ command: "snapshot", params: {} }])] },
      { name: "element action", argv: ["click", "#save"] },
      { name: "fill", argv: ["fill", "#name", "Nikita"] },
      { name: "type", argv: ["type", "#name", "Nikita"] },
      { name: "press", argv: ["press", "Enter"] },
      { name: "keyboard", argv: ["keyboard", "type", "hello"] },
      { name: "select", argv: ["select", "#plan", "pro"] },
      { name: "scroll", argv: ["scroll", "down"] },
      { name: "swipe", argv: ["swipe", "left"] },
    ];
    const flags = ["--tab", "--window"] as const;

    for (const flag of flags) {
      for (const testCase of cases) {
        await expect(
          runCli([...testCase.argv, flag], {
            ...baseDependencies(),
            cwd,
            sendRequest: async () => {
              throw new Error(`Unexpected request for ${testCase.name} ${flag}`);
            },
          }),
        ).resolves.toEqual({
          exitCode: 1,
          stdout: "",
          stderr: `Missing value for ${flag}.\n`,
        });
      }
    }

    await expect(
      runCli(["select", "#plan", "pro", "--tab", "--json"], {
        ...baseDependencies(),
        sendRequest: async () => {
          throw new Error("Unexpected request for select --tab --json");
        },
      }),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing value for --tab.\n",
    });
  });

  it("accepts explicit active target flag values", async () => {
    const tabOutput = await runCli(["tab", "close", "--tab", "active"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "tab.close",
          params: {
            target: {
              tab: { kind: "active" },
            },
          },
        });
        return createOkResponse(request, { closedTabId: 42 });
      },
    });
    const windowOutput = await runCli(["window", "close", "--window", "active"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "window.close",
          params: {
            target: {
              window: { kind: "active" },
            },
          },
        });
        return createOkResponse(request, { closedWindowId: 7 });
      },
    });
    const clickOutput = await runCli(["click", "#save", "--tab", "active"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "click",
          params: {
            selector: "#save",
            target: {
              tab: { kind: "active" },
            },
          },
        });
        return createOkResponse(request, {
          action: "click",
          ok: true,
          element: actionElement("button", "Save"),
        });
      },
    });

    expect(tabOutput).toEqual({
      exitCode: 0,
      stdout: "Closed tab 42\n",
      stderr: "",
    });
    expect(windowOutput).toEqual({
      exitCode: 0,
      stdout: "Closed window 7\n",
      stderr: "",
    });
    expect(clickOutput).toEqual({
      exitCode: 0,
      stdout: "click ok button Save\n",
      stderr: "",
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

  it("gets a tab title without an element target", async () => {
    const output = await runCli(["get", "title", "--tab", "id:42"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "get",
          params: {
            kind: "title",
            target: {
              tab: { kind: "id", id: 42 },
            },
          },
        });
        return createOkResponse(request, {
          target: targetSummary(),
          kind: "title",
          value: "Example",
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "Example\n",
      stderr: "",
    });
  });

  it("rejects element positionals for tab-level getters", async () => {
    const output = await runCli(["get", "title", "#main"], baseDependencies());

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "get title does not accept a selector or ref.\n",
    });
  });

  it("gets element text by selector as JSON", async () => {
    const output = await runCli(["get", "text", "#main", "--max-output", "1000", "--json"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "get",
          params: {
            kind: "text",
            selector: "#main",
            maxOutputBytes: 1000,
          },
        });
        return createOkResponse(request, {
          target: targetSummary(),
          kind: "text",
          value: "Hello",
          truncated: false,
        });
      },
    });

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({
      kind: "text",
      value: "Hello",
      truncated: false,
    });
  });

  it("gets an attribute by snapshot ref with optional generation ID", async () => {
    const output = await runCli(["get", "attr", "@e1", "href", "--generation", "g1"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "get",
          params: {
            kind: "attr",
            ref: "@e1",
            generationId: "g1",
            attribute: "href",
          },
        });
        return createOkResponse(request, {
          kind: "attr",
          value: "/docs",
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "/docs\n",
      stderr: "",
    });
  });

  it("rejects attr getters without an attribute name at the CLI boundary", async () => {
    const output = await runCli(["get", "attr", "a"], baseDependencies());

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing attribute name.\n",
    });
  });

  it("rejects malformed get refs instead of treating them as selectors", async () => {
    const output = await runCli(["get", "text", "@e0"], baseDependencies());

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid ref: @e0\n",
    });
  });

  it("checks element state by selector and prints booleans", async () => {
    const output = await runCli(["is", "visible", "#main"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "is",
          params: {
            kind: "visible",
            selector: "#main",
          },
        });
        return createOkResponse(request, {
          kind: "visible",
          value: true,
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "true\n",
      stderr: "",
    });
  });

  it("checks element state by ref with optional generation IDs", async () => {
    const output = await runCli(["is", "checked", "@e1", "--generation", "g1", "--json"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "is",
          params: {
            kind: "checked",
            ref: "@e1",
            generationId: "g1",
          },
        });
        return createOkResponse(request, {
          kind: "checked",
          value: false,
        });
      },
    });

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual({
      kind: "checked",
      value: false,
    });
  });

  it("rejects invalid is kinds and malformed refs at the CLI boundary", async () => {
    await expect(runCli(["is", "editable", "#main"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing or invalid is kind.\n",
    });
    await expect(runCli(["is", "visible", "@e0"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid ref: @e0\n",
    });
  });

  it("waits for a duration through the protocol path", async () => {
    const output = await runCli(["wait", "250"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "wait",
          params: {
            kind: "ms",
            durationMs: 250,
          },
        });
        return createOkResponse(request, {
          kind: "ms",
          matched: true,
          elapsedMs: 250,
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "matched in 250ms\n",
      stderr: "",
    });
  });

  it("waits for element state by selector or ref with timing options", async () => {
    const output = await runCli(
      [
        "wait",
        "@e1",
        "--generation",
        "g1",
        "--state",
        "hidden",
        "--timeout",
        "2000",
        "--interval",
        "50",
        "--tab",
        "id:42",
        "--json",
      ],
      {
        ...baseDependencies(),
        sendRequest: async (request) => {
          expect(request).toMatchObject({
            command: "wait",
            params: {
              kind: "element",
              ref: "@e1",
              generationId: "g1",
              state: "hidden",
              timeoutMs: 2000,
              intervalMs: 50,
              target: {
                tab: { kind: "id", id: 42 },
              },
            },
          });
          return createOkResponse(request, {
            kind: "element",
            matched: true,
            elapsedMs: 12,
          });
        },
      },
    );

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual({
      kind: "element",
      matched: true,
      elapsedMs: 12,
    });
  });

  it("waits for text, URL, function predicates, and document load state", async () => {
    const cases: readonly {
      readonly args: readonly string[];
      readonly params: Record<string, unknown>;
      readonly result: WaitResult;
      readonly stdout: string;
    }[] = [
      {
        args: ["wait", "--text", "Ready"],
        params: { kind: "text", text: "Ready" },
        result: { kind: "text", matched: true, elapsedMs: 3, value: "Ready" },
        stdout: "Ready in 3ms\n",
      },
      {
        args: ["wait", "--url", "https://example.test/*"],
        params: { kind: "url", urlGlob: "https://example.test/*" },
        result: { kind: "url", matched: true, elapsedMs: 4, value: "https://example.test/app" },
        stdout: "https://example.test/app in 4ms\n",
      },
      {
        args: ["wait", "--fn", "document.readyState === 'complete'"],
        params: { kind: "function", expression: "document.readyState === 'complete'" },
        result: { kind: "function", matched: true, elapsedMs: 5, value: true },
        stdout: "true in 5ms\n",
      },
      {
        args: ["wait", "--load", "complete"],
        params: { kind: "load-state", state: "complete" },
        result: { kind: "load-state", matched: true, elapsedMs: 6 },
        stdout: "matched in 6ms\n",
      },
      {
        args: ["wait", "--load", "networkidle"],
        params: { kind: "load-state", state: "networkidle" },
        result: { kind: "load-state", matched: true, elapsedMs: 7 },
        stdout: "matched in 7ms\n",
      },
      {
        args: ["wait", "--download", "file.zip"],
        params: { kind: "download", filenameGlob: "file.zip" },
        result: {
          kind: "download",
          matched: true,
          elapsedMs: 8,
          download: { id: 9, filename: "file.zip", state: "complete" },
        },
        stdout: "download 9 complete in 8ms\n",
      },
    ];

    for (const testCase of cases) {
      const output = await runCli(testCase.args, {
        ...baseDependencies(),
        sendRequest: async (request) => {
          expect(request).toMatchObject({
            command: "wait",
            params: testCase.params,
          });
          return createOkResponse(request as RequestEnvelope<"wait">, testCase.result);
        },
      });

      expect(output).toEqual({
        exitCode: 0,
        stdout: testCase.stdout,
        stderr: "",
      });
    }
  });

  it("rejects malformed wait arguments at the CLI boundary", async () => {
    await expect(runCli(["wait"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing wait target or condition.\n",
    });
    await expect(
      runCli(["wait", "#main", "--state", "complete"], baseDependencies()),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid wait state: complete\n",
    });
    await expect(runCli(["wait", "@e0"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid ref: @e0\n",
    });
    await expect(
      runCli(["wait", "--text", "Ready", "--generation", "g1"], baseDependencies()),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Only element waits accept --generation.\n",
    });
    await expect(
      runCli(["wait", "--text", "Ready", "--state"], baseDependencies()),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing value for --state.\n",
    });
    await expect(runCli(["wait", "--text", "--json"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing value for --text.\n",
    });
    await expect(
      runCli(["wait", "--text", "Ready", "--new-tab"], baseDependencies()),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Unsupported wait option: --new-tab\n",
    });
    await expect(runCli(["wait", "--timeout", "0", "#main"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid timeout: 0\n",
    });
  });

  it("runs eval from argv with target, timeout, and result-size options", async () => {
    const output = await runCli(
      [
        "eval",
        "document.title",
        "--timeout",
        "1000",
        "--max-output",
        "2000",
        "--tab",
        "id:42",
        "--json",
      ],
      {
        ...baseDependencies(),
        sendRequest: async (request) => {
          expect(request).toMatchObject({
            command: "eval",
            params: {
              script: "document.title",
              source: "argv",
              timeoutMs: 1000,
              maxResultBytes: 2000,
              target: {
                tab: { kind: "id", id: 42 },
              },
            },
          });
          return createOkResponse(request, {
            target: targetSummary(),
            value: {
              type: "json",
              value: "Example",
            },
            elapsedMs: 2,
          });
        },
      },
    );

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({
      value: {
        type: "json",
        value: "Example",
      },
    });
  });

  it("runs eval from stdin, base64, and option-like argv scripts", async () => {
    const stdin = await runCli(["eval", "--stdin"], {
      ...baseDependencies(),
      readStdin: async () => "return 42;",
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "eval",
          params: {
            script: "return 42;",
            source: "stdin",
          },
        });
        return createOkResponse(request, {
          value: {
            type: "json",
            value: 42,
          },
          elapsedMs: 1,
        });
      },
    });
    expect(stdin).toEqual({
      exitCode: 0,
      stdout: "42\n",
      stderr: "",
    });

    const base64 = await runCli(
      ["eval", "-b", Buffer.from("const value = 1;").toString("base64")],
      {
        ...baseDependencies(),
        sendRequest: async (request) => {
          expect(request).toMatchObject({
            command: "eval",
            params: {
              script: "const value = 1;",
              source: "base64",
            },
          });
          return createOkResponse(request, {
            value: {
              type: "undefined",
            },
            elapsedMs: 1,
          });
        },
      },
    );
    expect(base64).toEqual({
      exitCode: 0,
      stdout: "undefined\n",
      stderr: "",
    });

    const optionLike = await runCli(["eval", "--", "--window"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "eval",
          params: {
            script: "--window",
            source: "argv",
          },
        });
        return createOkResponse(request, {
          value: {
            type: "json",
            value: "--window",
          },
          elapsedMs: 1,
        });
      },
    });
    expect(optionLike).toEqual({
      exitCode: 0,
      stdout: "--window\n",
      stderr: "",
    });
  });

  it("rejects malformed eval arguments at the CLI boundary", async () => {
    await expect(runCli(["eval"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Specify exactly one eval source.\n",
    });
    await expect(
      runCli(["eval", "1", "--stdin"], {
        ...baseDependencies(),
        readStdin: async () => "2",
      }),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Specify exactly one eval source.\n",
    });
    await expect(
      runCli(["eval", "--stdin"], {
        ...baseDependencies(),
        readStdin: async () => "",
      }),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Eval script is empty.\n",
    });
    await expect(runCli(["eval", "-b", "not_base64!"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid base64 eval script.\n",
    });
    await expect(runCli(["eval", "--timeout", "0", "1"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid timeout: 0\n",
    });
    await expect(runCli(["eval", "--new-tab", "1"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Unsupported eval option: --new-tab\n",
    });
  });

  it("captures visible screenshots to an absolute path", async () => {
    const output = await runCli(
      ["screenshot", "page.png", "--timeout", "1000", "--max-output", "2000", "--tab", "id:42"],
      {
        ...baseDependencies(),
        cwd: "/work",
        sendRequest: async (request) => {
          expect(request).toMatchObject({
            command: "screenshot",
            params: {
              path: "/work/page.png",
              format: "png",
              timeoutMs: 1000,
              maxImageBytes: 2000,
              target: {
                tab: { kind: "id", id: 42 },
              },
            },
          });
          return createOkResponse(request, {
            target: targetSummary(),
            path: "/work/page.png",
            format: "png",
            bytes: 68,
            width: 1,
            height: 1,
            activation: {
              tabActivated: false,
              windowFocused: false,
            },
          });
        },
      },
    );

    expect(output).toEqual({
      exitCode: 0,
      stdout: "/work/page.png 68 bytes 1x1\n",
      stderr: "",
    });
  });

  it("captures screenshots with the default output path and JSON output", async () => {
    const output = await runCli(["screenshot", "--json"], {
      ...baseDependencies(),
      cwd: "/work",
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "screenshot",
          params: {
            path: "/work/screenshot.png",
            format: "png",
          },
        });
        return createOkResponse(request, {
          path: "/work/screenshot.png",
          format: "png",
          bytes: 68,
          activation: {
            tabActivated: true,
            windowFocused: false,
          },
        });
      },
    });

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual({
      path: "/work/screenshot.png",
      format: "png",
      bytes: 68,
      activation: {
        tabActivated: true,
        windowFocused: false,
      },
    });
  });

  it("sends screenshot format, full-page, and quality options through the protocol", async () => {
    const output = await runCli(
      ["screenshot", "page.jpg", "--full", "--format", "jpeg", "--screenshot-quality", "80"],
      {
        ...baseDependencies(),
        cwd: "/work",
        sendRequest: async (request) => {
          expect(request).toMatchObject({
            command: "screenshot",
            params: {
              path: "/work/page.jpg",
              format: "jpeg",
              fullPage: true,
              quality: 80,
            },
          });
          return createOkResponse(request, {
            path: "/work/page.jpg",
            format: "jpeg",
            bytes: 128,
            activation: {
              tabActivated: false,
              windowFocused: false,
            },
          });
        },
      },
    );

    expect(output).toEqual({
      exitCode: 0,
      stdout: "/work/page.jpg 128 bytes\n",
      stderr: "",
    });
  });

  it("runs batch command objects with bail, target, timeout, and result limits", async () => {
    const output = await runCli(
      [
        "batch",
        JSON.stringify([
          { command: "snapshot", params: { interactiveOnly: true } },
          { command: "click", params: { selector: "button" } },
        ]),
        "--bail",
        "--timeout",
        "1000",
        "--max-output",
        "2000",
        "--tab",
        "id:42",
      ],
      {
        ...baseDependencies(),
        sendRequest: async (request) => {
          expect(request).toMatchObject({
            command: "batch",
            params: {
              bail: true,
              timeoutMs: 1000,
              maxResultBytes: 2000,
              target: {
                tab: { kind: "id", id: 42 },
              },
              steps: [
                { command: "snapshot", params: { interactiveOnly: true } },
                { command: "click", params: { selector: "button" } },
              ],
            },
          });
          return createOkResponse(request, {
            ok: true,
            steps: [
              {
                index: 0,
                command: "snapshot",
                ok: true,
                result: { text: "", generationId: "g1", refs: 0, truncated: false, frames: [] },
              },
              {
                index: 1,
                command: "click",
                ok: true,
                result: { action: "click", ok: true, element: actionElement("button", "Save") },
              },
            ],
            elapsedMs: 7,
          });
        },
      },
    );

    expect(output).toEqual({
      exitCode: 0,
      stdout: "0 snapshot ok\n1 click ok\nbatch ok in 7ms\n",
      stderr: "",
    });
  });

  it("runs batch argv steps from stdin and returns failed-step exit codes", async () => {
    const output = await runCli(["batch", "--stdin", "--json"], {
      ...baseDependencies(),
      readStdin: async () =>
        JSON.stringify([
          ["snapshot", "-i"],
          ["click", "@e1"],
        ]),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "batch",
          params: {
            steps: [
              { command: "snapshot", params: { interactiveOnly: true } },
              { command: "click", params: { ref: "@e1" } },
            ],
          },
        });
        return createOkResponse(request, {
          ok: false,
          firstFailedIndex: 1,
          steps: [
            {
              index: 0,
              command: "snapshot",
              ok: true,
              result: {
                text: "",
                generationId: "g1",
                refs: 1,
                truncated: false,
                frames: [],
              },
            },
            {
              index: 1,
              command: "click",
              ok: false,
              error: {
                code: "REF_NOT_FOUND",
                message: "Ref expired.",
              },
            },
          ],
          elapsedMs: 9,
        });
      },
    });

    expect(output.exitCode).toBe(1);
    expect(JSON.parse(output.stdout)).toMatchObject({
      ok: false,
      firstFailedIndex: 1,
    });
  });

  it("preserves option-like argv payloads in direct and batch commands", async () => {
    const dialogOutput = await runCli(["dialog", "accept", "--proceed"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "dialog",
          params: { action: "accept", promptText: "--proceed" },
        });
        return createOkResponse(request, { action: "accept", handled: true });
      },
    });
    const clipboardOutput = await runCli(["clipboard", "write", "--token", "--json"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "clipboard",
          params: { action: "write", text: "--token" },
        });
        return createOkResponse(request, { action: "write", ok: true });
      },
    });
    const batchOutput = await runCli(
      ["batch", JSON.stringify([["dialog", "accept", "--proceed"]])],
      {
        ...baseDependencies(),
        sendRequest: async (request) => {
          expect(request).toMatchObject({
            command: "batch",
            params: {
              steps: [{ command: "dialog", params: { action: "accept", promptText: "--proceed" } }],
            },
          });
          return createOkResponse(request, {
            ok: true,
            steps: [
              {
                index: 0,
                command: "dialog",
                ok: true,
                result: { action: "accept", handled: true },
              },
            ],
            elapsedMs: 1,
          });
        },
      },
    );

    expect(dialogOutput).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify({ action: "accept", handled: true })}\n`,
      stderr: "",
    });
    expect(clipboardOutput).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify({ action: "write", ok: true }, null, 2)}\n`,
      stderr: "",
    });
    expect(batchOutput).toEqual({
      exitCode: 0,
      stdout: "0 dialog ok\nbatch ok in 1ms\n",
      stderr: "",
    });
  });

  it("runs batch argv upload steps through a shared upload budget", async () => {
    const output = await runCli(
      [
        "batch",
        JSON.stringify([
          ["upload", "#one", "one.bin"],
          ["upload", "#two", "two.bin"],
        ]),
      ],
      {
        ...baseDependencies(),
        statUploadFile: async () => ({ size: 3, isFile: true }),
        readUploadFile: async (path) => Buffer.from(path.endsWith("one.bin") ? "one" : "two"),
        sendRequest: async (request) => {
          expect(request).toMatchObject({
            command: "batch",
            params: {
              steps: [
                {
                  command: "upload",
                  params: {
                    selector: "#one",
                    files: [{ name: "one.bin", dataBase64: "b25l" }],
                  },
                },
                {
                  command: "upload",
                  params: {
                    selector: "#two",
                    files: [{ name: "two.bin", dataBase64: "dHdv" }],
                  },
                },
              ],
            },
          });
          return createOkResponse(request, {
            ok: true,
            steps: [
              {
                index: 0,
                command: "upload",
                ok: true,
                result: {
                  action: "upload",
                  ok: true,
                  element: actionElement("button", "Upload"),
                  valueLength: 1,
                },
              },
              {
                index: 1,
                command: "upload",
                ok: true,
                result: {
                  action: "upload",
                  ok: true,
                  element: actionElement("button", "Upload"),
                  valueLength: 1,
                },
              },
            ],
            elapsedMs: 4,
          });
        },
      },
    );

    expect(output).toEqual({
      exitCode: 0,
      stdout: "0 upload ok\n1 upload ok\nbatch ok in 4ms\n",
      stderr: "",
    });
  });

  it("preserves batch target locking for argv steps with implicit active targets", async () => {
    const output = await runCli(
      [
        "batch",
        JSON.stringify([
          ["tab", "close"],
          ["tab", "close", "--tab", "id:99"],
        ]),
        "--tab",
        "id:42",
      ],
      {
        ...baseDependencies(),
        sendRequest: async (request) => {
          expect(request).toMatchObject({
            command: "batch",
            params: {
              target: { tab: { kind: "id", id: 42 } },
              steps: [
                { command: "tab.close", params: {} },
                { command: "tab.close", params: { target: { tab: { kind: "id", id: 99 } } } },
              ],
            },
          });
          return createOkResponse(request, {
            ok: true,
            steps: [
              {
                index: 0,
                command: "tab.close",
                ok: true,
                result: { closedTabId: 42 },
              },
              {
                index: 1,
                command: "tab.close",
                ok: true,
                result: { closedTabId: 99 },
              },
            ],
            elapsedMs: 6,
          });
        },
      },
    );

    expect(output.exitCode).toBe(0);
  });

  it("rejects malformed batch arguments at the CLI boundary", async () => {
    await expect(runCli(["batch"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing batch JSON.\n",
    });
    await expect(runCli(["batch", "{"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid batch JSON.\n",
    });
    await expect(runCli(["batch", "[]"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Batch requires at least one step.\n",
    });
    await expect(
      runCli(["batch", JSON.stringify([["setup"]])], baseDependencies()),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid batch argv command at step 0.\n",
    });
    await expect(
      runCli(["batch", JSON.stringify([["eval", "--stdin"]])], baseDependencies()),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Batch argv step 0 cannot read from stdin.\n",
    });
    await expect(
      runCli(["batch", JSON.stringify([["tab", "close", "--tab"]])], baseDependencies()),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid batch argv step 0: Missing value for --tab.\n",
    });
    await expect(
      runCli(["batch", JSON.stringify([{ command: "batch", params: {} }])], baseDependencies()),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid batch command at step 0.\n",
    });
    await expect(
      runCli(
        ["batch", "--timeout", "0", JSON.stringify([{ command: "snapshot", params: {} }])],
        baseDependencies(),
      ),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid timeout: 0\n",
    });
  });

  it("builds matching direct and batch argv requests for shared protocol routes", async () => {
    let directRequest: RequestEnvelope | undefined;
    const directOutput = await runCli(["click", "#save", "--tab", "id:42", "--json"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        directRequest = request;
        return {
          protocolVersion: request.protocolVersion,
          id: request.id,
          ok: true,
          result: { action: "click", ok: true, element: actionElement("button", "Save") },
        };
      },
    });

    let batchRequest: RequestEnvelope<"batch"> | undefined;
    const batchOutput = await runCli(
      ["batch", JSON.stringify([["click", "#save", "--tab", "id:42"]]), "--json"],
      {
        ...baseDependencies(),
        sendRequest: async (request) => {
          batchRequest = request as RequestEnvelope<"batch">;
          return {
            protocolVersion: request.protocolVersion,
            id: request.id,
            ok: true,
            result: { ok: true, elapsedMs: 1, steps: [] },
          };
        },
      },
    );

    expect(directOutput.exitCode).toBe(0);
    expect(batchOutput.exitCode).toBe(0);
    expect(directRequest?.command).toBe("click");
    expect(batchRequest?.params.steps).toEqual([
      { command: directRequest?.command, params: directRequest?.params },
    ]);
  });

  it("rejects malformed screenshot arguments at the CLI boundary", async () => {
    await expect(runCli(["screenshot", "--timeout", "0"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid timeout: 0\n",
    });
    await expect(runCli(["screenshot", "--max-output", "0"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid max output: 0\n",
    });
    await expect(runCli(["screenshot", "--new-tab"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Unsupported screenshot option: --new-tab\n",
    });
    await expect(runCli(["screenshot", "a.png", "b.png"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Specify at most one screenshot path.\n",
    });
    await expect(runCli(["screenshot", "--format", "webp"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Only PNG and JPEG screenshots are supported.\n",
    });
  });

  it("rejects protocol schema overflow values before direct requests are sent", async () => {
    const cases: readonly (readonly string[])[] = [
      ["eval", "1 + 1", "--timeout", "600001"],
      ["eval", "1 + 1", "--max-output", "900001"],
      ["screenshot", "--format", "jpeg", "--screenshot-quality", "101"],
      ["screenshot", "--timeout", "600001"],
      ["screenshot", "--max-output", "8000001"],
      ["snapshot", "--depth", "51"],
      ["snapshot", "--max-output", "1000001"],
      ["set", "viewport", "10001", "100"],
      ["scroll", "down", "100001"],
    ];

    for (const argv of cases) {
      let requestCalls = 0;
      const output = await runCli(argv, {
        ...baseDependencies(),
        sendRequest: async () => {
          requestCalls += 1;
          throw new Error(`Unexpected request for invalid argv: ${argv.join(" ")}`);
        },
      });

      expect(output.exitCode, argv.join(" ")).toBe(1);
      expect(output.stderr, argv.join(" ")).toContain("Invalid ");
      expect(requestCalls, argv.join(" ")).toBe(0);
    }
  });

  it("rejects protocol schema overflow values before batch argv requests are sent", async () => {
    const cases: readonly (readonly string[])[] = [
      ["eval", "1 + 1", "--timeout", "600001"],
      ["eval", "1 + 1", "--max-output", "900001"],
      ["screenshot", "--format", "jpeg", "--screenshot-quality", "101"],
      ["screenshot", "--timeout", "600001"],
      ["snapshot", "--depth", "51"],
      ["set", "viewport", "10001", "100"],
      ["scroll", "down", "100001"],
    ];

    for (const step of cases) {
      let requestCalls = 0;
      const output = await runCli(["batch", JSON.stringify([step])], {
        ...baseDependencies(),
        sendRequest: async () => {
          requestCalls += 1;
          throw new Error(`Unexpected request for invalid batch step: ${step.join(" ")}`);
        },
      });

      expect(output.exitCode, step.join(" ")).toBe(1);
      expect(output.stderr, step.join(" ")).toContain("Invalid batch argv step 0: Invalid ");
      expect(requestCalls, step.join(" ")).toBe(0);
    }
  });

  it("runs element actions by selector and ref", async () => {
    const output = await runCli(["click", "button.primary"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "click",
          params: {
            selector: "button.primary",
          },
        });
        return createOkResponse(request, {
          action: "click",
          ok: true,
          element: {
            tagName: "button",
            role: "button",
            visible: true,
            name: "Save",
          },
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "click ok button Save\n",
      stderr: "",
    });

    const checked = await runCli(["check", "@e1", "--generation", "g1", "--json"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "check",
          params: {
            ref: "@e1",
            generationId: "g1",
          },
        });
        return createOkResponse(request, {
          action: "check",
          ok: true,
          element: actionElement("checkbox", "Accept terms"),
        });
      },
    });

    expect(checked.exitCode).toBe(0);
    expect(JSON.parse(checked.stdout)).toEqual({
      action: "check",
      ok: true,
      element: actionElement("checkbox", "Accept terms"),
    });
  });

  it("runs text, keyboard, selection, and scroll interactions", async () => {
    const cases: readonly {
      readonly args: readonly string[];
      readonly command: string;
      readonly params: Record<string, unknown>;
      readonly result: Record<string, unknown>;
      readonly stdout: string;
    }[] = [
      {
        args: ["fill", "#email", "user@example.test"],
        command: "fill",
        params: { selector: "#email", text: "user@example.test" },
        result: {
          action: "fill",
          ok: true,
          element: actionElement("textbox", "Email"),
          valueLength: 17,
        },
        stdout: "fill ok textbox Email valueLength=17\n",
      },
      {
        args: ["fill", "#token", "--abc"],
        command: "fill",
        params: { selector: "#token", text: "--abc" },
        result: {
          action: "fill",
          ok: true,
          element: actionElement("textbox", "Token"),
          valueLength: 5,
        },
        stdout: "fill ok textbox Token valueLength=5\n",
      },
      {
        args: ["fill", "#token", "--window"],
        command: "fill",
        params: { selector: "#token", text: "--window" },
        result: {
          action: "fill",
          ok: true,
          element: actionElement("textbox", "Token"),
          valueLength: 8,
        },
        stdout: "fill ok textbox Token valueLength=8\n",
      },
      {
        args: ["type", "#name", "Nikita"],
        command: "type",
        params: { selector: "#name", text: "Nikita" },
        result: {
          action: "type",
          ok: true,
          element: actionElement("textbox", "Name"),
          valueLength: 6,
        },
        stdout: "type ok textbox Name valueLength=6\n",
      },
      {
        args: ["keyboard", "type", "hello"],
        command: "keyboard.type",
        params: { text: "hello" },
        result: {
          action: "keyboard.type",
          ok: true,
          element: actionElement("textbox", "Active"),
          valueLength: 5,
        },
        stdout: "keyboard.type ok textbox Active valueLength=5\n",
      },
      {
        args: ["keyboard", "type", "--abc"],
        command: "keyboard.type",
        params: { text: "--abc" },
        result: {
          action: "keyboard.type",
          ok: true,
          element: actionElement("textbox", "Active"),
          valueLength: 5,
        },
        stdout: "keyboard.type ok textbox Active valueLength=5\n",
      },
      {
        args: ["keyboard", "type", "--tab"],
        command: "keyboard.type",
        params: { text: "--tab" },
        result: {
          action: "keyboard.type",
          ok: true,
          element: actionElement("textbox", "Active"),
          valueLength: 5,
        },
        stdout: "keyboard.type ok textbox Active valueLength=5\n",
      },
      {
        args: ["press", "Enter"],
        command: "press",
        params: { key: "Enter" },
        result: { action: "press", ok: true, element: actionElement("button", "Save") },
        stdout: "press ok button Save\n",
      },
      {
        args: ["select", "select", "pro", "team"],
        command: "select",
        params: { selector: "select", values: ["pro", "team"] },
        result: {
          action: "select",
          ok: true,
          element: actionElement("combobox", "Plan"),
          selectedValues: ["pro", "team"],
        },
        stdout: "select ok combobox Plan selected=pro,team\n",
      },
      {
        args: ["select", "select", "--pro"],
        command: "select",
        params: { selector: "select", values: ["--pro"] },
        result: {
          action: "select",
          ok: true,
          element: actionElement("combobox", "Plan"),
          selectedValues: ["--pro"],
        },
        stdout: "select ok combobox Plan selected=--pro\n",
      },
      {
        args: ["select", "select", "--generation"],
        command: "select",
        params: { selector: "select", values: ["--generation"] },
        result: {
          action: "select",
          ok: true,
          element: actionElement("combobox", "Plan"),
          selectedValues: ["--generation"],
        },
        stdout: "select ok combobox Plan selected=--generation\n",
      },
      {
        args: ["select", "select", "pro", "--generation"],
        command: "select",
        params: { selector: "select", values: ["pro", "--generation"] },
        result: {
          action: "select",
          ok: true,
          element: actionElement("combobox", "Plan"),
          selectedValues: ["pro", "--generation"],
        },
        stdout: "select ok combobox Plan selected=pro,--generation\n",
      },
      {
        args: ["select", "#plan", "pro", "--tab", "id:42", "--json"],
        command: "select",
        params: { selector: "#plan", values: ["pro"], target: { tab: { kind: "id", id: 42 } } },
        result: {
          action: "select",
          ok: true,
          element: actionElement("combobox", "Plan"),
          selectedValues: ["pro"],
        },
        stdout: `${JSON.stringify(
          {
            ok: true,
            action: "select",
            element: actionElement("combobox", "Plan"),
            selectedValues: ["pro"],
          },
          null,
          2,
        )}\n`,
      },
      {
        args: ["scroll", "down", "300", "#feed"],
        command: "scroll",
        params: { direction: "down", distancePx: 300, selector: "#feed" },
        result: { action: "scroll", ok: true, scroll: { x: 0, y: 300 } },
        stdout: "scroll ok scroll=0,300\n",
      },
    ];

    for (const testCase of cases) {
      const output = await runCli(testCase.args, {
        ...baseDependencies(),
        sendRequest: async (request) => {
          expect(request).toMatchObject({
            command: testCase.command,
            params: testCase.params,
          });
          return createOkResponse(request, testCase.result as never);
        },
      });

      expect(output).toEqual({
        exitCode: 0,
        stdout: testCase.stdout,
        stderr: "",
      });
    }
  });

  it("sends Phase 8 command families through protocol requests", async () => {
    const cwd = await createTempDir("firefox-cli-phase8-cli");
    await writeFile(join(cwd, "fixture.txt"), "upload body");
    const cases: readonly {
      readonly argv: readonly string[];
      readonly expected: {
        readonly command: CommandId;
        readonly params: Record<string, unknown>;
      };
    }[] = [
      {
        argv: ["drag", "#source", "#target", "--tab", "id:42", "--json"],
        expected: {
          command: "drag",
          params: {
            sourceSelector: "#source",
            targetSelector: "#target",
            target: { tab: { kind: "id", id: 42 } },
          },
        },
      },
      {
        argv: ["upload", "#file", "fixture.txt", "--json"],
        expected: {
          command: "upload",
          params: {
            selector: "#file",
            files: [{ name: "fixture.txt", dataBase64: "dXBsb2FkIGJvZHk=" }],
          },
        },
      },
      {
        argv: ["mouse", "wheel", "#feed", "--delta-y", "120", "--x", "5", "--json"],
        expected: {
          command: "mouse",
          params: { action: "wheel", selector: "#feed", deltaY: 120, x: 5 },
        },
      },
      {
        argv: ["keydown", "A", "#keys", "--json"],
        expected: { command: "keydown", params: { key: "A", selector: "#keys" } },
      },
      {
        argv: ["keyup", "A", "#keys", "--json"],
        expected: { command: "keyup", params: { key: "A", selector: "#keys" } },
      },
      {
        argv: ["find", "text", "Ready", "--first", "--json"],
        expected: { command: "find", params: { kind: "text", value: "Ready", first: true } },
      },
      {
        argv: ["frame", "--json"],
        expected: { command: "frame", params: {} },
      },
      {
        argv: ["download", "https://example.test/file.txt", "file.txt", "--save-as", "--json"],
        expected: {
          command: "download",
          params: { url: "https://example.test/file.txt", filename: "file.txt", saveAs: true },
        },
      },
      {
        argv: ["dialog", "accept", "yes", "--json"],
        expected: { command: "dialog", params: { action: "accept", promptText: "yes" } },
      },
      {
        argv: ["clipboard", "copy", "#copy", "--json"],
        expected: { command: "clipboard", params: { action: "copy", selector: "#copy" } },
      },
      {
        argv: ["cookies", "set", "https://example.test/", "sid", "1", "--json"],
        expected: {
          command: "cookies",
          params: { action: "set", url: "https://example.test/", name: "sid", value: "1" },
        },
      },
      {
        argv: ["storage", "local", "set", "phase", "8", "--json"],
        expected: {
          command: "storage",
          params: { area: "local", action: "set", key: "phase", value: "8" },
        },
      },
      {
        argv: ["network", "list", "--url", "example.test", "--json"],
        expected: { command: "network", params: { action: "list", urlGlob: "example.test" } },
      },
      {
        argv: ["network", "clear", "--tab", "id:7", "--json"],
        expected: {
          command: "network",
          params: { action: "clear", target: { tab: { kind: "id", id: 7 } } },
        },
      },
      {
        argv: ["console", "list", "--json"],
        expected: { command: "console", params: { action: "list" } },
      },
      {
        argv: ["errors", "clear", "--json"],
        expected: { command: "errors", params: { action: "clear" } },
      },
      {
        argv: ["highlight", "#save", "--duration", "1000", "--json"],
        expected: { command: "highlight", params: { selector: "#save", durationMs: 1000 } },
      },
      {
        argv: ["pdf", "page.pdf", "--json"],
        expected: { command: "pdf", params: { path: join(cwd, "page.pdf") } },
      },
      {
        argv: ["set", "viewport", "1200", "800", "--json"],
        expected: { command: "set.viewport", params: { width: 1200, height: 800 } },
      },
      {
        argv: ["diff", "title", "Expected title", "--json"],
        expected: { command: "diff", params: { kind: "title", expected: "Expected title" } },
      },
    ];

    for (const testCase of cases) {
      const requests: RequestEnvelope[] = [];
      const output = await runCli(testCase.argv, {
        ...baseDependencies(),
        cwd,
        sendRequest: async (request) => {
          requests.push(request);
          return createOkResponse(
            request as RequestEnvelope<CommandId>,
            phase8CliResultFor(request) as never,
          ) as ResponseEnvelope;
        },
      });

      expect(output.exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject(testCase.expected);
    }
  });

  it("rejects upload file counts before filesystem work or requests", async () => {
    let statCalls = 0;
    let readCalls = 0;
    let requestCalls = 0;
    const output = await runCli(
      [
        "upload",
        "#file",
        ...Array.from({ length: MAX_UPLOAD_FILES + 1 }, (_, index) => `${index}.bin`),
      ],
      {
        ...baseDependencies(),
        statUploadFile: async () => {
          statCalls += 1;
          return { size: 1, isFile: true };
        },
        readUploadFile: async () => {
          readCalls += 1;
          return new Uint8Array([1]);
        },
        sendRequest: async (request) => {
          requestCalls += 1;
          return createOkResponse(request, { action: "upload", ok: true, valueLength: 1 });
        },
      },
    );

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `Upload accepts at most ${MAX_UPLOAD_FILES} files.\n`,
    });
    expect(statCalls).toBe(0);
    expect(readCalls).toBe(0);
    expect(requestCalls).toBe(0);
  });

  it("rejects upload metadata limits before reading file contents or sending requests", async () => {
    const halfTotal = Math.floor(MAX_UPLOAD_TOTAL_BYTES / 2) + 1;
    const cases: readonly {
      readonly argv: readonly string[];
      readonly sizes: Readonly<Record<string, number>>;
      readonly stderr: string;
      readonly expectedStatCalls: number;
    }[] = [
      {
        argv: ["upload", "#file", "big.bin"],
        sizes: { "big.bin": MAX_UPLOAD_FILE_BYTES + 1 },
        stderr: `Upload file exceeds ${MAX_UPLOAD_FILE_BYTES} byte per-file limit: big.bin (${MAX_UPLOAD_FILE_BYTES + 1} bytes).\n`,
        expectedStatCalls: 1,
      },
      {
        argv: ["upload", "#file", "one.bin", "two.bin"],
        sizes: { "one.bin": halfTotal, "two.bin": halfTotal },
        stderr: `Upload files exceed ${MAX_UPLOAD_TOTAL_BYTES} byte total limit (${halfTotal * 2} bytes).\n`,
        expectedStatCalls: 2,
      },
    ];

    for (const testCase of cases) {
      let statCalls = 0;
      let readCalls = 0;
      let requestCalls = 0;
      const output = await runCli(testCase.argv, {
        ...baseDependencies(),
        statUploadFile: async (path) => {
          statCalls += 1;
          return { size: testCase.sizes[path.split("/").at(-1) ?? ""] ?? 1, isFile: true };
        },
        readUploadFile: async () => {
          readCalls += 1;
          return new Uint8Array([1]);
        },
        sendRequest: async (request) => {
          requestCalls += 1;
          return createOkResponse(request, { action: "upload", ok: true, valueLength: 1 });
        },
      });

      expect(output).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: testCase.stderr,
      });
      expect(statCalls).toBe(testCase.expectedStatCalls);
      expect(readCalls).toBe(0);
      expect(requestCalls).toBe(0);
    }
  });

  it("rejects upload files that grow past stat limits before sending requests", async () => {
    let readCalls = 0;
    let requestCalls = 0;
    const output = await runCli(["upload", "#file", "growing.bin"], {
      ...baseDependencies(),
      statUploadFile: async () => ({ size: 1, isFile: true }),
      readUploadFile: async () => {
        readCalls += 1;
        return new Uint8Array(MAX_UPLOAD_FILE_BYTES + 1);
      },
      sendRequest: async (request) => {
        requestCalls += 1;
        return createOkResponse(request, { action: "upload", ok: true, valueLength: 1 });
      },
    });

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `Upload file exceeds ${MAX_UPLOAD_FILE_BYTES} byte per-file limit: growing.bin (${MAX_UPLOAD_FILE_BYTES + 1} bytes).\n`,
    });
    expect(readCalls).toBe(1);
    expect(requestCalls).toBe(0);
  });

  it("rejects batch argv upload aggregate metadata before reading file contents", async () => {
    const halfTotal = Math.floor(MAX_UPLOAD_TOTAL_BYTES / 2) + 1;
    let readCalls = 0;
    let requestCalls = 0;
    const output = await runCli(
      [
        "batch",
        JSON.stringify([
          ["upload", "#file", "one.bin"],
          ["upload", "#file", "two.bin"],
        ]),
      ],
      {
        ...baseDependencies(),
        statUploadFile: async (path) => ({
          size: path.endsWith("one.bin") || path.endsWith("two.bin") ? halfTotal : 1,
          isFile: true,
        }),
        readUploadFile: async () => {
          readCalls += 1;
          return new Uint8Array([1]);
        },
        sendRequest: async (request) => {
          requestCalls += 1;
          return createOkResponse(request, {
            ok: true,
            elapsedMs: 1,
            steps: [],
          });
        },
      },
    );

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `Upload files exceed ${MAX_UPLOAD_TOTAL_BYTES} byte total limit (${halfTotal * 2} bytes).\n`,
    });
    expect(readCalls).toBe(0);
    expect(requestCalls).toBe(0);
  });

  it("rejects raw batch upload aggregate payloads before sending requests", async () => {
    let requestCalls = 0;
    const halfTotal = Math.floor(MAX_UPLOAD_TOTAL_BYTES / 2) + 1;
    const output = await runCli(
      [
        "batch",
        JSON.stringify([
          {
            command: "upload",
            params: {
              selector: "#file",
              files: [{ name: "one.bin", dataBase64: uploadData(halfTotal) }],
            },
          },
          {
            command: "upload",
            params: {
              selector: "#file",
              files: [{ name: "two.bin", dataBase64: uploadData(halfTotal) }],
            },
          },
        ]),
      ],
      {
        ...baseDependencies(),
        sendRequest: async (request) => {
          requestCalls += 1;
          return createOkResponse(request, {
            ok: true,
            elapsedMs: 1,
            steps: [],
          });
        },
      },
    );

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `Batch request is invalid: Upload files exceed the ${MAX_UPLOAD_TOTAL_BYTES} byte total limit.\n`,
    });
    expect(requestCalls).toBe(0);
  });

  it("rejects malformed interaction arguments at the CLI boundary", async () => {
    await expect(runCli(["set"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing or invalid set command.\n",
    });
    await expect(runCli(["set", "foo"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing or invalid set command.\n",
    });
    await expect(runCli(["keyboard"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing or invalid keyboard command.\n",
    });
    await expect(runCli(["keyboard", "foo"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing or invalid keyboard command.\n",
    });
    await expect(runCli(["click"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing selector or ref.\n",
    });
    await expect(runCli(["fill", "#email"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing text.\n",
    });
    await expect(runCli(["keyboard", "type"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing text.\n",
    });
    await expect(runCli(["scroll", "north"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid direction: north\n",
    });
    await expect(runCli(["click", "@e0"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid ref: @e0\n",
    });
    await expect(runCli(["click", "--json"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing selector or ref.\n",
    });
    await expect(runCli(["click", "--window", "2"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing selector or ref.\n",
    });
  });

  it("preserves command-specific usage errors for malformed batch argv subcommands", async () => {
    await expect(
      runCli(["batch", JSON.stringify([["set", "foo"]])], baseDependencies()),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid batch argv step 0: Missing or invalid set command.\n",
    });
    await expect(
      runCli(["batch", JSON.stringify([["keyboard", "foo"]])], baseDependencies()),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid batch argv step 0: Missing or invalid keyboard command.\n",
    });
  });

  it("prints help for unknown commands", async () => {
    const output = await runCli(["missing"], baseDependencies());

    expect(output.exitCode).toBe(1);
    expect(output.stdout).toContain("Usage:");
  });

  it("returns explicit unsupported-capability errors for gated CLI command families", async () => {
    for (const capability of gatedCapabilities) {
      for (const command of capability.cliCommands ?? []) {
        await expect(runCli([command], baseDependencies())).resolves.toEqual({
          exitCode: 1,
          stdout: "",
          stderr: `UNSUPPORTED_CAPABILITY: ${capability.reason}\n`,
        });
      }
    }
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
    cwd: "/work",
    sendRequest: async (request) =>
      createErrorResponse(request.id, {
        code: "NATIVE_HOST_UNAVAILABLE",
        message: "firefox-cli native host is not running.",
      }),
    clearPairState: async () => undefined,
  };
}

function actionElement(role: string, name: string) {
  return {
    tagName: role === "button" ? "button" : "input",
    role,
    visible: true,
    name,
  };
}

function phase8CliResultFor(request: RequestEnvelope): unknown {
  const element = actionElement("button", "Submit");
  switch (request.command) {
    case "drag":
    case "mouse":
    case "keydown":
    case "keyup":
      return { action: request.command, ok: true, element };
    case "upload":
      return { action: request.command, ok: true, element, valueLength: 1 };
    case "find":
      return { elements: [element] };
    case "frame":
      return { frames: [] };
    case "download":
      return { id: 1, filename: "file.txt", state: "complete" };
    case "dialog":
      return { action: "accept", handled: true };
    case "clipboard":
      return { action: "copy", ok: true, text: "Copied" };
    case "cookies":
      return { action: "set", ok: true, cookie: { name: "sid", value: "1" } };
    case "storage":
      return { area: "local", action: "set", ok: true };
    case "network":
      return { action: "list", ok: true, requests: [] };
    case "console":
      return { action: "list", ok: true, entries: [] };
    case "errors":
      return { action: "clear", ok: true };
    case "highlight":
      return { ok: true, element };
    case "pdf":
      return { path: "/work/page.pdf" };
    case "set.viewport":
      return { window: { id: 7, index: 0, focused: true, tabCount: 1 } };
    case "diff":
      return {
        kind: "title",
        expected: "Expected title",
        actual: "Expected title",
        matches: true,
      };
    default:
      throw new Error(`Unexpected Phase 8 CLI test command: ${request.command}`);
  }
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

function uploadData(bytes: number): string {
  return Buffer.alloc(bytes).toString("base64");
}
