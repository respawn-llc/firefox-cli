import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
  PROTOCOL_VERSION,
  createRequest,
  parseBoundaryRequest,
  parseBoundaryResponse,
  type RequestEnvelope,
} from "./index.js";
import { uploadData } from "./protocol-test-support.js";

describe("parseBoundaryResponse", () => {
  it("validates Phase 8 command request and response contracts", () => {
    const element = {
      tagName: "button",
      role: "button",
      visible: true,
      name: "Submit",
    };
    const window = {
      id: 7,
      index: 0,
      focused: true,
      tabCount: 1,
    };
    const cases: readonly { readonly request: RequestEnvelope; readonly result: unknown }[] = [
      {
        request: createRequest("drag", { sourceSelector: "#source", targetSelector: "#target" }, "drag-1"),
        result: { action: "drag", ok: true, element },
      },
      {
        request: createRequest(
          "upload",
          {
            selector: "input[type=file]",
            files: [{ name: "fixture.txt", mimeType: "text/plain", dataBase64: "aGVsbG8=" }],
          },
          "upload-1",
        ),
        result: { action: "upload", ok: true, element, valueLength: 1 },
      },
      {
        request: createRequest("mouse", { action: "wheel", selector: "#feed", deltaY: 120 }, "mouse-1"),
        result: { action: "mouse", ok: true, element },
      },
      {
        request: createRequest("keydown", { key: "A", selector: "input" }, "keydown-1"),
        result: { action: "keydown", ok: true, element },
      },
      {
        request: createRequest("keyup", { key: "A", selector: "input" }, "keyup-1"),
        result: { action: "keyup", ok: true, element },
      },
      {
        request: createRequest("find", { kind: "role", value: "button", first: true }, "find-1"),
        result: { elements: [element] },
      },
      {
        request: createRequest("frame", {}, "frame-1"),
        result: { frames: [{ index: 0, title: "Child", url: "https://frame.test/" }] },
      },
      {
        request: createRequest("download", { url: "https://example.test/file.txt", filename: "file.txt", saveAs: true }, "download-1"),
        result: { id: 1, filename: "file.txt", state: "complete" },
      },
      {
        request: createRequest("wait", { kind: "download", downloadId: 1, filenameGlob: "*.txt" }, "wait-download-1"),
        result: {
          kind: "download",
          matched: true,
          elapsedMs: 5,
          download: { id: 1, filename: "file.txt", state: "complete" },
        },
      },
      {
        request: createRequest("dialog", { action: "accept", promptText: "yes" }, "dialog-1"),
        result: { action: "accept", handled: true, message: "Hello", type: "prompt" },
      },
      {
        request: createRequest("clipboard", { action: "write", text: "Copied" }, "clipboard-1"),
        result: { action: "write", ok: true },
      },
      {
        request: createRequest("cookies", { action: "set", url: "https://example.test/", name: "sid", value: "1" }, "cookies-1"),
        result: {
          action: "set",
          ok: true,
          cookie: { name: "sid", value: "1", domain: "example.test", path: "/" },
        },
      },
      {
        request: createRequest("storage", { area: "local", action: "set", key: "phase", value: "8" }, "storage-1"),
        result: { area: "local", action: "set", ok: true },
      },
      {
        request: createRequest("network", { action: "list", urlGlob: "example.test" }, "network-1"),
        result: {
          action: "list",
          ok: true,
          requests: [{ id: "1", url: "https://example.test/api", method: "GET", statusCode: 200 }],
        },
      },
      {
        request: createRequest("console", { action: "list" }, "console-1"),
        result: {
          action: "list",
          ok: true,
          entries: [{ level: "log", text: "ready", timestamp: 1 }],
          truncated: true,
          droppedEntries: 4,
        },
      },
      {
        request: createRequest("errors", { action: "list" }, "errors-1"),
        result: {
          action: "list",
          ok: true,
          errors: [{ level: "error", text: "boom", timestamp: 1 }],
          truncated: false,
          droppedEntries: 0,
        },
      },
      {
        request: createRequest("highlight", { selector: "#save", durationMs: 1000 }, "highlight-1"),
        result: { ok: true, element },
      },
      {
        request: createRequest("pdf", { path: "/tmp/page.pdf" }, "pdf-1"),
        result: { path: "/tmp/page.pdf" },
      },
      {
        request: createRequest("set.viewport", { width: 1200, height: 800 }, "viewport-1"),
        result: { window: { ...window, width: 1200, height: 800 } },
      },
      {
        request: createRequest("diff", { kind: "title", expected: "Expected title" }, "diff-1"),
        result: {
          kind: "title",
          expected: "Expected title",
          actual: "Actual title",
          matches: false,
        },
      },
    ];

    for (const { request, result } of cases) {
      expect(parseBoundaryRequest("host-to-extension", request)).toEqual({
        ok: true,
        value: request,
      });
      expect(
        parseBoundaryResponse("host-to-extension", request.command, {
          protocolVersion: request.protocolVersion,
          id: request.id,
          ok: true,
          result,
        }),
      ).toMatchObject({ ok: true });
    }

    expect(
      parseBoundaryRequest("host-to-extension", {
        protocolVersion: PROTOCOL_VERSION,
        id: "upload-invalid",
        command: "upload",
        params: { selector: "input[type=file]", files: [] },
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ENVELOPE" } });
  });

  it("enforces upload decoded byte limits on requests and batches", () => {
    const halfTotal = Math.floor(MAX_UPLOAD_TOTAL_BYTES / 2) + 1;
    const validUpload = createRequest(
      "upload",
      {
        selector: "input[type=file]",
        files: [
          { name: "one.bin", dataBase64: uploadData(MAX_UPLOAD_FILE_BYTES) },
          {
            name: "two.bin",
            dataBase64: uploadData(MAX_UPLOAD_TOTAL_BYTES - MAX_UPLOAD_FILE_BYTES),
          },
        ],
      },
      "upload-valid-limit",
    );
    expect(parseBoundaryRequest("host-to-extension", validUpload)).toMatchObject({ ok: true });

    for (const params of [
      {
        selector: "input[type=file]",
        files: [{ name: "bad.bin", dataBase64: "not_base64!" }],
      },
      {
        selector: "input[type=file]",
        files: [{ name: "too-large.bin", dataBase64: uploadData(MAX_UPLOAD_FILE_BYTES + 1) }],
      },
      {
        selector: "input[type=file]",
        files: [
          { name: "one.bin", dataBase64: uploadData(halfTotal) },
          { name: "two.bin", dataBase64: uploadData(halfTotal) },
        ],
      },
    ]) {
      expect(
        parseBoundaryRequest("host-to-extension", {
          protocolVersion: PROTOCOL_VERSION,
          id: "upload-byte-invalid",
          command: "upload",
          params,
        }),
      ).toMatchObject({ ok: false, error: { code: "INVALID_ENVELOPE" } });
    }

    expect(
      parseBoundaryRequest("host-to-extension", {
        protocolVersion: PROTOCOL_VERSION,
        id: "batch-upload-byte-invalid",
        command: "batch",
        params: {
          steps: [
            {
              command: "upload",
              params: {
                selector: "input[type=file]",
                files: [{ name: "one.bin", dataBase64: uploadData(halfTotal) }],
              },
            },
            {
              command: "upload",
              params: {
                selector: "input[type=file]",
                files: [{ name: "two.bin", dataBase64: uploadData(halfTotal) }],
              },
            },
          ],
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ENVELOPE" } });
  });
});
