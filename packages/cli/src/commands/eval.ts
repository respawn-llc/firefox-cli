import type { RequestEnvelope } from "@firefox-cli/protocol";
import { readProcessStdin } from "../default-dependencies.js";
import {
  optionalTarget,
  parsePositiveIntegerValue,
  parseTargetOptions,
  readFlagValue,
} from "../parse.js";
import { createValidatedRequest } from "../protocol-validation.js";
import { CliUsageError, type CliDependencies } from "../types.js";

type ParsedEvalArguments = {
  readonly optionArgs: readonly string[];
  readonly source: "argv" | "stdin" | "base64";
  readonly script?: string;
  readonly base64?: string;
  readonly timeout?: string;
  readonly maxResultBytes?: string;
  readonly json: boolean;
};

export async function buildEvalRequest(
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<RequestEnvelope> {
  const parsedArgs = parseEvalArguments(argv.slice(1));
  const script = await readEvalScript(parsedArgs, dependencies);
  return createValidatedRequest("eval", {
    script,
    source: parsedArgs.source,
    ...(parsedArgs.timeout === undefined
      ? {}
      : { timeoutMs: parsePositiveIntegerValue(parsedArgs.timeout, "timeout") }),
    ...(parsedArgs.maxResultBytes === undefined
      ? {}
      : { maxResultBytes: parsePositiveIntegerValue(parsedArgs.maxResultBytes, "max output") }),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

export function evalWantsJsonOutput(args: readonly string[]): boolean {
  return parseEvalArguments(args).json;
}

function parseEvalArguments(args: readonly string[]): ParsedEvalArguments {
  const optionArgs: string[] = [];
  const scriptParts: string[] = [];
  const sourceFlags: ("stdin" | "base64")[] = [];
  const parsed: {
    source?: "stdin" | "base64";
    base64?: string;
    timeout?: string;
    maxResultBytes?: string;
    json: boolean;
  } = { json: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--") {
      scriptParts.push(...args.slice(index + 1));
      break;
    }

    switch (arg) {
      case "--json":
        parsed.json = true;
        optionArgs.push(arg);
        break;
      case "--stdin":
        parsed.source = "stdin";
        sourceFlags.push("stdin");
        break;
      case "-b":
      case "--base64":
        parsed.source = "base64";
        sourceFlags.push("base64");
        parsed.base64 = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--timeout":
        parsed.timeout = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--max-output":
        parsed.maxResultBytes = readFlagValue(args, index, arg);
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
          throw new CliUsageError(`Unsupported eval option: ${arg}`);
        }
        scriptParts.push(arg);
        break;
    }
  }

  const script = scriptParts.length === 0 ? undefined : scriptParts.join(" ");
  const sourceCount = (script === undefined ? 0 : 1) + sourceFlags.length;
  if (sourceCount !== 1) {
    throw new CliUsageError("Specify exactly one eval source.");
  }

  return {
    optionArgs,
    source: parsed.source ?? "argv",
    ...(script === undefined ? {} : { script }),
    ...(parsed.base64 === undefined ? {} : { base64: parsed.base64 }),
    ...(parsed.timeout === undefined ? {} : { timeout: parsed.timeout }),
    ...(parsed.maxResultBytes === undefined ? {} : { maxResultBytes: parsed.maxResultBytes }),
    json: parsed.json,
  };
}

async function readEvalScript(
  args: ParsedEvalArguments,
  dependencies: CliDependencies,
): Promise<string> {
  const script =
    args.source === "stdin"
      ? await (dependencies.readStdin?.() ?? readProcessStdin())
      : args.source === "base64"
        ? decodeBase64(args.base64 ?? "")
        : (args.script ?? "");

  if (script.length === 0) {
    throw new CliUsageError("Eval script is empty.");
  }

  return script;
}

function decodeBase64(value: string): string {
  const normalized = value.trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(normalized)) {
    throw new CliUsageError("Invalid base64 eval script.");
  }

  return Buffer.from(normalized, "base64").toString("utf8");
}
