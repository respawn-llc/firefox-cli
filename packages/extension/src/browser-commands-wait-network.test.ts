import { describe, it } from "vitest";
import { runCase02, runCase03, runCase04, runCase05, runCase06, runCase07, runCase08, runCase09 } from "./browser-commands-wait-network-test-cases.js";

describe("browser command handling", () => {
  it("keeps log truncation metadata in current-protocol browser responses", runCase02);
  it("rejects private-window interactions for every action command", runCase03);
  it("returns TIMEOUT for unsatisfied URL waits", runCase04);
  it("returns TIMEOUT when browser wait target resolution does not answer", runCase05);
  it("maps restricted-page getter injection failures to actionable errors", runCase06);
  it("maps content-script injection failures to actionable errors", runCase07);
  it("surfaces classified content-script delivery failures", runCase08);
  it("surfaces stale content-script version mismatches without treating them as injection failures", runCase09);
});
