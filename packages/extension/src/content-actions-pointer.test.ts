import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05, runCase06, runCase07 } from "./content-actions-pointer-test-cases.js";

describe("content actions", () => {
  it("rejects oversized uploads before assigning files or dispatching change", runCase01);
  it("fills editable controls and rejects disabled or non-editable elements", runCase02);
  it("types into targeted and focused editable elements", runCase03);
  it("presses keys on the focused element and rejects missing focus", runCase04);
  it("checks and unchecks checkable elements", runCase05);
  it("selects options and reports missing values", runCase06);
  it("scrolls elements, scrolls elements into view, and keeps stale refs as REF_NOT_FOUND", runCase07);
});
