import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05, runCase06, runCase07, runCase08, runCase09 } from "./content-snapshot-test-cases.js";

describe("content snapshot", () => {
  it("emits compact interactive refs with accessible names", runCase01);
  it("covers fixture controls while excluding disabled and hidden controls from interactive refs", runCase02);
  it("resolves explicit labels for CSS-special and control IDs without selector fallback", runCase03);
  it("escapes CSS string selector values for iframe diagnostics", runCase04);
  it("emits scrollable containers as interactive refs for scroll commands", runCase05);
  it("keeps intrinsic control roles for scrollable controls", runCase06);
  it("emits labelled verbose fields when compact mode is disabled", runCase07);
  it("returns selector errors through the content request boundary", runCase08);
  it("expires stale refs with re-snapshot guidance", runCase09);
});
