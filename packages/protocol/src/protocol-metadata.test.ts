import { describe, expect, it } from "vitest";
import { getCommandFrameScopeMetadata } from "./index.js";

describe("protocol command metadata", () => {
  it("documents frame-scope support in command metadata", () => {
    expect(getCommandFrameScopeMetadata("snapshot")).toEqual({
      scope: "main-frame-with-iframe-diagnostics",
      reason:
        "Snapshot refs are generated for the main frame; iframe entries are diagnostic/read-only.",
      future: "docs/iframe-targeting-future.md",
    });
    expect(getCommandFrameScopeMetadata("frame")).toEqual({
      scope: "main-frame-with-iframe-diagnostics",
      reason: "The frame command lists iframe diagnostics from the main frame only.",
      future: "docs/iframe-targeting-future.md",
    });
    expect(getCommandFrameScopeMetadata("click")).toEqual({
      scope: "main-frame-only",
      reason:
        "This command runs in the resolved tab's main frame; iframe targeting is not implemented.",
      future: "docs/iframe-targeting-future.md",
    });
    expect(getCommandFrameScopeMetadata("eval")).toEqual({
      scope: "main-frame-only",
      reason: "Eval runs in the resolved tab's main frame; iframe targeting is not implemented.",
      future: "docs/iframe-targeting-future.md",
    });
    expect(getCommandFrameScopeMetadata("tabs.list")).toEqual({
      scope: "not-applicable",
      reason: "This command does not execute inside a page frame.",
    });
  });
});
