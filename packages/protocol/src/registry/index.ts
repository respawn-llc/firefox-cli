import type { z } from "zod";

import { createBatchSchemas } from "../batch.js";
import { targetSelectorSchema } from "../target.js";
import type { CliRouteEntry, CliRouteMetadata, CommandBatchMetadata } from "../metadata.js";
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

const isNonBatchCommandId = (command: string): command is NonBatchCommandId =>
  Object.hasOwn(nonBatchCommandSchemas, command);

const batchSchemas = createBatchSchemas({
  hasCommand: isNonBatchCommandId,
  isBatchable: (command) =>
    isNonBatchCommandId(command) && nonBatchCommandSchemas[command].batch.allowed,
  paramsFor: (command) =>
    isNonBatchCommandId(command) ? nonBatchCommandSchemas[command].params : undefined,
  resultFor: (command) =>
    isNonBatchCommandId(command) ? nonBatchCommandSchemas[command].result : undefined,
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

export function getCliRouteEntries(): readonly CliRouteEntry<CommandId>[] {
  return Object.entries(commandSchemas).flatMap(([command, schema]) =>
    schema.cliRoutes.map((route) => ({
      command: command as CommandId,
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

export function isActionCommand(command: string): command is import("../actions.js").ActionKind {
  return isCommandId(command) && commandSchemas[command].action;
}

export function isContentCommand(command: string): command is ContentCommandId {
  if (!isCommandId(command)) {
    return false;
  }
  const content = commandSchemas[command].content;
  return content === "always" || content === "mixed" || content === "action";
}

function batchStepParamsWithDefaultTarget(command: string, params: unknown): unknown | undefined {
  if (!commandAcceptsProtocolBatchDefaultTarget(command) || !isRecord(params)) {
    return undefined;
  }

  if (params.target !== undefined) {
    return undefined;
  }

  return {
    ...params,
    target: targetSelectorSchema.parse({
      window: { kind: "active" },
      tab: { kind: "active" },
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
