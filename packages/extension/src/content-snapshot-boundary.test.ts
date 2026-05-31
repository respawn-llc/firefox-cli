import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05 } from "./content-snapshot-boundary-test-cases.js";

describe("content snapshot", () => {
  it("resolves refs created by an earlier content request", runCase01);
  it("gets text, html, value, attr, count, box, and styles by selector or ref", runCase02);
  it("checks visible, enabled, and checked state by selector or ref", runCase03);
  it("checks element state by ref", runCase04);
  it("rejects checked state for non-checkable elements", runCase05);
});
