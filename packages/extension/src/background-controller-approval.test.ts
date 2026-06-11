import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05, runCase06, runCase07, runCase08 } from "./background-controller-approval-test-cases.js";
import { runCase09, runCase10, runCase11 } from "./background-controller-approval-race-test-cases.js";

describe("FirefoxCliBackgroundController", () => {
  it("ignores responses that arrive after request timeout", runCase01);
  it("reconnects with bounded backoff after native-host disconnect", runCase02);
  it("clears incompatible protocol state on reconnect", runCase03);
  it("stops controller effects, drains pending requests, and ignores stale native messages", runCase04);
  it("suppresses reconnect callbacks after stop", runCase05);
  it("settles CLI approval requests when the user denies the dedicated page", runCase06);
  it("auto-denies repeated approval requests inside the extension rate limit", runCase07);
  it("rejects approval requests after approval with Firefox instance diagnostics", runCase08);
  it("exposes pending approval state before the approval tab finishes opening", runCase09);
  it("ignores deny events while native approval is in flight", runCase10);
  it("keeps legacy open-approval requests compatible with the dedicated page", runCase11);
});
