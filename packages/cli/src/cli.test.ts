import { PROTOCOL_VERSION, createErrorResponse, createOkResponse, gatedCapabilities, kernelCapabilities } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { baseDependencies } from "./cli-test-support.js";

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
      stderr: "Not approved: Approve firefox-cli in the extension popup before running CLI commands.\n",
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
      stderr: "Version mismatch: Protocol version is not supported.. Upgrade/rebuild firefox-cli, the native host, and the extension.\n",
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
          stderr: `UNSUPPORTED_CAPABILITY: ${String(capability.reason)}\n`,
        });
      }
    }
  });
});
