import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, createOkResponse, createRequest, parseBoundaryRequest, parseBoundaryResponse } from "./index.js";

describe("parseBoundaryResponse", () => {
  it("validates eval responses with JSON values and undefined markers", () => {
    const json = createRequest("eval", { script: "({ ready: true })", source: "argv" }, "eval-1");
    const undefinedValue = createRequest("eval", { script: "let value = 1;", source: "stdin" }, "eval-2");

    expect(
      parseBoundaryResponse(
        "host-to-extension",
        "eval",
        createOkResponse(json, {
          value: {
            type: "json",
            value: {
              ready: true,
              items: [1, "two", null],
            },
          },
          elapsedMs: 7,
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseBoundaryResponse(
        "host-to-extension",
        "eval",
        createOkResponse(undefinedValue, {
          value: { type: "undefined" },
          elapsedMs: 1,
        }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("rejects invalid eval params and malformed eval results", () => {
    for (const params of [
      { script: "", source: "argv" },
      { script: "1", source: "file" },
      { script: "1", source: "argv", timeoutMs: 0 },
      { script: "1", source: "argv", maxResultBytes: 900_001 },
      { script: "x".repeat(100_001), source: "argv" },
    ]) {
      const parsed = parseBoundaryRequest("host-to-extension", {
        protocolVersion: PROTOCOL_VERSION,
        id: "eval-invalid",
        command: "eval",
        params,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_ENVELOPE");
      }
    }

    const request = createRequest("eval", { script: "1", source: "argv" }, "eval-1");
    for (const result of [
      {
        value: 1,
        elapsedMs: 1,
      },
      {
        value: { type: "json", value: undefined },
        elapsedMs: 1,
      },
      {
        value: { type: "undefined", value: null },
        elapsedMs: 1,
      },
      {
        value: { type: "json", value: Number.NaN },
        elapsedMs: 1,
      },
      {
        value: { type: "json", value: true },
        elapsedMs: -1,
      },
    ]) {
      const parsed = parseBoundaryResponse("host-to-extension", "eval", {
        protocolVersion: PROTOCOL_VERSION,
        id: request.id,
        ok: true,
        result,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_RESPONSE");
      }
    }
  });

  it("validates screenshot responses and rejects malformed screenshot contracts", () => {
    const request = createRequest("screenshot", { path: "/tmp/page.png", format: "png" }, "screenshot-1");

    expect(
      parseBoundaryResponse(
        "host-to-extension",
        "screenshot",
        createOkResponse(request, {
          path: "/tmp/page.png",
          format: "png",
          bytes: 68,
          width: 1,
          height: 1,
          activation: {
            tabActivated: false,
            windowFocused: false,
          },
          imageBase64: "iVBORw0KGgo=",
        }),
      ),
    ).toMatchObject({ ok: true });

    expect(
      parseBoundaryResponse(
        "cli-to-host",
        "screenshot",
        createOkResponse(request, {
          path: "/tmp/page.png",
          format: "png",
          bytes: 68,
          activation: {
            tabActivated: false,
            windowFocused: false,
          },
        }),
      ),
    ).toMatchObject({ ok: true });

    expect(
      parseBoundaryRequest(
        "host-to-extension",
        createRequest(
          "screenshot",
          {
            path: "/tmp/page.jpg",
            format: "jpeg",
            fullPage: true,
            quality: 80,
          },
          "screenshot-jpeg",
        ),
      ),
    ).toMatchObject({ ok: true });

    for (const params of [
      { path: "", format: "png" },
      { path: "/tmp/page.png", format: "png", quality: 80 },
      { path: "/tmp/page.png", format: "png", timeoutMs: 0 },
      { path: "/tmp/page.png", format: "png", maxImageBytes: 8_000_001 },
    ]) {
      const parsed = parseBoundaryRequest("host-to-extension", {
        protocolVersion: PROTOCOL_VERSION,
        id: "screenshot-invalid",
        command: "screenshot",
        params,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_ENVELOPE");
      }
    }

    for (const result of [
      {
        path: "/tmp/page.png",
        format: "png",
        bytes: -1,
        activation: {
          tabActivated: false,
          windowFocused: false,
        },
      },
      {
        path: "/tmp/page.png",
        format: "png",
        bytes: 1,
        activation: {
          tabActivated: "false",
          windowFocused: false,
        },
      },
      {
        path: "/tmp/page.png",
        format: "webp",
        bytes: 1,
        activation: {
          tabActivated: false,
          windowFocused: false,
        },
      },
    ]) {
      const parsed = parseBoundaryResponse("host-to-extension", "screenshot", {
        protocolVersion: PROTOCOL_VERSION,
        id: request.id,
        ok: true,
        result,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_RESPONSE");
      }
    }
  });
});
