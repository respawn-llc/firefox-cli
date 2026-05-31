import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05, runCase06, runCase07 } from "./content-snapshot-logs-test-cases.js";

describe("content snapshot", () => {
  it("starts content runtime explicitly, captures before registering messages, and disposes scoped listeners", runCase01);
  it("keeps duplicate content runtime starts idempotent and preserves refs until explicit dispose", runCase02);
  it("restores and reinstalls console capture without replacing buffers", runCase03);
  it("keeps global log capture installed until the last scoped handle is disposed", runCase04);
  it("restores target window error listeners and reinstalls without duplicate captures", runCase05);
  it("keeps window log capture installed until the last scoped handle is disposed", runCase06);
  it("returns an async protocol envelope for browser.tabs.sendMessage", runCase07);
});
