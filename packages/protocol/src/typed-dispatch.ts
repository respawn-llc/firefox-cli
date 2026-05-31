import type { ProtocolError, ParseResult } from "./core.js";
import {
  safeParseBatchStepCommandParams,
  safeParseCommandResult,
  safeParseStrictCommandParams,
} from "./command-validation.js";
import type { CommandParams, CommandResult, RequestEnvelope, ResponseEnvelope } from "./envelopes.js";
import {
  batchStepResultSchema,
  batchStepSchema,
  isBatchableCommandId,
  type CommandId,
} from "./registry/index.js";

export type CommandHandler<C extends CommandId, Args extends readonly unknown[] = []> = (
  request: RequestEnvelope<C>,
  ...args: Args
) => Promise<ResponseEnvelope<C>> | ResponseEnvelope<C>;

export type CommandHandlerMap<Commands extends CommandId, Args extends readonly unknown[] = []> = {
  readonly [C in Commands]: CommandHandler<C, Args>;
};

export type ParsedBatchStep<C extends CommandId> = {
  readonly command: C;
  readonly params: CommandParams<C>;
};

export type ParsedBatchStepResult<C extends CommandId> =
  | {
      readonly index: number;
      readonly command: C;
      readonly ok: true;
      readonly result: CommandResult<C>;
    }
  | {
      readonly index: number;
      readonly command: C;
      readonly ok: false;
      readonly error: ProtocolError;
    };

type CommandHandlerMapFactory<Args extends readonly unknown[]> = <
  const Commands extends readonly CommandId[],
>(
  commands: Commands,
  handlers: CommandHandlerMap<Commands[number], Args>,
) => CommandHandlerMap<Commands[number], Args>;

type AnyCommandHandlerMap = Partial<Record<CommandId, unknown>>;
type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

export function isRequestCommand<C extends CommandId>(
  request: RequestEnvelope,
  command: C,
): request is RequestEnvelope<C> {
  return request.command === command;
}

export function defineCommandHandlerMap<
  Args extends readonly unknown[] = [],
>(): CommandHandlerMapFactory<Args> {
  return (_commands, handlers) => handlers;
}

export function defineExactCommandHandlerMap<
  Args extends readonly unknown[] = [],
>(): CommandHandlerMapFactory<Args> {
  return (_commands, handlers) => handlers;
}

export function mergeDisjointHandlerMaps<const Maps extends readonly AnyCommandHandlerMap[]>(
  ...maps: Maps
): UnionToIntersection<Maps[number]> {
  const merged: Record<string, unknown> = {};
  for (const map of maps) {
    for (const [command, handler] of Object.entries(map)) {
      if (Object.hasOwn(merged, command)) {
        throw new Error(`Duplicate command handler: ${command}`);
      }
      merged[command] = handler;
    }
  }
  return merged as UnionToIntersection<Maps[number]>;
}

export function dispatchCommandHandler<Commands extends CommandId, Args extends readonly unknown[]>(
  handlers: CommandHandlerMap<Commands, Args>,
  request: RequestEnvelope<Commands>,
  ...args: Args
): Promise<ResponseEnvelope<Commands>> | ResponseEnvelope<Commands> {
  const handler = getCommandHandler(handlers, request.command);
  return handler(request, ...args);
}

export function parseBatchStepAs<C extends CommandId>(
  command: C,
  step: unknown,
): ParseResult<ParsedBatchStep<C>> {
  const parsed = batchStepSchema.safeParse(step);
  if (!parsed.success) {
    return failure("INVALID_ENVELOPE", "Batch step is invalid.", {
      command,
      issues: parsed.error.issues,
    });
  }

  if (parsed.data.command !== command) {
    return failure("INVALID_ENVELOPE", "Batch step command does not match expected command.", {
      expected: command,
      received: parsed.data.command,
    });
  }

  if (!isBatchableCommandId(command)) {
    return failure("INVALID_ENVELOPE", `Command cannot run inside batch: ${command}`, {
      command,
    });
  }

  const params = safeParseBatchStepCommandParams(command, parsed.data.params);
  if (!params.success) {
    return failure("INVALID_ENVELOPE", "Batch step params are invalid.", {
      command,
      issues: params.error.issues,
    });
  }

  return {
    ok: true,
    value: {
      command,
      params: params.data,
    },
  };
}

export function parseBatchStepResultAs<C extends CommandId>(
  command: C,
  step: unknown,
): ParseResult<ParsedBatchStepResult<C>> {
  const parsed = batchStepResultSchema.safeParse(step);
  if (!parsed.success) {
    return failure("INVALID_RESPONSE", "Batch step result is invalid.", {
      command,
      issues: parsed.error.issues,
    });
  }

  if (parsed.data.command !== command) {
    return failure("INVALID_RESPONSE", "Batch result command does not match expected command.", {
      expected: command,
      received: parsed.data.command,
    });
  }

  if (!parsed.data.ok) {
    return {
      ok: true,
      value: {
        index: parsed.data.index,
        command,
        ok: false,
        error: parsed.data.error,
      },
    };
  }

  const result = safeParseCommandResult(command, parsed.data.result);
  if (!result.success) {
    return failure("INVALID_RESPONSE", "Batch step result is invalid.", {
      command,
      issues: result.error.issues,
    });
  }

  return {
    ok: true,
    value: {
      index: parsed.data.index,
      command,
      ok: true,
      result: result.data,
    },
  };
}

export function parseCommandParamsAs<C extends CommandId>(
  command: C,
  params: unknown,
): ParseResult<CommandParams<C>> {
  const parsed = safeParseStrictCommandParams(command, params);
  if (!parsed.success) {
    return failure("INVALID_ENVELOPE", "Command params are invalid.", {
      command,
      issues: parsed.error.issues,
    });
  }
  return { ok: true, value: parsed.data };
}

function getCommandHandler<Commands extends CommandId, Args extends readonly unknown[]>(
  handlers: CommandHandlerMap<Commands, Args>,
  command: CommandId,
): CommandHandler<Commands, Args> {
  return handlers[command as Commands] as CommandHandler<Commands, Args>;
}

function failure(
  code: ProtocolError["code"],
  message: string,
  details?: Record<string, unknown>,
): ParseResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}
