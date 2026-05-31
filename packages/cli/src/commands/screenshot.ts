import { resolve } from "node:path";
import type { RequestEnvelope } from "@firefox-cli/protocol";
import { parseCliRouteArgsForRoute } from "../argv-contracts.js";
import { getOptionValue, hasOption, optionalTarget, parsePositiveIntegerValue, parseTargetOptions } from "../parse.js";
import { createValidatedRequest } from "../protocol-validation.js";
import { CliUsageError, type CliDependencies } from "../types.js";
import { isScreenshotFormat } from "./guards.js";

interface ParsedScreenshotArguments {
  readonly optionArgs: readonly string[];
  readonly outputPath?: string;
  readonly format: "png" | "jpeg";
  readonly fullPage: boolean;
  readonly quality?: string;
  readonly timeout?: string;
  readonly maxImageBytes?: string;
  readonly json: boolean;
}

export function buildScreenshotRequest(argv: readonly string[], dependencies: CliDependencies): RequestEnvelope {
  const parsedArgs = parseScreenshotArguments(argv.slice(1));
  const outputPath = resolve(dependencies.cwd ?? process.cwd(), parsedArgs.outputPath ?? "screenshot.png");
  return createValidatedRequest("screenshot", {
    path: outputPath,
    format: parsedArgs.format,
    ...(parsedArgs.fullPage ? { fullPage: true } : {}),
    ...(parsedArgs.quality === undefined ? {} : { quality: parsePositiveIntegerValue(parsedArgs.quality, "quality") }),
    ...(parsedArgs.timeout === undefined ? {} : { timeoutMs: parsePositiveIntegerValue(parsedArgs.timeout, "timeout") }),
    ...(parsedArgs.maxImageBytes === undefined ? {} : { maxImageBytes: parsePositiveIntegerValue(parsedArgs.maxImageBytes, "max output") }),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

export function screenshotWantsJsonOutput(args: readonly string[]): boolean {
  return parseScreenshotArguments(args).json;
}

function parseScreenshotArguments(args: readonly string[]): ParsedScreenshotArguments {
  const parsed = parseCliRouteArgsForRoute("screenshot", args);
  const [outputPath, extraPath] = parsed.positionals;
  if (extraPath !== undefined) {
    throw new CliUsageError("Specify at most one screenshot path.");
  }

  const formatValue = getOptionValue(parsed.optionArgs, ["--format", "--screenshot-format"])?.toLowerCase();
  if (formatValue !== undefined && !isScreenshotFormat(formatValue)) {
    throw new CliUsageError("Only PNG and JPEG screenshots are supported.");
  }
  const quality = getOptionValue(parsed.optionArgs, ["--screenshot-quality"]);
  const timeout = getOptionValue(parsed.optionArgs, ["--timeout"]);
  const maxImageBytes = getOptionValue(parsed.optionArgs, ["--max-output"]);

  return {
    optionArgs: parsed.optionArgs,
    ...(outputPath === undefined ? {} : { outputPath }),
    format: formatValue ?? "png",
    fullPage: hasOption(parsed.optionArgs, "--full"),
    ...(quality === undefined ? {} : { quality }),
    ...(timeout === undefined ? {} : { timeout }),
    ...(maxImageBytes === undefined ? {} : { maxImageBytes }),
    json: parsed.json,
  };
}
