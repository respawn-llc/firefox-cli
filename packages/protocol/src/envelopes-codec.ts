import { boundarySchema, type Boundary, type ParseResult } from "./core.js";
import { failure } from "./parse-failure.js";

export function decodeRaw(raw: unknown): ParseResult<unknown> {
  if (typeof raw !== "string") {
    return { ok: true, value: raw };
  }

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return failure("INVALID_JSON", "Payload is not valid JSON.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function isKnownBoundary(boundary: Boundary): boolean {
  return boundarySchema.safeParse(boundary).success;
}
