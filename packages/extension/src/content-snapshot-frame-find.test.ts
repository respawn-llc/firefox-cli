import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05, runCase06, runCase07 } from "./content-snapshot-frame-find-test-cases.js";

describe("content snapshot", () => {
  it("restores the previous highlighted element before highlighting another element", runCase01);
  it("preserves page-owned highlight field changes during cleanup and re-highlight", runCase02);
  it("handles persistent and timed highlight transitions deterministically", runCase03);
  it("captures explicitly installed console logs in the same buffer cleared by content commands", runCase04);
  it("rejects direct content handlers without installing implicit window log capture", runCase05);
  it("bounds error capture by retained entry count", runCase06);
  it("keeps the content snapshot facade side-effect free across cold imports", runCase07);
});
