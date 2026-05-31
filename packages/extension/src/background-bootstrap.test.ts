import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04 } from "./background-bootstrap-test-cases.js";

describe("background bootstrap", () => {
  it("registers runtime eagerly and webRequest listeners lazily by target tab", runCase01);
  it("preserves content injection and eval execution product contracts", runCase02);
  it("does not refresh content scripts when an existing script returns a structured mismatch", runCase03);
  it("does not inject content scripts for classified non-recoverable send failures", runCase04);
});
