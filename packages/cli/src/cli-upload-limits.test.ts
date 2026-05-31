import { MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_FILES, MAX_UPLOAD_TOTAL_BYTES, createOkResponse } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { baseDependencies, uploadData } from "./cli-test-support.js";

describe("runCli upload limits", () => {
  it("rejects upload file counts before filesystem work or requests", async () => {
    let statCalls = 0;
    let readCalls = 0;
    let requestCalls = 0;
    const output = await runCli(["upload", "#file", ...Array.from({ length: MAX_UPLOAD_FILES + 1 }, (_, index) => `${String(index)}.bin`)], {
      ...baseDependencies(),
      statUploadFile: async () => {
        statCalls += 1;
        return { size: 1, isFile: true };
      },
      readUploadFile: async () => {
        readCalls += 1;
        return new Uint8Array([1]);
      },
      sendRequest: async (request) => {
        requestCalls += 1;
        return createOkResponse(request, { action: "upload", ok: true, valueLength: 1 });
      },
    });

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `Upload accepts at most ${String(MAX_UPLOAD_FILES)} files.\n`,
    });
    expect(statCalls).toBe(0);
    expect(readCalls).toBe(0);
    expect(requestCalls).toBe(0);
  });

  it("rejects upload metadata limits before reading file contents or sending requests", async () => {
    const halfTotal = Math.floor(MAX_UPLOAD_TOTAL_BYTES / 2) + 1;
    const cases: readonly {
      readonly argv: readonly string[];
      readonly sizes: Readonly<Record<string, number>>;
      readonly stderr: string;
      readonly expectedStatCalls: number;
    }[] = [
      {
        argv: ["upload", "#file", "big.bin"],
        sizes: { "big.bin": MAX_UPLOAD_FILE_BYTES + 1 },
        stderr: `Upload file exceeds ${String(MAX_UPLOAD_FILE_BYTES)} byte per-file limit: big.bin (${String(MAX_UPLOAD_FILE_BYTES + 1)} bytes).\n`,
        expectedStatCalls: 1,
      },
      {
        argv: ["upload", "#file", "one.bin", "two.bin"],
        sizes: { "one.bin": halfTotal, "two.bin": halfTotal },
        stderr: `Upload files exceed ${String(MAX_UPLOAD_TOTAL_BYTES)} byte total limit (${String(halfTotal * 2)} bytes).\n`,
        expectedStatCalls: 2,
      },
    ];

    for (const testCase of cases) {
      let statCalls = 0;
      let readCalls = 0;
      let requestCalls = 0;
      const output = await runCli(testCase.argv, {
        ...baseDependencies(),
        statUploadFile: async (path) => {
          statCalls += 1;
          return { size: testCase.sizes[path.split("/").at(-1) ?? ""] ?? 1, isFile: true };
        },
        readUploadFile: async () => {
          readCalls += 1;
          return new Uint8Array([1]);
        },
        sendRequest: async (request) => {
          requestCalls += 1;
          return createOkResponse(request, { action: "upload", ok: true, valueLength: 1 });
        },
      });

      expect(output).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: testCase.stderr,
      });
      expect(statCalls).toBe(testCase.expectedStatCalls);
      expect(readCalls).toBe(0);
      expect(requestCalls).toBe(0);
    }
  });

  it("rejects upload files that grow past stat limits before sending requests", async () => {
    let readCalls = 0;
    let requestCalls = 0;
    const output = await runCli(["upload", "#file", "growing.bin"], {
      ...baseDependencies(),
      statUploadFile: async () => ({ size: 1, isFile: true }),
      readUploadFile: async () => {
        readCalls += 1;
        return new Uint8Array(MAX_UPLOAD_FILE_BYTES + 1);
      },
      sendRequest: async (request) => {
        requestCalls += 1;
        return createOkResponse(request, { action: "upload", ok: true, valueLength: 1 });
      },
    });

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `Upload file exceeds ${String(MAX_UPLOAD_FILE_BYTES)} byte per-file limit: growing.bin (${String(MAX_UPLOAD_FILE_BYTES + 1)} bytes).\n`,
    });
    expect(readCalls).toBe(1);
    expect(requestCalls).toBe(0);
  });

  it("rejects batch argv upload aggregate metadata before reading file contents", async () => {
    const halfTotal = Math.floor(MAX_UPLOAD_TOTAL_BYTES / 2) + 1;
    let readCalls = 0;
    let requestCalls = 0;
    const output = await runCli(
      [
        "batch",
        JSON.stringify([
          ["upload", "#file", "one.bin"],
          ["upload", "#file", "two.bin"],
        ]),
      ],
      {
        ...baseDependencies(),
        statUploadFile: async (path) => ({
          size: path.endsWith("one.bin") || path.endsWith("two.bin") ? halfTotal : 1,
          isFile: true,
        }),
        readUploadFile: async () => {
          readCalls += 1;
          return new Uint8Array([1]);
        },
        sendRequest: async (request) => {
          requestCalls += 1;
          return createOkResponse(request, {
            ok: true,
            elapsedMs: 1,
            steps: [],
          });
        },
      },
    );

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `Upload files exceed ${String(MAX_UPLOAD_TOTAL_BYTES)} byte total limit (${String(halfTotal * 2)} bytes).\n`,
    });
    expect(readCalls).toBe(0);
    expect(requestCalls).toBe(0);
  });

  it("rejects raw batch upload aggregate payloads before sending requests", async () => {
    let requestCalls = 0;
    const halfTotal = Math.floor(MAX_UPLOAD_TOTAL_BYTES / 2) + 1;
    const output = await runCli(
      [
        "batch",
        JSON.stringify([
          {
            command: "upload",
            params: {
              selector: "#file",
              files: [{ name: "one.bin", dataBase64: uploadData(halfTotal) }],
            },
          },
          {
            command: "upload",
            params: {
              selector: "#file",
              files: [{ name: "two.bin", dataBase64: uploadData(halfTotal) }],
            },
          },
        ]),
      ],
      {
        ...baseDependencies(),
        sendRequest: async (request) => {
          requestCalls += 1;
          return createOkResponse(request, {
            ok: true,
            elapsedMs: 1,
            steps: [],
          });
        },
      },
    );

    expect(output).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `Batch request is invalid: Upload files exceed the ${String(MAX_UPLOAD_TOTAL_BYTES)} byte total limit.\n`,
    });
    expect(requestCalls).toBe(0);
  });

  it("rejects malformed interaction arguments at the CLI boundary", async () => {
    await expect(runCli(["set"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing or invalid set command.\n",
    });
    await expect(runCli(["set", "foo"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing or invalid set command.\n",
    });
    await expect(runCli(["keyboard"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing or invalid keyboard command.\n",
    });
    await expect(runCli(["keyboard", "foo"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing or invalid keyboard command.\n",
    });
    await expect(runCli(["click"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing selector or ref.\n",
    });
    await expect(runCli(["fill", "#email"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing text.\n",
    });
    await expect(runCli(["keyboard", "type"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing text.\n",
    });
    await expect(runCli(["scroll", "north"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid direction: north\n",
    });
    await expect(runCli(["click", "@e0"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid ref: @e0\n",
    });
    await expect(runCli(["click", "--json"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing selector or ref.\n",
    });
    await expect(runCli(["click", "--window", "2"], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Missing selector or ref.\n",
    });
  });

  it("preserves command-specific usage errors for malformed batch argv subcommands", async () => {
    await expect(runCli(["batch", JSON.stringify([["set", "foo"]])], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid batch argv step 0: Missing or invalid set command.\n",
    });
    await expect(runCli(["batch", JSON.stringify([["keyboard", "foo"]])], baseDependencies())).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Invalid batch argv step 0: Missing or invalid keyboard command.\n",
    });
  });
});
