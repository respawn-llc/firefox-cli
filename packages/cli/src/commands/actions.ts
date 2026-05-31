import type { RequestEnvelope } from "@firefox-cli/protocol";
import { parseCliRouteArgsForRoute } from "../argv-contracts.js";
import {
  optionalNumberOption,
  optionalStringOption,
  optionalTarget,
  parseElementTarget,
  parsePayloadPositionalsAndOptions,
  parsePositionalsAndOptions,
  parseTargetOptions,
  sourceDragTarget,
} from "../parse.js";
import { createValidatedRequest } from "../protocol-validation.js";
import { createUploadParams, parseUploadArguments } from "../upload.js";
import { CliUsageError, type CliDependencies, type CliRequestBuildContext } from "../types.js";
import { isElementActionCommand, isScrollDirection } from "./guards.js";

export function buildDragRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePositionalsAndOptions(argv.slice(1));
  const [source, target] = parsed.positionals;
  if (source === undefined || target === undefined) {
    throw new CliUsageError("Missing drag source or target.");
  }
  return createValidatedRequest("drag", {
    ...sourceDragTarget(source, "source"),
    ...sourceDragTarget(target, "target"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

export async function buildUploadRequest(argv: readonly string[], dependencies: CliDependencies, context: CliRequestBuildContext): Promise<RequestEnvelope> {
  const parsed = parseUploadArguments(argv.slice(1));
  return createValidatedRequest("upload", await createUploadParams(parsed, dependencies, context.uploadBudget));
}

export function buildMouseRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePositionalsAndOptions(argv.slice(1));
  const action = parsed.positionals[0];
  if (action !== "move" && action !== "down" && action !== "up" && action !== "wheel") {
    throw new CliUsageError("Missing or invalid mouse action.");
  }
  return createValidatedRequest("mouse", {
    action,
    ...parseElementTarget(parsed.positionals[1]),
    ...optionalNumberOption(parsed.optionArgs, ["--x"], "x"),
    ...optionalNumberOption(parsed.optionArgs, ["--y"], "y"),
    ...optionalNumberOption(parsed.optionArgs, ["--button"], "button"),
    ...optionalNumberOption(parsed.optionArgs, ["--delta-x"], "deltaX"),
    ...optionalNumberOption(parsed.optionArgs, ["--delta-y"], "deltaY"),
    ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

export function buildKeyEventRequest(argv: readonly string[]): RequestEnvelope {
  const command = argv[0];
  if (command !== "keydown" && command !== "keyup") {
    throw new CliUsageError("Invalid key event command.");
  }
  const parsed = parsePositionalsAndOptions(argv.slice(1));
  const key = parsed.positionals[0];
  if (key === undefined) {
    throw new CliUsageError("Missing key.");
  }
  return createValidatedRequest(command, {
    key,
    ...parseElementTarget(parsed.positionals[1]),
    ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

export function buildElementActionRequest(argv: readonly string[]): RequestEnvelope {
  const command = argv[0];
  if (!isElementActionCommand(command)) {
    throw new CliUsageError("Invalid element action command.");
  }
  const parsedArgs = parsePositionalsAndOptions(argv.slice(1));
  const elementTarget = parsedArgs.positionals[0];
  if (elementTarget === undefined) {
    throw new CliUsageError("Missing selector or ref.");
  }
  return createValidatedRequest(command, {
    ...parseElementTarget(elementTarget),
    ...optionalStringOption(parsedArgs.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

export function buildTextActionRequest(argv: readonly string[]): RequestEnvelope {
  const command = argv[0];
  if (command !== "fill" && command !== "type") {
    throw new CliUsageError("Invalid text action command.");
  }
  const parsedArgs = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 1,
    minPositionals: 2,
  });
  const elementTarget = parsedArgs.positionals[0];
  const text = parsedArgs.positionals[1];
  if (elementTarget === undefined) {
    throw new CliUsageError("Missing selector or ref.");
  }
  if (text === undefined) {
    throw new CliUsageError("Missing text.");
  }
  return createValidatedRequest(command, {
    ...parseElementTarget(elementTarget),
    text,
    ...optionalStringOption(parsedArgs.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

export function buildPressRequest(argv: readonly string[]): RequestEnvelope {
  const parsedArgs = parsePositionalsAndOptions(argv.slice(1));
  const key = parsedArgs.positionals[0];
  if (key === undefined) {
    throw new CliUsageError("Missing key.");
  }
  return createValidatedRequest("press", {
    key,
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

export function buildKeyboardRequest(argv: readonly string[]): RequestEnvelope {
  const parsedArgs = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 1,
    minPositionals: 2,
  });
  const subcommand = parsedArgs.positionals[0];
  const text = parsedArgs.positionals[1];
  if (subcommand !== "type" && subcommand !== "inserttext") {
    throw new CliUsageError("Missing or invalid keyboard command.");
  }
  if (text === undefined) {
    throw new CliUsageError("Missing text.");
  }
  return createValidatedRequest(subcommand === "type" ? "keyboard.type" : "keyboard.inserttext", {
    text,
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

export function buildSelectRequest(argv: readonly string[]): RequestEnvelope {
  const parsedArgs = parseSelectArguments(argv.slice(1));
  const elementTarget = parsedArgs.positionals[0];
  const values = parsedArgs.positionals.slice(1);
  if (elementTarget === undefined) {
    throw new CliUsageError("Missing selector or ref.");
  }
  if (values.length === 0) {
    throw new CliUsageError("Missing select value.");
  }
  return createValidatedRequest("select", {
    ...parseElementTarget(elementTarget),
    values,
    ...optionalStringOption(parsedArgs.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

export function parseSelectArguments(args: readonly string[]): {
  readonly positionals: readonly string[];
  readonly optionArgs: readonly string[];
} {
  return parseCliRouteArgsForRoute("select", args);
}

export function buildScrollRequest(argv: readonly string[]): RequestEnvelope {
  const command = argv[0];
  if (command !== "scroll" && command !== "swipe") {
    throw new CliUsageError("Invalid scroll command.");
  }
  const parsedArgs = parsePositionalsAndOptions(argv.slice(1));
  const direction = parsedArgs.positionals[0];
  if (!isScrollDirection(direction)) {
    throw new CliUsageError(`Invalid direction: ${direction ?? ""}`);
  }
  const maybeDistance = parsedArgs.positionals[1];
  const hasDistance = maybeDistance !== undefined && /^\d+$/u.test(maybeDistance);
  const distancePx = hasDistance ? Number(maybeDistance) : undefined;
  const elementTarget = hasDistance ? parsedArgs.positionals[2] : parsedArgs.positionals[1];
  return createValidatedRequest(command, {
    direction,
    ...(distancePx === undefined ? {} : { distancePx }),
    ...parseElementTarget(elementTarget),
    ...optionalStringOption(parsedArgs.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}
