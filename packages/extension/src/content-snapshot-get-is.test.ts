import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05, runCase06, runCase07, runCase08, runCase09 } from "./content-snapshot-get-is-test-cases.js";

describe("content snapshot", () => {
  it("rejects wrong-boundary privileged browser commands in the content router", runCase01);
  it("truncates large get text results deterministically", runCase02);
  it("keeps truncated get text output within very small byte limits", runCase03);
  it("returns SELECTOR_NOT_FOUND for get selector misses", runCase04);
  it("waits for element state, visible text, load state, and function predicates", runCase05);
  it("returns TIMEOUT for unsatisfied content waits", runCase06);
  it("keeps stale refs as REF_NOT_FOUND even for hidden waits", runCase07);
  it("returns REF_NOT_FOUND when resolving an unknown ref", runCase08);
  it("returns REF_NOT_FOUND when a ref element was detached from the document", runCase09);
});
