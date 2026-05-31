import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  createOkResponse,
  createRequest,
  mergeDisjointHandlerMaps,
  parseBoundaryRequest,
  parseBoundaryResponse,
  parseBatchStepAs,
  parseBatchStepResultAs,
  safeParseStrictCommandParams,
} from "./index.js";
import { boundaries } from "./protocol-test-support.js";

describe("parseBoundaryResponse", () => {
  it("parses command-correlated batch steps and results", () => {
    expect(safeParseStrictCommandParams("tab.close", {}).success).toBe(false);

    expect(
      parseBatchStepAs("tab.close", {
        command: "tab.close",
        params: {},
      }),
    ).toMatchObject({
      ok: true,
      value: {
        command: "tab.close",
        params: {
          target: {
            window: { kind: "active" },
            tab: { kind: "active" },
          },
        },
      },
    });

    expect(
      parseBatchStepResultAs("screenshot", {
        index: 0,
        command: "screenshot",
        ok: true,
        result: {
          path: "/tmp/page.png",
          format: "png",
          bytes: 68,
          activation: {
            tabActivated: false,
            windowFocused: false,
          },
          imageBase64: "iVBORw0KGgo=",
        },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        command: "screenshot",
        ok: true,
        result: {
          path: "/tmp/page.png",
          format: "png",
        },
      },
    });

    expect(
      parseBatchStepAs("screenshot", {
        command: "snapshot",
        params: {},
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ENVELOPE" } });
    expect(
      parseBatchStepResultAs("screenshot", {
        index: 0,
        command: "snapshot",
        ok: true,
        result: {
          generationId: "g1",
          text: "",
          refs: 0,
          truncated: false,
          frames: [],
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_RESPONSE" } });
  });

  it("rejects duplicate merged command handler maps", () => {
    expect(() => mergeDisjointHandlerMaps({ noop: "first" }, { noop: "second" })).toThrow("Duplicate command handler: noop");
  });

  it("validates interaction responses and rejects malformed action contracts", () => {
    const click = createRequest("click", { selector: "button" }, "click-1");
    expect(
      parseBoundaryResponse(
        "extension-to-content-script",
        "click",
        createOkResponse(click, {
          action: "click",
          ok: true,
          element: {
            tagName: "button",
            role: "button",
            visible: true,
          },
        }),
      ),
    ).toMatchObject({ ok: true });

    for (const response of [
      {
        protocolVersion: PROTOCOL_VERSION,
        id: click.id,
        ok: true,
        result: {
          action: "fill",
          ok: true,
        },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: click.id,
        ok: true,
        result: {
          action: "click",
          ok: true,
          selectedValues: ["wrong"],
          element: {
            tagName: "button",
            role: "button",
            visible: true,
          },
        },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: click.id,
        ok: true,
        result: {
          action: "click",
          ok: true,
        },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: click.id,
        ok: true,
        result: {
          action: "click",
          ok: true,
          element: {
            ref: "@e1",
            tagName: "button",
            role: "button",
            visible: true,
          },
        },
      },
    ]) {
      const parsed = parseBoundaryResponse("extension-to-content-script", "click", response);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_RESPONSE");
      }
    }
  });

  it("rejects invalid interaction params", () => {
    for (const [command, params] of [
      ["click", {}],
      ["click", { selector: "button", ref: "@e1" }],
      ["click", { selector: "button", generationId: "g1" }],
      ["fill", { selector: "input" }],
      ["press", { key: "" }],
      ["select", { selector: "select", values: [] }],
      ["scroll", { direction: "north" }],
      ["scroll", { selector: "#feed", ref: "@e1", direction: "down" }],
      ["scroll", { direction: "down", generationId: "g1" }],
    ] as const) {
      const parsed = parseBoundaryRequest("host-to-extension", {
        protocolVersion: PROTOCOL_VERSION,
        id: `${command}-invalid`,
        command,
        params,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_ENVELOPE");
      }
    }
  });

  it.each(boundaries)("rejects invalid successful result payloads across %s", (boundary) => {
    const parsed = parseBoundaryResponse(boundary, "capabilities", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      ok: true,
      result: {},
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_RESPONSE");
    }
  });

  it.each(boundaries)("validates structured error responses across %s", (boundary) => {
    const parsed = parseBoundaryResponse(boundary, "noop", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      ok: false,
      error: {
        code: "UNSUPPORTED_CAPABILITY",
        message: "Not implemented.",
      },
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        protocolVersion: PROTOCOL_VERSION,
        id: "request-1",
        ok: false,
        error: {
          code: "UNSUPPORTED_CAPABILITY",
          message: "Not implemented.",
        },
      },
    });
  });

  it.each(boundaries)("rejects malformed error responses across %s", (boundary) => {
    const parsed = parseBoundaryResponse(boundary, "noop", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      ok: false,
      error: {
        message: "Missing code.",
      },
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_RESPONSE");
    }
  });

  it.each(boundaries)("rejects extra response envelope fields across %s", (boundary) => {
    const parsed = parseBoundaryResponse(boundary, "noop", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      ok: true,
      result: {
        ok: true,
      },
      surprise: true,
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_RESPONSE");
    }
  });
});
