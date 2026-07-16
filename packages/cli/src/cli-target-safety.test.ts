import { createErrorResponse, type RequestEnvelope } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { baseDependencies, targetSummary } from "./cli-test-support.js";
import { runCli } from "./index.js";

describe("runCli target safety", () => {
  it("preserves an omitted tab selector for extension ambiguity checks", async () => {
    let sentRequest: RequestEnvelope | undefined;

    await runCli(["tab", "select"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        sentRequest = request;
        return createErrorResponse(request.id, {
          code: "INVALID_TARGET",
          message: "Expected ambiguity test response.",
        });
      },
    });

    expect(sentRequest?.command).toBe("tab.select");
    expect(sentRequest?.params).toEqual({});
  });

  it("preserves an omitted window selector for extension ambiguity checks", async () => {
    let sentRequest: RequestEnvelope | undefined;

    await runCli(["window", "select"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        sentRequest = request;
        return createErrorResponse(request.id, {
          code: "INVALID_TARGET",
          message: "Expected ambiguity test response.",
        });
      },
    });

    expect(sentRequest?.command).toBe("window.select");
    expect(sentRequest?.params).toEqual({});
  });

  it("warns that selecting a window only brings it forward to the user", async () => {
    const output = await runCli(["window", "select", "id:7"], {
      ...baseDependencies(),
      sendRequest: async (request) => ({
        protocolVersion: request.protocolVersion,
        id: request.id,
        ok: true,
        result: {
          window: {
            id: 7,
            index: 0,
            focused: true,
            activeTabId: 42,
            tabCount: 1,
          },
          target: targetSummary(),
        },
      }),
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout:
        "w7 [0]\nBrought this window forward to the user. This does not absolve you from passing `--window`/`--tab` explicitly to every later target-dependent command.\n",
      stderr: "",
    });
  });
});
