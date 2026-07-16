import type { z } from "zod";

import type { CommandParams, CommandResult } from "./envelopes.js";
import { type CommandId, commandSchemas } from "./registry/index.js";

export type CommandSafeParse<T> =
  | {
      readonly success: true;
      readonly data: T;
    }
  | {
      readonly success: false;
      readonly error: z.ZodError;
    };

export function safeParseStrictCommandParams<C extends CommandId>(command: C, params: unknown): CommandSafeParse<CommandParams<C>>;
export function safeParseStrictCommandParams(command: CommandId, params: unknown): CommandSafeParse<unknown> {
  return commandSchemas[command].params.safeParse(params);
}

export function safeParseBatchStepCommandParams<C extends CommandId>(command: C, params: unknown): CommandSafeParse<CommandParams<C>>;
export function safeParseBatchStepCommandParams(command: CommandId, params: unknown): CommandSafeParse<unknown> {
  return safeParseStrictCommandParams(command, params);
}

export function safeParseCommandResult<C extends CommandId>(command: C, result: unknown): CommandSafeParse<CommandResult<C>>;
export function safeParseCommandResult(command: CommandId, result: unknown): CommandSafeParse<unknown> {
  return commandSchemas[command].result.safeParse(result);
}
