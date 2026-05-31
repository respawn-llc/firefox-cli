import { createErrorResponse, createOkResponse } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { baseDependencies, targetSummary } from "./cli-test-support.js";

describe("runCli snapshots and getters", () => {
  it("requests an interactive scoped snapshot and prints text output", async () => {
    const output = await runCli(["snapshot", "-i", "-d", "3", "-s", "#main"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "snapshot",
          params: {
            interactiveOnly: true,
            compact: true,
            maxDepth: 3,
            selector: "#main",
          },
        });
        return createOkResponse(request, {
          generationId: "g1",
          text: '@e1 button "Submit"',
          refs: 1,
          truncated: false,
          frames: [],
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: '@e1 button "Submit"\n',
      stderr: "",
    });
  });

  it("prints snapshot JSON output with target metadata", async () => {
    const output = await runCli(["snapshot", "--json", "--tab", "id:42"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "snapshot",
          params: {
            target: {
              tab: { kind: "id", id: 42 },
            },
          },
        });
        return createOkResponse(request, {
          target: targetSummary(),
          generationId: "g1",
          text: '@e1 link "Example"',
          refs: 1,
          truncated: false,
          frames: [],
        });
      },
    });

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({
      target: { tabId: 42 },
      generationId: "g1",
      refs: 1,
    });
  });

  it("maps script injection failures to actionable snapshot output", async () => {
    const output = await runCli(["snapshot"], {
      ...baseDependencies(),
      sendRequest: async (request) =>
        createErrorResponse(request.id, {
          code: "SCRIPT_INJECTION_FAILED",
          message: "Cannot inject firefox-cli into this tab.",
        }),
    });

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "SCRIPT_INJECTION_FAILED: Cannot inject firefox-cli into this tab. Try a normal web page tab and reload it after updating the extension.\n",
    });
  });

  it("resolves snapshot refs with optional generation IDs", async () => {
    const output = await runCli(["ref", "@e1", "--generation", "g1", "--tab", "id:42"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "ref.resolve",
          params: {
            ref: "@e1",
            generationId: "g1",
            target: {
              tab: { kind: "id", id: 42 },
            },
          },
        });
        return createOkResponse(request, {
          target: targetSummary(),
          element: {
            ref: "@e1",
            generationId: "g1",
            tagName: "button",
            role: "button",
            name: "Save",
            text: "Save",
            visible: true,
          },
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "@e1 button Save (g1)\n",
      stderr: "",
    });
  });

  it("gets a tab title without an element target", async () => {
    const output = await runCli(["get", "title", "--tab", "id:42"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "get",
          params: {
            kind: "title",
            target: {
              tab: { kind: "id", id: 42 },
            },
          },
        });
        return createOkResponse(request, {
          target: targetSummary(),
          kind: "title",
          value: "Example",
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "Example\n",
      stderr: "",
    });
  });

  it("rejects element positionals for tab-level getters", async () => {
    const output = await runCli(["get", "title", "#main"], baseDependencies());

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "get title does not accept a selector or ref.\n",
    });
  });

  it("gets element text by selector as JSON", async () => {
    const output = await runCli(["get", "text", "#main", "--max-output", "1000", "--json"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "get",
          params: {
            kind: "text",
            selector: "#main",
            maxOutputBytes: 1000,
          },
        });
        return createOkResponse(request, {
          target: targetSummary(),
          kind: "text",
          value: "Hello",
          truncated: false,
        });
      },
    });

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({
      kind: "text",
      value: "Hello",
      truncated: false,
    });
  });

  it("gets an attribute by snapshot ref with optional generation ID", async () => {
    const output = await runCli(["get", "attr", "@e1", "href", "--generation", "g1"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "get",
          params: {
            kind: "attr",
            ref: "@e1",
            generationId: "g1",
            attribute: "href",
          },
        });
        return createOkResponse(request, {
          kind: "attr",
          value: "/docs",
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "/docs\n",
      stderr: "",
    });
  });

  it("rejects attr getters without an attribute name at the CLI boundary", async () => {
    const output = await runCli(["get", "attr", "a"], baseDependencies());

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing attribute name.\n",
    });
  });

  it("rejects malformed get refs instead of treating them as selectors", async () => {
    const output = await runCli(["get", "text", "@e0"], baseDependencies());

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid ref: @e0\n",
    });
  });

  it("checks element state by selector and prints booleans", async () => {
    const output = await runCli(["is", "visible", "#main"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "is",
          params: {
            kind: "visible",
            selector: "#main",
          },
        });
        return createOkResponse(request, {
          kind: "visible",
          value: true,
        });
      },
    });

    expect(output).toEqual({
      exitCode: 0,
      stdout: "true\n",
      stderr: "",
    });
  });

  it("checks element state by ref with optional generation IDs", async () => {
    const output = await runCli(["is", "checked", "@e1", "--generation", "g1", "--json"], {
      ...baseDependencies(),
      sendRequest: async (request) => {
        expect(request).toMatchObject({
          command: "is",
          params: {
            kind: "checked",
            ref: "@e1",
            generationId: "g1",
          },
        });
        return createOkResponse(request, {
          kind: "checked",
          value: false,
        });
      },
    });

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual({
      kind: "checked",
      value: false,
    });
  });

  it("rejects invalid is kinds and malformed refs at the CLI boundary", async () => {
    await expect(runCli(["is", "editable", "#main"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing or invalid is kind.\n",
    });
    await expect(runCli(["is", "visible", "@e0"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid ref: @e0\n",
    });
  });
});
