import { describe, expect, it } from "vitest";
import { commandRequiresExtensionHostAccess, getCommandFrameScopeMetadata, getCommandSecurityMetadata, getExtensionPermissionRequirements } from "./index.js";

describe("protocol command metadata", () => {
  it("documents frame-scope support in command metadata", () => {
    expect(getCommandFrameScopeMetadata("snapshot")).toEqual({
      scope: "main-frame-with-iframe-diagnostics",
      reason: "Snapshot refs are generated for the main frame; iframe entries are diagnostic/read-only.",
      future: "docs/iframe-targeting-future.md",
    });
    expect(getCommandFrameScopeMetadata("frame")).toEqual({
      scope: "main-frame-with-iframe-diagnostics",
      reason: "The frame command lists iframe diagnostics from the main frame only.",
      future: "docs/iframe-targeting-future.md",
    });
    expect(getCommandFrameScopeMetadata("click")).toEqual({
      scope: "main-frame-only",
      reason: "This command runs in the resolved tab's main frame; iframe targeting is not implemented.",
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

  it("derives extension permission requirements from command metadata", () => {
    const requirements = getExtensionPermissionRequirements();

    expect(requirements.firefoxStrictMinVersion).toBe("150.0");
    expect(requirements.manifestPermissions).toEqual([
      "clipboardRead",
      "clipboardWrite",
      "cookies",
      "downloads",
      "nativeMessaging",
      "scripting",
      "storage",
      "tabs",
      "webRequest",
    ]);
    expect(requirements.hostPermissions).toEqual(["<all_urls>"]);
    expect(requirements.popupApprovalOrigins).toEqual(["<all_urls>"]);
    expect(requirements.webRequestListenerOrigins).toEqual(["<all_urls>"]);
    expect(requirements.dataCollection).toEqual({
      required: ["browsingActivity", "websiteActivity", "websiteContent"],
      optional: [],
    });

    expect(getCommandSecurityMetadata("click")).toEqual({
      level: "sensitive",
      reasons: ["page-mutation"],
    });
    expect(commandRequiresExtensionHostAccess("click")).toBe(true);
    expect(commandRequiresExtensionHostAccess("download")).toBe(false);
    expect(requirements.commands.find((requirement) => requirement.command === "network")).toMatchObject({
      securityReasons: ["network-observation"],
      manifestPermissions: ["webRequest"],
      networkObservation: true,
    });
  });
});
