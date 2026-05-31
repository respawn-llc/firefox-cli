import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { createErrorResponse, createOkResponse } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { actionElement, baseDependencies, targetSummary } from "./cli-test-support.js";

describe("runCli tabs and targets", () => {
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
});
