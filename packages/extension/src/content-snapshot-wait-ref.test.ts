import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05, runCase06 } from "./content-snapshot-wait-ref-test-cases.js";

describe("content snapshot", () => {
  it("returns REF_NOT_FOUND after dynamic DOM replacement keeps the same selector", runCase01);
  it("reports iframe diagnostics without actionable iframe refs", runCase02);
  it("emits valid iframe diagnostic selectors for unsafe id and name values", runCase03);
  it("finds elements by Phase 8 locators and lists frames through the command boundary", runCase04);
  it("handles clipboard, storage, dialog status, logs, errors, and highlight commands", runCase05);
  it("cleans up timed highlights without mutating non-target elements", runCase06);
});
