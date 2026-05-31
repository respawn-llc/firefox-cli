import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05, runCase06 } from "./eval-executor-test-cases.js";

describe("eval executor", () => {
  it("evaluates expressions and serializes JSON-compatible values", runCase01);
  it("supports statements with explicit returns and undefined markers", runCase02);
  it("does not retry user code when runtime SyntaxError is thrown", runCase03);
  it("captures thrown errors with diagnostic details", runCase04);
  it("times out async work", runCase05);
  it("rejects non-serializable and oversized results", runCase06);
});
