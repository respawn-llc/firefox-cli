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
  runCase10,
} from "./browser-commands-targets-test-cases.js";

describe("browser command handling", () => {
  it("routes element state checks to the resolved tab content script and adds target metadata", runCase01);
  it("handles duration waits without content injection or browser mutation", runCase02);
  it("waits for URL globs against the resolved tab without content injection", runCase03);
  it("preserves URL wait question-mark wildcard glob semantics", runCase04);
  it("routes document waits to content script and adds target metadata", runCase05);
  it("runs function waits through main-world eval instead of content-script eval", runCase06);
  it("waits for network idle through the background network tracker", runCase07);
  it("uses the resolved target tab for network-idle waits", runCase08);
  it("lists and clears network requests for the resolved target tab only", runCase09);
  it("runs eval in the resolved tab main world and adds target metadata", runCase10);
});
