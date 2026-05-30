import { describe, expect, it } from "vitest";
import { resolveReleaseSignedXpiPolicy } from "../release-policy.js";

describe("release signed-XPI policy", () => {
  it("requires signed provenance by default", () => {
    expect(resolveReleaseSignedXpiPolicy(["bun", "scripts/release-check.ts"], {})).toEqual({
      phase0Mode: false,
      requireSignedXpi: true,
      allowUnsignedLocal: false,
    });
  });

  it("allows an explicit non-release local override", () => {
    expect(
      resolveReleaseSignedXpiPolicy(
        ["bun", "scripts/release-check.ts", "--allow-unsigned-local"],
        {},
      ),
    ).toEqual({
      phase0Mode: false,
      requireSignedXpi: false,
      allowUnsignedLocal: true,
    });
  });

  it("gives signed release mode precedence over local override", () => {
    expect(
      resolveReleaseSignedXpiPolicy(["bun", "scripts/release-check.ts", "--allow-unsigned-local"], {
        FIREFOX_CLI_REQUIRE_SIGNED_XPI: "1",
      }),
    ).toMatchObject({
      requireSignedXpi: true,
      allowUnsignedLocal: false,
    });
  });
});
