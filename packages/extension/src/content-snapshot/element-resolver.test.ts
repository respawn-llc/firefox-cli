import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05 } from "./element-resolver-test-cases.js";

describe("content element resolver", () => {
  it("centralizes selector validation and required/optional target errors", runCase01);
  it("preserves ref and generation metadata while surfacing stale refs", runCase02);
  it("uses role-specific drag target diagnostics", runCase03);
  it("keeps hidden waits matched when selector targets are missing", runCase04);
  it("keeps action drag commands on the shared resolver path", runCase05);
});
