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
  runCase11,
  runCase12,
  runCase13,
} from "./browser-commands-test-cases.js";

describe("browser command handling", () => {
  it("has browser handlers for every extension-owned command routed past background control", runCase01);
  it("rejects page-scoped commands when host approval was revoked", runCase02);
  it("lists tabs for the focused window using deterministic window ordering", runCase03);
  it("selects a tab by Firefox ID across windows", runCase04);
  it("navigates the resolved active tab without creating a hidden browser session", runCase05);
  it("creates a new tab in the selected window", runCase06);
  it("rejects private-window mutations unless a command is a list command", runCase07);
  it("rejects new-tab and window mutations in private windows", runCase08);
  it("routes snapshots to the resolved tab content script and adds target metadata", runCase09);
  it("uses local protocol version for same-extension content-script messages", runCase10);
  it("routes ref resolution to the same tab content registry across CLI invocations", runCase11);
  it("gets tab title and URL from resolved target metadata without content injection", runCase12);
  it("routes element getters to the resolved tab content script and adds target metadata", runCase13);
});
