import { createOkResponse, type WaitResult } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { baseDependencies } from "./cli-test-support.js";

describe("runCli wait", () => {
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
      ["wait", "@e1", "--generation", "g1", "--state", "hidden", "--timeout", "2000", "--interval", "50", "--tab", "id:42", "--json"],
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
          if (request.command !== "wait") {
            throw new Error(`Unexpected wait test command: ${request.command}`);
          }
          return createOkResponse(request, testCase.result);
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
    await expect(runCli(["wait", "#main", "--state", "complete"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid wait state: complete\n",
    });
    await expect(runCli(["wait", "@e0"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid ref: @e0\n",
    });
    await expect(runCli(["wait", "--text", "Ready", "--generation", "g1"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Only element waits accept --generation.\n",
    });
    await expect(runCli(["wait", "--text", "Ready", "--state"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing value for --state.\n",
    });
    await expect(runCli(["wait", "--text", "--json"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing value for --text.\n",
    });
    await expect(runCli(["wait", "--text", "Ready", "--new-tab"], baseDependencies())).resolves.toEqual({
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
});
