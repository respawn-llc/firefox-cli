import { resolve } from "node:path";
import type { RequestEnvelope } from "@firefox-cli/protocol";
import {
  optionalTarget,
  parsePositiveIntegerValue,
  parseTargetOptions,
  readFlagValue,
} from "../parse.js";
import { createValidatedRequest } from "../protocol-validation.js";
import { CliUsageError, type CliDependencies } from "../types.js";
import { isScreenshotFormat } from "./guards.js";

type ParsedScreenshotArguments = {
  readonly optionArgs: readonly string[];
  readonly outputPath?: string;
  readonly format: "png" | "jpeg";
  readonly fullPage: boolean;
  readonly quality?: string;
  readonly timeout?: string;
  readonly maxImageBytes?: string;
  readonly json: boolean;
};

export function buildScreenshotRequest(
  argv: readonly string[],
  dependencies: CliDependencies,
): RequestEnvelope {
  const parsedArgs = parseScreenshotArguments(argv.slice(1));
  const outputPath = resolve(
    dependencies.cwd ?? process.cwd(),
    parsedArgs.outputPath ?? "screenshot.png",
  );
  return createValidatedRequest("screenshot", {
    path: outputPath,
    format: parsedArgs.format,
    ...(parsedArgs.fullPage ? { fullPage: true } : {}),
    ...(parsedArgs.quality === undefined
      ? {}
      : { quality: parsePositiveIntegerValue(parsedArgs.quality, "quality") }),
    ...(parsedArgs.timeout === undefined
      ? {}
      : { timeoutMs: parsePositiveIntegerValue(parsedArgs.timeout, "timeout") }),
    ...(parsedArgs.maxImageBytes === undefined
      ? {}
      : { maxImageBytes: parsePositiveIntegerValue(parsedArgs.maxImageBytes, "max output") }),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

export function screenshotWantsJsonOutput(args: readonly string[]): boolean {
  return parseScreenshotArguments(args).json;
}

function parseScreenshotArguments(args: readonly string[]): ParsedScreenshotArguments {
  const optionArgs: string[] = [];
  const parsed: {
    outputPath?: string;
    format: "png" | "jpeg";
    fullPage: boolean;
    quality?: string;
    timeout?: string;
    maxImageBytes?: string;
    json: boolean;
  } = { format: "png", fullPage: false, json: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    switch (arg) {
      case "--json":
        parsed.json = true;
        optionArgs.push(arg);
        break;
      case "--timeout":
        parsed.timeout = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--max-output":
        parsed.maxImageBytes = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--full":
        parsed.fullPage = true;
        break;
      case "--format":
      case "--screenshot-format": {
        const format = readFlagValue(args, index, arg).toLowerCase();
        if (!isScreenshotFormat(format)) {
          throw new CliUsageError("Only PNG and JPEG screenshots are supported.");
        }
        parsed.format = format;
        index += 1;
        break;
      }
      case "--screenshot-quality":
        parsed.quality = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--window":
      case "--tab": {
        const value = readFlagValue(args, index, arg);
        optionArgs.push(arg, value);
        index += 1;
        break;
      }
      default:
        if (arg.startsWith("-")) {
          throw new CliUsageError(`Unsupported screenshot option: ${arg}`);
        }
        if (parsed.outputPath !== undefined) {
          throw new CliUsageError("Specify at most one screenshot path.");
        }
        parsed.outputPath = arg;
        break;
    }
  }

  return {
    optionArgs,
    ...(parsed.outputPath === undefined ? {} : { outputPath: parsed.outputPath }),
    format: parsed.format,
    fullPage: parsed.fullPage,
    ...(parsed.quality === undefined ? {} : { quality: parsed.quality }),
    ...(parsed.timeout === undefined ? {} : { timeout: parsed.timeout }),
    ...(parsed.maxImageBytes === undefined ? {} : { maxImageBytes: parsed.maxImageBytes }),
    json: parsed.json,
  };
}
