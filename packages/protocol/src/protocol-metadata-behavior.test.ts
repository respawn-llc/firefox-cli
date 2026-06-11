import { describe, expect, it } from "vitest";
import {
  actionKinds,
  commandAcceptsBatchTimeout,
  commandAcceptsExtensionBatchDefaultTarget,
  commandAcceptsProtocolBatchDefaultTarget,
  commandSchemas,
  createRequestProtocolMismatchError,
  createRequest,
  gatedCapabilities,
  getCliRouteEntries,
  getRequestProtocolCompatibility,
  getCliRoutes,
  getCommandCliRoutes,
  getCommandCompatibilityMetadata,
  getCommandSecurityMetadata,
  getRequestProtocolRequirement,
  isActionCommand,
  isBatchableCommandId,
  isContentCommand,
  isPrivilegeSensitiveCommand,
  isPrivilegeSensitiveRequest,
  kernelCapabilities,
  parseBoundaryRequest,
} from "./index.js";
import { commandIds, sorted, expectedCliRoutesByCommand } from "./protocol-test-support.js";

describe("protocol command metadata", () => {
  it("uses unique CLI route ids and paths", () => {
    const routes = getCliRoutes();
    const routeEntries = getCliRouteEntries();
    const expectedRoutes = commandIds().flatMap((command) => expectedCliRoutesByCommand[command] ?? []);
    const expectedRouteEntries = commandIds().flatMap((command) => (expectedCliRoutesByCommand[command] ?? []).map((route) => ({ command, route })));
    const routeIds = routes.map((route) => route.id);
    const routePaths = routes.map((route) => route.path.join("\0"));

    for (const command of commandIds()) {
      expect(getCommandCliRoutes(command)).toEqual(expectedCliRoutesByCommand[command] ?? []);
    }
    expect(routes).toEqual(expectedRoutes);
    expect(routeEntries).toEqual(expectedRouteEntries);
    expect(new Set(routeIds).size).toBe(routeIds.length);
    expect(new Set(routePaths).size).toBe(routePaths.length);
    expect(routes.every((route) => route.path.length > 0)).toBe(true);
    expect(routes.every((route) => route.path.every((segment) => segment.length > 0))).toBe(true);
  });

  it("includes all command statuses and gated capabilities in kernel capabilities", () => {
    for (const command of commandIds()) {
      expect(kernelCapabilities).toContainEqual({
        command,
        status: commandSchemas[command].status,
      });
    }

    for (const capability of gatedCapabilities) {
      expect(kernelCapabilities).toContainEqual({
        command: capability.command,
        status: capability.status,
        reason: capability.reason,
      });
    }
  });

  it("uses metadata for batchability", () => {
    for (const command of commandIds()) {
      expect(isBatchableCommandId(command)).toBe(commandSchemas[command].batch.allowed);
    }

    const nonBatchableCommands = commandIds().filter((command) => !isBatchableCommandId(command));
    expect(nonBatchableCommands).toEqual(["hello", "capabilities", "noop", "batch", "pair.approve", "pair.reset", "pair.requestApproval", "pair.openApproval"]);
  });

  it("marks only required tab/window selectors for protocol batch default targets", () => {
    const protocolDefaultCommands = commandIds().filter(commandAcceptsProtocolBatchDefaultTarget);

    expect(protocolDefaultCommands).toEqual(["tab.select", "tab.close", "window.select", "window.close"]);
  });

  it("marks extension batch default target commands", () => {
    const extensionDefaultCommands = commandIds().filter(commandAcceptsExtensionBatchDefaultTarget);

    expect(extensionDefaultCommands).toEqual([
      "tabs.list",
      "tab.new",
      "tab.select",
      "tab.close",
      "window.select",
      "window.close",
      "open",
      "back",
      "forward",
      "reload",
      "snapshot",
      "ref.resolve",
      "get",
      "is",
      "wait",
      "eval",
      "screenshot",
      "drag",
      "upload",
      "mouse",
      "keydown",
      "keyup",
      "find",
      "frame",
      "dialog",
      "clipboard",
      "storage",
      "network",
      "console",
      "errors",
      "highlight",
      "set.viewport",
      "diff",
      "click",
      "dblclick",
      "focus",
      "hover",
      "fill",
      "type",
      "press",
      "keyboard.type",
      "keyboard.inserttext",
      "check",
      "uncheck",
      "select",
      "scroll",
      "scrollintoview",
      "swipe",
    ]);
  });

  it("keeps actionKinds aligned with action command metadata", () => {
    const actionCommands = commandIds().filter((command) => commandSchemas[command].action);

    for (const command of commandIds()) {
      expect(isActionCommand(command)).toBe(commandSchemas[command].action);
    }
    expect(sorted(actionKinds)).toEqual(sorted(actionCommands));
  });

  it("identifies every command with content-script policy", () => {
    const contentCommands = commandIds().filter((command) => commandSchemas[command].content !== "never");
    const helperCommands = commandIds().filter(isContentCommand);

    expect(sorted(helperCommands)).toEqual(sorted(contentCommands));
  });

  it("marks timeout-rebased batch commands", () => {
    const timeoutRebaseCommands = commandIds().filter(commandAcceptsBatchTimeout);

    expect(timeoutRebaseCommands).toEqual(["wait", "eval", "screenshot"]);
  });

  it("marks privilege-sensitive commands and request shapes explicitly", () => {
    const sensitiveCommands = commandIds().filter(isPrivilegeSensitiveCommand);

    expect(sensitiveCommands).toEqual([
      "wait",
      "eval",
      "drag",
      "upload",
      "mouse",
      "keydown",
      "keyup",
      "download",
      "clipboard",
      "cookies",
      "network",
      "notify",
      "click",
      "dblclick",
      "focus",
      "hover",
      "fill",
      "type",
      "press",
      "keyboard.type",
      "keyboard.inserttext",
      "check",
      "uncheck",
      "select",
      "scroll",
      "scrollintoview",
      "swipe",
    ]);
    expect(getCommandSecurityMetadata("eval")).toEqual({
      level: "sensitive",
      reasons: ["page-code-execution"],
    });
    expect(getCommandSecurityMetadata("click")).toEqual({
      level: "sensitive",
      reasons: ["page-mutation"],
    });

    expect(isPrivilegeSensitiveRequest(createRequest("wait", { kind: "element", selector: "#main" }))).toBe(false);
    expect(isPrivilegeSensitiveRequest(createRequest("wait", { kind: "function", expression: "1" }))).toBe(true);
    expect(isPrivilegeSensitiveRequest(createRequest("wait", { kind: "load-state", state: "networkidle" }))).toBe(true);
  });
});

describe("request protocol compatibility", () => {
  it("derives command protocol requirements from registry metadata", () => {
    expect(getCommandCompatibilityMetadata("network")).toEqual({
      requirements: [
        {
          minProtocolVersion: 2,
          reason: "Network commands are scoped to the resolved tab.",
        },
      ],
    });
    expect(getRequestProtocolRequirement(createRequest("network", { action: "list" }))).toEqual({
      minProtocolVersion: 2,
      reason: "Network commands are scoped to the resolved tab.",
    });
    expect(getRequestProtocolRequirement(createRequest("wait", { kind: "load-state", state: "networkidle" }))).toEqual({
      minProtocolVersion: 2,
      reason: "Network-idle waits are scoped to the resolved tab.",
      params: {
        matches: [
          { path: ["kind"], equals: "load-state" },
          { path: ["state"], equals: "networkidle" },
        ],
      },
    });
    expect(getRequestProtocolRequirement(createRequest("wait", { kind: "load-state", state: "complete" }))).toBeUndefined();
  });

  it("requires protocol v2 for scoped network semantics", () => {
    const network = createRequest("network", { action: "list" }, "network-v2");
    const networkIdle = createRequest("wait", { kind: "load-state", state: "networkidle" }, "networkidle-v2");
    const batch = createRequest(
      "batch",
      {
        steps: [
          { command: "snapshot", params: {} },
          { command: "network", params: { action: "clear" } },
        ],
      },
      "batch-v2",
    );

    for (const request of [network, networkIdle, batch]) {
      expect(getRequestProtocolCompatibility(request, 1)).toMatchObject({
        compatible: false,
        requiredProtocolVersion: 2,
      });
      expect(parseBoundaryRequest("host-to-extension", { ...request, protocolVersion: 1 }, { protocolVersion: 1 })).toMatchObject({
        ok: false,
        error: {
          code: "VERSION_MISMATCH",
          details: {
            requiredProtocolVersion: 2,
            negotiatedProtocolVersion: 1,
          },
        },
      });
      expect(parseBoundaryRequest("host-to-extension", { ...request, protocolVersion: 2 }, { protocolVersion: 2 })).toMatchObject({
        ok: true,
      });
    }
  });

  it("requires protocol v4 for CLI approval requests", () => {
    const request = createRequest("pair.requestApproval", {}, "approval-v4");

    expect(getRequestProtocolCompatibility(request, 3)).toMatchObject({
      compatible: false,
      requiredProtocolVersion: 4,
    });
    expect(parseBoundaryRequest("host-to-extension", { ...request, protocolVersion: 3 }, { protocolVersion: 3 })).toMatchObject({
      ok: false,
      error: {
        code: "VERSION_MISMATCH",
        details: {
          requiredProtocolVersion: 4,
          negotiatedProtocolVersion: 3,
        },
      },
    });
    expect(parseBoundaryRequest("host-to-extension", { ...request, protocolVersion: 4 }, { protocolVersion: 4 })).toMatchObject({
      ok: true,
    });
  });

  it("keeps non-network commands compatible with protocol v1 sessions", () => {
    const request = createRequest("capabilities", {}, "capabilities-v1", 1);

    expect(getRequestProtocolCompatibility(request, 1)).toEqual({
      compatible: true,
      requiredProtocolVersion: 1,
    });
    expect(createRequestProtocolMismatchError(createRequest("network", { action: "list" }), 1)).toMatchObject({
      code: "VERSION_MISMATCH",
      details: {
        requiredProtocolVersion: 2,
        negotiatedProtocolVersion: 1,
      },
    });
  });
});
