import type { z } from "zod";

import type { CapabilityStatus } from "./core.js";

export type CommandOwner = "native-host" | "extension";
export type CommandTargetPolicy = "none" | "optional" | "required" | "mixed";
export type CommandContentPolicy = "never" | "always" | "mixed" | "action";
export type CommandTimeoutPolicy = "none" | "command" | "batch";
export type CommandPrivilegeReason =
  | "page-mutation"
  | "page-code-execution"
  | "page-function-evaluation"
  | "clipboard"
  | "downloads"
  | "cookies"
  | "network-observation";
export type CommandSecurityMetadata =
  | {
      readonly level: "normal";
      readonly reasons: readonly [];
    }
  | {
      readonly level: "sensitive";
      readonly reasons: readonly [CommandPrivilegeReason, ...CommandPrivilegeReason[]];
    }
  | {
      readonly level: "conditional";
      readonly reasons: readonly [CommandPrivilegeReason, ...CommandPrivilegeReason[]];
    };

export type CommandProtocolParameterMatch = {
  readonly path: readonly [string, ...string[]];
  readonly equals: string | number | boolean | null;
};

export type CommandProtocolRequirement = {
  readonly minProtocolVersion: number;
  readonly reason: string;
  readonly params?: {
    readonly matches: readonly [CommandProtocolParameterMatch, ...CommandProtocolParameterMatch[]];
  };
};

export type CommandCompatibilityMetadata = {
  readonly requirements: readonly CommandProtocolRequirement[];
};

export type CliRouteMetadata = {
  readonly id: string;
  readonly path: readonly [string, ...string[]];
  readonly batch: boolean;
};

export type CliRouteEntry<C extends string = string> = {
  readonly command: C;
  readonly route: CliRouteMetadata;
};

export type CommandBatchMetadata = {
  readonly allowed: boolean;
  readonly protocolDefaultTarget?: boolean;
  readonly extensionDefaultTarget?: boolean;
  readonly timeoutRebase?: boolean;
};

export type CommandSchemaMetadata = {
  readonly owner: CommandOwner;
  readonly target: CommandTargetPolicy;
  readonly content: CommandContentPolicy;
  readonly action: boolean;
  readonly timeout: CommandTimeoutPolicy;
  readonly security?: CommandSecurityMetadata;
  readonly compatibility?: CommandCompatibilityMetadata;
  readonly batch: CommandBatchMetadata;
  readonly cliRoutes: readonly CliRouteMetadata[];
};

export type CommandSchemaEntry = CommandSchemaMetadata & {
  readonly params: z.ZodType;
  readonly result: z.ZodType;
  readonly status: CapabilityStatus;
};
