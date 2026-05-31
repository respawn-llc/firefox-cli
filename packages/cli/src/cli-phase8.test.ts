import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import type { CommandId, RequestEnvelope } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { baseDependencies, phase8CliResultFor } from "./cli-test-support.js";

describe("runCli Phase 8 commands", () => {
  it("sends Phase 8 command families through protocol requests", async () => {
    const cwd = await createTempDir("firefox-cli-phase8-cli");
    await writeFile(join(cwd, "fixture.txt"), "upload body");
    const cases: readonly {
      readonly argv: readonly string[];
      readonly expected: {
        readonly command: CommandId;
        readonly params: Record<string, unknown>;
      };
    }[] = [
      {
        argv: ["drag", "#source", "#target", "--tab", "id:42", "--json"],
        expected: {
          command: "drag",
          params: {
            sourceSelector: "#source",
            targetSelector: "#target",
            target: { tab: { kind: "id", id: 42 } },
          },
        },
      },
      {
        argv: ["upload", "#file", "fixture.txt", "--json"],
        expected: {
          command: "upload",
          params: {
            selector: "#file",
            files: [{ name: "fixture.txt", dataBase64: "dXBsb2FkIGJvZHk=" }],
          },
        },
      },
      {
        argv: ["mouse", "wheel", "#feed", "--delta-y", "120", "--x", "5", "--json"],
        expected: {
          command: "mouse",
          params: { action: "wheel", selector: "#feed", deltaY: 120, x: 5 },
        },
      },
      {
        argv: ["keydown", "A", "#keys", "--json"],
        expected: { command: "keydown", params: { key: "A", selector: "#keys" } },
      },
      {
        argv: ["keyup", "A", "#keys", "--json"],
        expected: { command: "keyup", params: { key: "A", selector: "#keys" } },
      },
      {
        argv: ["find", "text", "Ready", "--first", "--json"],
        expected: { command: "find", params: { kind: "text", value: "Ready", first: true } },
      },
      {
        argv: ["frame", "--json"],
        expected: { command: "frame", params: {} },
      },
      {
        argv: ["download", "https://example.test/file.txt", "file.txt", "--save-as", "--json"],
        expected: {
          command: "download",
          params: { url: "https://example.test/file.txt", filename: "file.txt", saveAs: true },
        },
      },
      {
        argv: ["dialog", "accept", "yes", "--json"],
        expected: { command: "dialog", params: { action: "accept", promptText: "yes" } },
      },
      {
        argv: ["clipboard", "copy", "#copy", "--json"],
        expected: { command: "clipboard", params: { action: "copy", selector: "#copy" } },
      },
      {
        argv: ["cookies", "set", "https://example.test/", "sid", "1", "--json"],
        expected: {
          command: "cookies",
          params: { action: "set", url: "https://example.test/", name: "sid", value: "1" },
        },
      },
      {
        argv: ["storage", "local", "set", "phase", "8", "--json"],
        expected: {
          command: "storage",
          params: { area: "local", action: "set", key: "phase", value: "8" },
        },
      },
      {
        argv: ["network", "list", "--url", "example.test", "--json"],
        expected: { command: "network", params: { action: "list", urlGlob: "example.test" } },
      },
      {
        argv: ["network", "clear", "--tab", "id:7", "--json"],
        expected: {
          command: "network",
          params: { action: "clear", target: { tab: { kind: "id", id: 7 } } },
        },
      },
      {
        argv: ["console", "list", "--json"],
        expected: { command: "console", params: { action: "list" } },
      },
      {
        argv: ["errors", "clear", "--json"],
        expected: { command: "errors", params: { action: "clear" } },
      },
      {
        argv: ["highlight", "#save", "--duration", "1000", "--json"],
        expected: { command: "highlight", params: { selector: "#save", durationMs: 1000 } },
      },
      {
        argv: ["pdf", "page.pdf", "--json"],
        expected: { command: "pdf", params: { path: join(cwd, "page.pdf") } },
      },
      {
        argv: ["set", "viewport", "1200", "800", "--json"],
        expected: { command: "set.viewport", params: { width: 1200, height: 800 } },
      },
      {
        argv: ["diff", "title", "Expected title", "--json"],
        expected: { command: "diff", params: { kind: "title", expected: "Expected title" } },
      },
    ];

    for (const testCase of cases) {
      const requests: RequestEnvelope[] = [];
      const output = await runCli(testCase.argv, {
        ...baseDependencies(),
        cwd,
        sendRequest: async (request) => {
          requests.push(request);
          return {
            protocolVersion: request.protocolVersion,
            id: request.id,
            ok: true,
            result: phase8CliResultFor(request),
          };
        },
      });

      expect(output.exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject(testCase.expected);
    }
  });
});
