import {
  batchParamsSchema,
  commandAcceptsProtocolBatchDefaultTarget,
  isBatchableCommandId,
  MAX_UPLOAD_TOTAL_BYTES,
  type BatchParams,
  type BatchStep,
  type CommandId,
  type RequestEnvelope,
} from "@firefox-cli/protocol";
import { parseCliRouteArgsForRoute } from "../argv-contracts.js";
import { readProcessStdin } from "../default-dependencies.js";
import {
  getOptionValue,
  hasOption,
  isRecord,
  optionalTarget,
  parsePositiveIntegerValue,
  parseTargetOptions,
} from "../parse.js";
import { createValidatedRequest } from "../protocol-validation.js";
import {
  createUploadBudget,
  parseUploadArguments,
  statUploadFiles,
  uploadTotalTooLarge,
} from "../upload.js";
import {
  CliUsageError,
  InvalidBatchArgvCommandError,
  type CliDependencies,
  type CliRequestBuildContext,
} from "../types.js";

type ParsedBatchArguments = {
  readonly optionArgs: readonly string[];
  readonly inputSource: "argv" | "stdin";
  readonly input?: string;
  readonly bail: boolean;
  readonly timeout?: string;
  readonly maxResultBytes?: string;
  readonly json: boolean;
};

export async function buildBatchRequest(
  argv: readonly string[],
  dependencies: CliDependencies,
  context: CliRequestBuildContext,
): Promise<RequestEnvelope> {
  const parsedArgs = parseBatchArguments(argv.slice(1));
  const steps = await readBatchSteps(parsedArgs, dependencies, context);
  const params = parseBatchParamsForCli({
    steps,
    ...(parsedArgs.bail ? { bail: true } : {}),
    ...(parsedArgs.timeout === undefined
      ? {}
      : { timeoutMs: parsePositiveIntegerValue(parsedArgs.timeout, "timeout") }),
    ...(parsedArgs.maxResultBytes === undefined
      ? {}
      : { maxResultBytes: parsePositiveIntegerValue(parsedArgs.maxResultBytes, "max output") }),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
  return createValidatedRequest("batch", params);
}

export function batchWantsJsonOutput(args: readonly string[]): boolean {
  return parseBatchArguments(args).json;
}

function parseBatchArguments(args: readonly string[]): ParsedBatchArguments {
  const parsed = parseCliRouteArgsForRoute("batch", args);
  const readsStdin = hasOption(parsed.optionArgs, "--stdin");
  if ((readsStdin && parsed.positionals.length > 0) || parsed.positionals.length > 1) {
    throw new CliUsageError("Specify exactly one batch input source.");
  }
  if (!readsStdin && parsed.positionals.length === 0) {
    throw new CliUsageError("Missing batch JSON.");
  }
  const timeout = getOptionValue(parsed.optionArgs, ["--timeout"]);
  const maxResultBytes = getOptionValue(parsed.optionArgs, ["--max-output"]);

  return {
    optionArgs: parsed.optionArgs,
    inputSource: readsStdin ? "stdin" : "argv",
    ...(parsed.positionals[0] === undefined ? {} : { input: parsed.positionals[0] }),
    bail: hasOption(parsed.optionArgs, "--bail"),
    ...(timeout === undefined ? {} : { timeout }),
    ...(maxResultBytes === undefined ? {} : { maxResultBytes }),
    json: parsed.json,
  };
}

function parseBatchParamsForCli(params: BatchParams): BatchParams {
  const parsed = batchParamsSchema.safeParse(params);
  if (parsed.success) {
    return parsed.data;
  }

  const firstIssue = parsed.error.issues[0];
  throw new CliUsageError(
    firstIssue === undefined
      ? "Batch request is invalid."
      : `Batch request is invalid: ${firstIssue.message}`,
  );
}

async function validateBatchArgvUploadMetadata(
  rawSteps: readonly unknown[],
  dependencies: CliDependencies,
): Promise<void> {
  let plannedBytes = 0;
  for (const [index, rawStep] of rawSteps.entries()) {
    if (
      !Array.isArray(rawStep) ||
      !rawStep.every((value): value is string => typeof value === "string") ||
      rawStep[0] !== "upload"
    ) {
      continue;
    }

    const parsed = parseBatchUploadArguments(rawStep, index);
    const plans = await statUploadFiles(parsed.paths, dependencies);
    const stepBytes = plans.reduce((total, plan) => total + plan.size, 0);
    plannedBytes += stepBytes;
    if (plannedBytes > MAX_UPLOAD_TOTAL_BYTES) {
      throw uploadTotalTooLarge(plannedBytes);
    }
  }
}

function parseBatchUploadArguments(argv: readonly string[], index: number) {
  try {
    return parseUploadArguments(argv.slice(1));
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw new CliUsageError(`Invalid batch argv step ${index}: ${error.message}`);
    }
    throw error;
  }
}

async function readBatchSteps(
  args: ParsedBatchArguments,
  dependencies: CliDependencies,
  context: CliRequestBuildContext,
): Promise<BatchStep[]> {
  const input =
    args.inputSource === "stdin"
      ? await (dependencies.readStdin?.() ?? readProcessStdin())
      : (args.input ?? "");
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    throw new CliUsageError("Invalid batch JSON.");
  }

  if (!Array.isArray(raw)) {
    throw new CliUsageError("Batch JSON must be an array.");
  }

  await validateBatchArgvUploadMetadata(raw, dependencies);

  const steps: BatchStep[] = [];
  const uploadBudget = createUploadBudget();
  for (const [index, rawStep] of raw.entries()) {
    steps.push(
      await parseBatchStep(rawStep, index, dependencies, {
        ...context,
        uploadBudget,
        batchMode: true,
      }),
    );
  }
  if (steps.length === 0) {
    throw new CliUsageError("Batch requires at least one step.");
  }

  return steps;
}

async function parseBatchStep(
  rawStep: unknown,
  index: number,
  dependencies: CliDependencies,
  context: CliRequestBuildContext,
): Promise<BatchStep> {
  if (Array.isArray(rawStep)) {
    if (!rawStep.every((value): value is string => typeof value === "string")) {
      throw new CliUsageError(`Batch argv step ${index} must contain only strings.`);
    }
    return batchStepFromArgv(rawStep, index, dependencies, context);
  }

  if (!isRecord(rawStep)) {
    throw new CliUsageError(`Batch step ${index} must be an argv array or command object.`);
  }

  const command = rawStep.command;
  if (typeof command !== "string" || !isBatchableCommandId(command)) {
    throw new CliUsageError(`Invalid batch command at step ${index}.`);
  }

  return {
    command,
    params: rawStep.params ?? {},
  };
}

async function batchStepFromArgv(
  argv: readonly string[],
  index: number,
  dependencies: CliDependencies,
  context: CliRequestBuildContext,
): Promise<BatchStep> {
  if (batchArgvReadsStdin(argv)) {
    throw new CliUsageError(`Batch argv step ${index} cannot read from stdin.`);
  }

  let request: RequestEnvelope;
  try {
    request = await context.buildRequestForArgv(argv, dependencies, context);
  } catch (error) {
    if (error instanceof InvalidBatchArgvCommandError) {
      throw new CliUsageError(`Invalid batch argv command at step ${index}.`);
    }
    if (error instanceof CliUsageError) {
      throw new CliUsageError(`Invalid batch argv step ${index}: ${error.message}`);
    }
    throw error;
  }

  if (!isBatchableCommandId(request.command)) {
    throw new CliUsageError(`Invalid batch command at step ${index}.`);
  }

  return {
    command: request.command,
    params: stripImplicitBatchTarget(request.command, request.params, argv),
  };
}

function batchArgvReadsStdin(argv: readonly string[]): boolean {
  return argv[0] === "eval" && argv.includes("--stdin");
}

function stripImplicitBatchTarget(
  command: CommandId,
  params: unknown,
  argv: readonly string[],
): unknown {
  if (!isImplicitBatchDefaultTargetCommand(command) || !isRecord(params)) {
    return params;
  }

  if (hasExplicitTargetInBatchArgv(command, argv)) {
    return params;
  }

  const { target: _target, ...paramsWithoutImplicitTarget } = params;
  return paramsWithoutImplicitTarget;
}

function isImplicitBatchDefaultTargetCommand(command: CommandId): boolean {
  return commandAcceptsProtocolBatchDefaultTarget(command);
}

function hasExplicitTargetInBatchArgv(command: CommandId, argv: readonly string[]): boolean {
  if (command === "tab.select" || command === "tab.close") {
    const positionals = parseCliRouteArgsForRoute(command, argv.slice(1)).positionals;
    return positionals[1] !== undefined || hasOption(argv, "--tab") || hasOption(argv, "--window");
  }

  if (command === "window.select" || command === "window.close") {
    const positionals = parseCliRouteArgsForRoute(command, argv.slice(1)).positionals;
    return positionals[1] !== undefined || hasOption(argv, "--window");
  }

  return false;
}
