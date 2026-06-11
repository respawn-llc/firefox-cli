import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05, runCase06, runCase07, runCase08 } from "./background-controller-test-cases.js";

describe("FirefoxCliBackgroundController", () => {
  it("connects to the native host and sends hello", runCase01);
  it("accepts valid hello responses regardless of request ID shape", runCase02);
  it("answers native-host capability and no-op requests", runCase03);
  it("lists tabs through the injected Firefox browser adapter", runCase04);
  it("rejects native-host requests before first-use approval", runCase05);
  it("opens the dedicated approval UI before first-use approval", runCase06);
  it("gates unapproved privilege-sensitive native-host requests before browser handlers", runCase07);
  it("rejects malformed sensitive native-host requests before browser handlers", runCase08);
});
