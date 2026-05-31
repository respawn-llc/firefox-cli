import type { z } from "zod";

import type { CommandParams, CommandResult } from "./envelopes.js";
import {
  commandAcceptsProtocolBatchDefaultTarget,
  commandSchemas,
  type CommandId,
} from "./registry/index.js";
import { targetSelectorSchema } from "./target.js";

export type CommandSafeParse<T> =
  | {
      readonly success: true;
      readonly data: T;
    }
  | {
      readonly success: false;
      readonly error: z.ZodError;
    };

export function safeParseStrictCommandParams<C extends CommandId>(
  command: C,
  params: unknown,
): CommandSafeParse<CommandParams<C>> {
  return commandSchemas[command].params.safeParse(params) as CommandSafeParse<CommandParams<C>>;
}

export function safeParseBatchStepCommandParams<C extends CommandId>(
  command: C,
  params: unknown,
): CommandSafeParse<CommandParams<C>> {
  const parsed = safeParseStrictCommandParams(command, params);
  if (parsed.success || !commandAcceptsProtocolBatchDefaultTarget(command)) {
    return parsed;
  }

  const fallbackParams = paramsWithDefaultTarget(params);
  return fallbackParams === undefined
    ? parsed
    : safeParseStrictCommandParams(command, fallbackParams);
}

export function safeParseCommandResult<C extends CommandId>(
  command: C,
  result: unknown,
): CommandSafeParse<CommandResult<C>> {
  return commandSchemas[command].result.safeParse(result) as CommandSafeParse<CommandResult<C>>;
}

function paramsWithDefaultTarget(params: unknown): unknown | undefined {
  if (!isRecord(params)) {
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
