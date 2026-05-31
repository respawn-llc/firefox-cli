import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, parseBoundaryResponse } from "./index.js";
import { boundaries } from "./protocol-test-support.js";

describe("parseBoundaryResponse", () => {
  it.each(boundaries)("rejects success responses that also include errors across %s", (boundary) => {
    const parsed = parseBoundaryResponse(boundary, "noop", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      ok: true,
      result: {
        ok: true,
      },
      error: {
        code: "UNSUPPORTED_CAPABILITY",
        message: "Unexpected.",
      },
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_RESPONSE");
    }
  });

  it.each(boundaries)("rejects error responses that also include results across %s", (boundary) => {
    const parsed = parseBoundaryResponse(boundary, "noop", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      ok: false,
      error: {
        code: "UNSUPPORTED_CAPABILITY",
        message: "Expected.",
      },
      result: {
        ok: true,
      },
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_RESPONSE");
    }
  });
});
