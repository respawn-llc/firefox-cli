import { createOkResponse } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { baseDependencies, targetSummary } from "./cli-test-support.js";

describe("runCli screenshot", () => {
  it("captures visible screenshots to an absolute path", async () => {
    const output = await runCli(["screenshot", "page.png", "--timeout", "1000", "--max-output", "2000", "--tab", "id:42"], {
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
    });

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
    const output = await runCli(["screenshot", "page.jpg", "--full", "--format", "jpeg", "--screenshot-quality", "80"], {
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
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "/work/page.jpg 128 bytes\n",
      stderr: "",
    });
  });
});
