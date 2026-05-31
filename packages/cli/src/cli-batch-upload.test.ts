import { createOkResponse } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { actionElement, baseDependencies } from "./cli-test-support.js";

describe("runCli batch upload and validation", () => {
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
    await expect(runCli(["batch", JSON.stringify([["setup"]])], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid batch argv command at step 0.\n",
    });
    await expect(runCli(["batch", JSON.stringify([["eval", "--stdin"]])], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Batch argv step 0 cannot read from stdin.\n",
    });
    await expect(runCli(["batch", JSON.stringify([["tab", "close", "--tab"]])], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid batch argv step 0: Missing value for --tab.\n",
    });
    await expect(runCli(["batch", JSON.stringify([{ command: "batch", params: {} }])], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid batch command at step 0.\n",
    });
    await expect(runCli(["batch", "--timeout", "0", JSON.stringify([{ command: "snapshot", params: {} }])], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid timeout: 0\n",
    });
  });
});
