import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05 } from "./background-controller-approval-test-cases.js";

describe("FirefoxCliBackgroundController", () => {
  it("ignores responses that arrive after request timeout", runCase01);
  it("reconnects with bounded backoff after native-host disconnect", runCase02);
  it("clears incompatible protocol state on reconnect", runCase03);
  it("stops controller effects, drains pending requests, and ignores stale native messages", runCase04);
  it("suppresses reconnect callbacks after stop", runCase05);
});
