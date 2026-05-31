import { createOkResponse, type RequestEnvelope } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { actionElement, baseDependencies } from "./cli-test-support.js";

describe("runCli protocol route parity", () => {
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
    const batchOutput = await runCli(["batch", JSON.stringify([["click", "#save", "--tab", "id:42"]]), "--json"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        if (request.command !== "batch") {
          throw new Error(`Unexpected batch route test command: ${request.command}`);
        }
        batchRequest = request;
        return {
          protocolVersion: request.protocolVersion,
          id: request.id,
          ok: true,
          result: { ok: true, elapsedMs: 1, steps: [] },
        };
      },
    });

    expect(directOutput.exitCode).toBe(0);
    expect(batchOutput.exitCode).toBe(0);
    expect(directRequest?.command).toBe("click");
    expect(batchRequest?.params.steps).toEqual([{ command: directRequest?.command, params: directRequest?.params }]);
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
});
