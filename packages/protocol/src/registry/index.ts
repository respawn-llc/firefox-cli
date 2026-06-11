import type { z } from "zod";

import { createBatchSchemas } from "../batch.js";
import { targetSelectorSchema } from "../target.js";
import type { ActionKind } from "../actions.js";
import type {
  CliRouteEntry,
  CliRouteMetadata,
  CommandBatchMetadata,
  CommandCompatibilityMetadata,
  CommandFrameScopeMetadata,
  CommandProtocolRequirement,
  CommandSchemaEntry,
  CommandSecurityMetadata,
} from "../metadata.js";
import { actionsCommandEntries } from "./actions.js";
import { browsingCommandEntries } from "./browsing.js";
import { contentCommandEntries } from "./content.js";
import { coreCommandEntries } from "./core.js";
import { assembleCommandRegistry, defineCommandEntries } from "./define.js";
import { pairingCommandEntries } from "./pairing.js";
import { phase8CommandEntries } from "./phase8.js";

const nonBatchCommandSchemas = assembleCommandRegistry(
  coreCommandEntries,
  browsingCommandEntries,
  contentCommandEntries,
  phase8CommandEntries,
  actionsCommandEntries,
  pairingCommandEntries,
);

type NonBatchCommandId = keyof typeof nonBatchCommandSchemas;

const isNonBatchCommandId = (command: string): command is NonBatchCommandId => Object.hasOwn(nonBatchCommandSchemas, command);

const batchSchemas = createBatchSchemas({
  hasCommand: isNonBatchCommandId,
  isBatchable: (command) => isNonBatchCommandId(command) && nonBatchCommandSchemas[command].batch.allowed,
  paramsFor: (command) => (isNonBatchCommandId(command) ? nonBatchCommandSchemas[command].params : undefined),
  resultFor: (command) => (isNonBatchCommandId(command) ? nonBatchCommandSchemas[command].result : undefined),
  paramsWithDefaultTarget: (command, params) => batchStepParamsWithDefaultTarget(command, params),
});

export const batchStepSchema = batchSchemas.batchStepSchema;
export const batchParamsSchema = batchSchemas.batchParamsSchema;
export const batchStepResultSchema = batchSchemas.batchStepResultSchema;
export const batchResultSchema = batchSchemas.batchResultSchema;

export type BatchStep = z.infer<typeof batchStepSchema>;
export type BatchParams = z.infer<typeof batchParamsSchema>;
export type BatchStepResult = z.infer<typeof batchStepResultSchema>;
export type BatchResult = z.infer<typeof batchResultSchema>;

const batchCommandEntries = defineCommandEntries({
  batch: {
    params: batchParamsSchema,
    result: batchResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "never",
    action: false,
    timeout: "batch",
    batch: { allowed: false },
    cliRoutes: [{ id: "batch", path: ["batch"], batch: false }],
  },
});

export const commandSchemas = assembleCommandRegistry(
  coreCommandEntries,
  browsingCommandEntries,
  contentCommandEntries,
  phase8CommandEntries,
  batchCommandEntries,
  actionsCommandEntries,
  pairingCommandEntries,
);

export type CommandId = keyof typeof commandSchemas;

export function commandAllowedBeforeApproval(command: CommandId): boolean {
  return command === "pair.requestApproval" || command === "pair.openApproval";
}

type CommandsWithContentPolicy<P> = {
  readonly [C in CommandId]: (typeof commandSchemas)[C]["content"] extends P ? C : never;
}[CommandId];

export type ContentCommandId = CommandsWithContentPolicy<"always" | "mixed" | "action">;

export function isCommandId(command: string): command is CommandId {
  return Object.hasOwn(commandSchemas, command);
}

export function getCommandCliRoutes(command: CommandId): readonly CliRouteMetadata[] {
  return commandSchemas[command].cliRoutes;
}

export function getCliRoutes(): readonly CliRouteMetadata[] {
  return getCliRouteEntries().map((entry) => entry.route);
}

export function getCliRouteEntries(): readonly CliRouteEntry[] {
  return Object.entries(commandSchemas).flatMap(([command, schema]) =>
    schema.cliRoutes.map((route) => ({
      command,
      route,
    })),
  );
}

export function isBatchableCommandId(command: string): command is CommandId {
  return isCommandId(command) && commandSchemas[command].batch.allowed;
}

export function commandAcceptsProtocolBatchDefaultTarget(command: string): command is CommandId {
  if (!isCommandId(command)) {
    return false;
  }
  const batch: CommandBatchMetadata = commandSchemas[command].batch;
  return batch.protocolDefaultTarget === true;
}

export function commandAcceptsExtensionBatchDefaultTarget(command: string): command is CommandId {
  if (!isCommandId(command)) {
    return false;
  }
  const batch: CommandBatchMetadata = commandSchemas[command].batch;
  return batch.extensionDefaultTarget === true;
}

export function commandAcceptsBatchTimeout(command: string): command is CommandId {
  if (!isCommandId(command)) {
    return false;
  }
  const batch: CommandBatchMetadata = commandSchemas[command].batch;
  return batch.timeoutRebase === true;
}

export function isActionCommand(command: string): command is ActionKind {
  return isCommandId(command) && commandSchemas[command].action;
}

export function isContentCommand(command: string): command is ContentCommandId {
  if (!isCommandId(command)) {
    return false;
  }
  const content = commandSchemas[command].content;
  return content === "always" || content === "mixed" || content === "action";
}

export function getCommandSecurityMetadata(command: CommandId): CommandSecurityMetadata {
  const entry: CommandSchemaEntry = commandSchemas[command];
  const metadata = entry.security;
  if (metadata !== undefined) {
    return metadata;
  }
  return entry.action ? { level: "sensitive", reasons: ["page-mutation"] } : { level: "normal", reasons: [] };
}

export function getCommandCompatibilityMetadata(command: CommandId): CommandCompatibilityMetadata {
  const entry: CommandSchemaEntry = commandSchemas[command];
  const metadata = entry.compatibility;
  return metadata ?? { requirements: [] };
}

export function getCommandFrameScopeMetadata(command: CommandId): CommandFrameScopeMetadata {
  const entry: CommandSchemaEntry = commandSchemas[command];
  const metadata = entry.frameScope;
  if (metadata !== undefined) {
    return metadata;
  }
  if (entry.action || entry.content !== "never") {
    return {
      scope: "main-frame-only",
      reason: "This command runs in the resolved tab's main frame; iframe targeting is not implemented.",
      future: "docs/iframe-targeting-future.md",
    };
  }
  return {
    scope: "not-applicable",
    reason: "This command does not execute inside a page frame.",
  };
}

export function getRequestProtocolRequirement(request: { readonly command: CommandId; readonly params: unknown }): CommandProtocolRequirement | undefined {
  const requirements = getCommandCompatibilityMetadata(request.command).requirements.filter((requirement) =>
    protocolRequirementMatchesParams(requirement, request.params),
  );
  return requirements.reduce<CommandProtocolRequirement | undefined>((highest, requirement) => {
    if (highest === undefined) {
      return requirement;
    }
    return requirement.minProtocolVersion > highest.minProtocolVersion ? requirement : highest;
  }, undefined);
}

export function isPrivilegeSensitiveCommand(command: CommandId): boolean {
  return getCommandSecurityMetadata(command).level !== "normal";
}

export function isPrivilegeSensitiveRequest(request: { readonly command: CommandId; readonly params: unknown }): boolean {
  const metadata = getCommandSecurityMetadata(request.command);
  if (metadata.level === "normal") {
    return false;
  }
  if (metadata.level === "sensitive") {
    return true;
  }

  return isConditionallySensitiveRequest(request);
}

function isConditionallySensitiveRequest(request: { readonly command: CommandId; readonly params: unknown }): boolean {
  if (request.command !== "wait" || !isRecord(request.params)) {
    return false;
  }
  return (
    request.params.kind === "function" || request.params.kind === "download" || (request.params.kind === "load-state" && request.params.state === "networkidle")
  );
}

function protocolRequirementMatchesParams(requirement: CommandProtocolRequirement, params: unknown): boolean {
  const matches = requirement.params?.matches;
  if (matches === undefined) {
    return true;
  }

  return matches.every((match) => valueAtPath(params, match.path) === match.equals);
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[key];
  }, value);
}

function batchStepParamsWithDefaultTarget(
  command: string,
  params: unknown,
): { readonly found: true; readonly params: Record<string, unknown> & { readonly target: unknown } } | { readonly found: false } {
  if (!commandAcceptsProtocolBatchDefaultTarget(command) || !isRecord(params)) {
    return { found: false };
  }

  if (params.target !== undefined) {
    return { found: false };
  }

  return {
    found: true,
    params: {
      ...params,
      target: targetSelectorSchema.parse({
        window: { kind: "active" },
        tab: { kind: "active" },
      }),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
