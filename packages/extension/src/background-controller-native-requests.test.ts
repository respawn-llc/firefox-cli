import { describe, it } from "vitest";
import {
  runCase01,
  runCase02,
  runCase03,
  runCase04,
  runCase05,
  runCase06,
  runCase07,
  runCase08,
  runCase09,
} from "./background-controller-native-requests-test-cases.js";

describe("FirefoxCliBackgroundController", () => {
  it("preserves approved privilege-sensitive native-host command execution", runCase01);
  it("rejects native-host requests before protocol negotiation completes", runCase02);
  it("records incompatible native-host protocol state after no-overlap hello response", runCase03);
  it("updates popup-facing approval and reset states", runCase04);
  it("restores approval state from extension storage", runCase05);
  it("preserves stored pair tokens when hello reports invalid native-host pair state", runCase06);
  it("reports disconnects actionably", runCase07);
  it("resolves pending popup approval when the native host disconnects", runCase08);
  it("resolves pending popup approval when native host responses time out", runCase09);
});
