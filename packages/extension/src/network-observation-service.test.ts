import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05 } from "./network-observation-service-test-cases.js";

describe("NetworkObservationService", () => {
  it("registers webRequest listeners only for the observed tab", runCase01);
  it("retains observations briefly and prunes inactive tab state on timer expiry", runCase02);
  it("keeps observations alive while target requests are active", runCase03);
  it("can release empty observations immediately for clear operations", runCase04);
  it("disposes all observed tab listeners", runCase05);
});
