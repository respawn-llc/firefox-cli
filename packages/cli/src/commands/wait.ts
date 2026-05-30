import type { RequestEnvelope } from "@firefox-cli/protocol";
import { parseCliRouteArgsForRoute } from "../argv-contracts.js";
import {
  getOptionValue,
  hasOption,
  optionalTarget,
  parseElementTarget,
  parsePositiveIntegerValue,
  parseTargetOptions,
} from "../parse.js";
import { createValidatedRequest } from "../protocol-validation.js";
import { CliUsageError } from "../types.js";

type ParsedWaitArguments = {
  readonly positionals: readonly string[];
  readonly text?: string;
  readonly urlGlob?: string;
  readonly expression?: string;
  readonly loadState?: string;
  readonly download?: string;
  readonly state?: string;
  readonly generationId?: string;
  readonly timeout?: string;
  readonly interval?: string;
};

export function buildWaitRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const waitArgs = parseWaitArguments(args);
  return createValidatedRequest("wait", {
    ...parseWaitParams(waitArgs),
    ...(waitArgs.timeout === undefined
      ? {}
      : { timeoutMs: parsePositiveIntegerValue(waitArgs.timeout, "timeout") }),
    ...(waitArgs.interval === undefined
      ? {}
      : { intervalMs: parsePositiveIntegerValue(waitArgs.interval, "interval") }),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

function parseWaitParams(waitArgs: ParsedWaitArguments): {
  readonly kind: "ms" | "element" | "text" | "url" | "function" | "load-state" | "download";
  readonly durationMs?: number;
  readonly selector?: string;
  readonly ref?: string;
  readonly generationId?: string;
  readonly state?:
    | "visible"
    | "hidden"
    | "attached"
    | "domcontentloaded"
    | "complete"
    | "networkidle";
  readonly text?: string;
  readonly urlGlob?: string;
  readonly expression?: string;
  readonly downloadId?: number;
  readonly filenameGlob?: string;
} {
  const conditionCount = [
    waitArgs.text,
    waitArgs.urlGlob,
    waitArgs.expression,
    waitArgs.loadState,
    waitArgs.download,
  ].filter((value) => value !== undefined).length;
  if (conditionCount > 1) {
    throw new CliUsageError("Specify exactly one wait condition.");
  }

  if (conditionCount > 0 && waitArgs.positionals.length > 0) {
    throw new CliUsageError("Specify exactly one wait condition.");
  }

  if (conditionCount > 0 && waitArgs.state !== undefined) {
    throw new CliUsageError("Only element waits accept --state.");
  }

  if (conditionCount > 0 && waitArgs.generationId !== undefined) {
    throw new CliUsageError("Only element waits accept --generation.");
  }

  if (waitArgs.text !== undefined) {
    return { kind: "text", text: waitArgs.text };
  }

  if (waitArgs.urlGlob !== undefined) {
    return { kind: "url", urlGlob: waitArgs.urlGlob };
  }

  if (waitArgs.expression !== undefined) {
    return { kind: "function", expression: waitArgs.expression };
  }

  if (waitArgs.loadState !== undefined) {
    if (
      waitArgs.loadState !== "domcontentloaded" &&
      waitArgs.loadState !== "complete" &&
      waitArgs.loadState !== "networkidle"
    ) {
      throw new CliUsageError(`Invalid load state: ${waitArgs.loadState}`);
    }
    return { kind: "load-state", state: waitArgs.loadState };
  }

  if (waitArgs.download !== undefined) {
    if (waitArgs.download.length === 0) {
      return { kind: "download" };
    }
    return /^\d+$/u.test(waitArgs.download)
      ? { kind: "download", downloadId: Number(waitArgs.download) }
      : { kind: "download", filenameGlob: waitArgs.download };
  }

  const target = waitArgs.positionals[0];
  if (target === undefined) {
    throw new CliUsageError("Missing wait target or condition.");
  }

  if (waitArgs.positionals.length > 1) {
    throw new CliUsageError("Specify exactly one wait condition.");
  }

  if (/^\d+$/u.test(target)) {
    if (waitArgs.state !== undefined) {
      throw new CliUsageError("Only element waits accept --state.");
    }
    if (waitArgs.generationId !== undefined) {
      throw new CliUsageError("Only element waits accept --generation.");
    }
    return { kind: "ms", durationMs: Number(target) };
  }

  const elementState = waitArgs.state ?? "visible";
  if (elementState !== "visible" && elementState !== "hidden" && elementState !== "attached") {
    throw new CliUsageError(`Invalid wait state: ${elementState}`);
  }
  const elementTarget = parseElementTarget(target);
  if (elementTarget.ref === undefined && waitArgs.generationId !== undefined) {
    throw new CliUsageError("Generation IDs apply only to refs.");
  }

  return {
    kind: "element",
    ...elementTarget,
    state: elementState,
    ...(waitArgs.generationId === undefined ? {} : { generationId: waitArgs.generationId }),
  };
}

function parseWaitArguments(args: readonly string[]): ParsedWaitArguments {
  const parsed = parseCliRouteArgsForRoute("wait", args);
  const text = getOptionValue(parsed.optionArgs, ["--text"]);
  const urlGlob = getOptionValue(parsed.optionArgs, ["--url"]);
  const expression = getOptionValue(parsed.optionArgs, ["--fn"]);
  const loadState = getOptionValue(parsed.optionArgs, ["--load"]);
  const download = getOptionValue(parsed.optionArgs, ["--download"]);
  const state = getOptionValue(parsed.optionArgs, ["--state"]);
  const generationId = getOptionValue(parsed.optionArgs, ["--generation"]);
  const timeout = getOptionValue(parsed.optionArgs, ["--timeout"]);
  const interval = getOptionValue(parsed.optionArgs, ["--interval"]);
  return {
    positionals: parsed.positionals,
    ...(text === undefined ? {} : { text }),
    ...(urlGlob === undefined ? {} : { urlGlob }),
    ...(expression === undefined ? {} : { expression }),
    ...(loadState === undefined ? {} : { loadState }),
    ...(hasOption(parsed.optionArgs, "--download") ? { download: download ?? "" } : {}),
    ...(state === undefined ? {} : { state }),
    ...(generationId === undefined ? {} : { generationId }),
    ...(timeout === undefined ? {} : { timeout }),
    ...(interval === undefined ? {} : { interval }),
  };
}
