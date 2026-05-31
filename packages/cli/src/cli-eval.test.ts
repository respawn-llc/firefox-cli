import { createOkResponse } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { baseDependencies, targetSummary } from "./cli-test-support.js";

describe("runCli eval", () => {
  it("runs eval from argv with target, timeout, and result-size options", async () => {
    const output = await runCli(["eval", "document.title", "--timeout", "1000", "--max-output", "2000", "--tab", "id:42", "--json"], {
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
    });

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

    const base64 = await runCli(["eval", "-b", Buffer.from("const value = 1;").toString("base64")], {
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
    });
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
});
