import { createErrorResponse, createOkResponse, type RequestEnvelope } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { actionElement, baseDependencies } from "./cli-test-support.js";
import { runCli } from "./index.js";

describe("runCli batch core", () => {
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

  it("preserves omitted selectors in window-only argv steps", async () => {
    let sentRequest: RequestEnvelope | undefined;

    await runCli(
      [
        "batch",
        JSON.stringify([
          ["tab", "new"],
          ["window", "select"],
          ["window", "close"],
        ]),
      ],
      {
        ...baseDependencies(),
        sendRequest: async (request) => {
          sentRequest = request;
          return createErrorResponse(request.id, {
            code: "NATIVE_HOST_UNAVAILABLE",
            message: "Expected test transport failure.",
          });
        },
      },
    );

    expect(sentRequest?.command).toBe("batch");
    expect(sentRequest?.params).toMatchObject({
      steps: [
        { command: "tab.new", params: {} },
        { command: "window.select", params: {} },
        { command: "window.close", params: {} },
      ],
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
    const batchOutput = await runCli(["batch", JSON.stringify([["dialog", "accept", "--proceed"]])], {
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
    });

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
});
