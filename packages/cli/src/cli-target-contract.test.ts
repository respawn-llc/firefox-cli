import { createErrorResponse, getCliRouteEntries, type RequestEnvelope } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { parseCliRouteArgsForRoute } from "./argv-contracts.js";
import { runCli } from "./index.js";
import { baseDependencies } from "./cli-test-support.js";

describe("CLI route target contracts", () => {
  it("accepts selector dimensions declared by each protocol route", () => {
    for (const { route } of getCliRouteEntries()) {
      for (const [flag, supported] of [
        ["--window", route.selectorDimensions === "window" || route.selectorDimensions === "both"],
        ["--tab", route.selectorDimensions === "tab" || route.selectorDimensions === "both"],
      ] as const) {
        if (supported) {
          expect(parseCliRouteArgsForRoute(route.id, [flag, "id:7"]).optionArgs, `${route.id} ${flag}`).toEqual([flag, "id:7"]);
        } else {
          expect(() => parseCliRouteArgsForRoute(route.id, [flag, "id:7"]), `${route.id} ${flag}`).toThrow(`Unsupported`);
        }
      }
    }
  });

  it.each([
    ["tab new", ["tab", "new", "--tab", "id:42"]],
    ["window select", ["window", "select", "--tab", "id:42"]],
    ["window close", ["window", "close", "--tab", "id:42"]],
    ["targetless capabilities window", ["capabilities", "--window", "id:7"]],
    ["targetless capabilities tab", ["capabilities", "--tab", "id:42"]],
  ] as const)("rejects unsupported selectors before transport for %s", async (_name, argv) => {
    let requestCalls = 0;

    const output = await runCli(argv, {
      ...baseDependencies(),
      sendRequest: async () => {
        requestCalls += 1;
        throw new Error(`Unexpected request for ${argv.join(" ")}`);
      },
    });

    expect(output.exitCode).toBe(1);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain("Unsupported");
    expect(requestCalls).toBe(0);
  });

  it.each(["--window", "--tab"] as const)("rejects unsupported doctor selector %s before diagnostics", async (flag) => {
    const output = await runCli(["doctor", flag, "id:9"], baseDependencies());

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `Unsupported doctor option: ${flag}\n`,
    });
  });

  it("serializes supported selectors before and after ordinary and payload positionals", async () => {
    const cases: readonly {
      readonly name: string;
      readonly argv: readonly string[];
      readonly routeLength: number;
      readonly dimensions: readonly ("window" | "tab")[];
    }[] = [
      { name: "page navigation", argv: ["open", "https://example.com/"], routeLength: 1, dimensions: ["window", "tab"] },
      { name: "window-only tab creation", argv: ["tab", "new", "https://example.com/"], routeLength: 2, dimensions: ["window"] },
      { name: "payload-bearing interaction", argv: ["fill", "#name", "Nikita"], routeLength: 1, dimensions: ["window", "tab"] },
      { name: "batch request", argv: ["batch", JSON.stringify([["snapshot", "--tab", "id:42"]])], routeLength: 1, dimensions: ["window", "tab"] },
    ];

    for (const testCase of cases) {
      for (const dimension of testCase.dimensions) {
        const flag = `--${dimension}`;
        for (const placement of ["before", "after"] as const) {
          const argv =
            placement === "before"
              ? [...testCase.argv.slice(0, testCase.routeLength), flag, "id:7", ...testCase.argv.slice(testCase.routeLength)]
              : [...testCase.argv, flag, "id:7"];
          let request: RequestEnvelope | undefined;

          await runCli(argv, {
            ...baseDependencies(),
            sendRequest: async (sent) => {
              request = sent;
              return createErrorResponse(sent.id, {
                code: "NATIVE_HOST_UNAVAILABLE",
                message: "Expected test transport failure.",
              });
            },
          });

          expect(request, `${testCase.name} ${dimension} ${placement}`).toMatchObject({
            params: {
              target: {
                [dimension]: { kind: "id", id: 7 },
              },
            },
          });
        }
      }
    }
  });

  it("rejects unsupported batch step selectors before transport", async () => {
    let requestCalls = 0;
    const output = await runCli(["batch", JSON.stringify([["window", "close", "--tab", "id:42"]])], {
      ...baseDependencies(),
      sendRequest: async () => {
        requestCalls += 1;
        throw new Error("Unexpected batch request.");
      },
    });

    expect(output.exitCode).toBe(1);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain("Unsupported");
    expect(requestCalls).toBe(0);
  });

  it.each([
    ["notify", ["notify", "title", "--window", "id:7"]],
    ["notify batch step", ["batch", JSON.stringify([["notify", "title", "--tab", "id:7"]])]],
  ] as const)("rejects target selectors that would otherwise look like payload for %s", async (_name, argv) => {
    let requestCalls = 0;
    const output = await runCli(argv, {
      ...baseDependencies(),
      sendRequest: async () => {
        requestCalls += 1;
        throw new Error("Unexpected request.");
      },
    });

    expect(output.exitCode).toBe(1);
    expect(output.stderr).toContain("Unsupported");
    expect(requestCalls).toBe(0);
  });
});
