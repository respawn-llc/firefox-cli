import type { z } from "zod";

import type { CapabilityStatus } from "./core.js";

export type CommandOwner = "native-host" | "extension";
export type CommandTargetPolicy = "none" | "optional" | "required" | "mixed";
export type CommandContentPolicy = "never" | "always" | "mixed" | "action";
export type CommandTimeoutPolicy = "none" | "command" | "batch";

export type CliRouteMetadata = {
  readonly id: string;
  readonly path: readonly [string, ...string[]];
  readonly batch: boolean;
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
  readonly batch: CommandBatchMetadata;
  readonly cliRoutes: readonly CliRouteMetadata[];
};

export type CommandSchemaEntry = CommandSchemaMetadata & {
  readonly params: z.ZodType;
  readonly result: z.ZodType;
  readonly status: CapabilityStatus;
};
