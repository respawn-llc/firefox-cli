import type { RequestEnvelope } from "@firefox-cli/protocol";
import { readProcessStdin } from "../default-dependencies.js";
import { parseCliRouteArgsForRoute } from "../argv-contracts.js";
import { getOptionValue, hasOption, optionalTarget, parsePositiveIntegerValue, parseTargetOptions } from "../parse.js";
import { createValidatedRequest } from "../protocol-validation.js";
import { CliUsageError, type CliDependencies } from "../types.js";

interface ParsedEvalArguments {
  readonly optionArgs: readonly string[];
  readonly source: "argv" | "stdin" | "base64";
  readonly script?: string;
  readonly base64?: string;
  readonly timeout?: string;
  readonly maxResultBytes?: string;
  readonly json: boolean;
}

export async function buildEvalRequest(argv: readonly string[], dependencies: CliDependencies): Promise<RequestEnvelope> {
  const parsedArgs = parseEvalArguments(argv.slice(1));
  const script = await readEvalScript(parsedArgs, dependencies);
  return createValidatedRequest("eval", {
    script,
    source: parsedArgs.source,
    ...(parsedArgs.timeout === undefined ? {} : { timeoutMs: parsePositiveIntegerValue(parsedArgs.timeout, "timeout") }),
    ...(parsedArgs.maxResultBytes === undefined ? {} : { maxResultBytes: parsePositiveIntegerValue(parsedArgs.maxResultBytes, "max output") }),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

export function evalWantsJsonOutput(args: readonly string[]): boolean {
  return parseEvalArguments(args).json;
}

function parseEvalArguments(args: readonly string[]): ParsedEvalArguments {
  const parsed = parseCliRouteArgsForRoute("eval", args);
  const base64 = getOptionValue(parsed.optionArgs, ["-b", "--base64"]);
  const timeout = getOptionValue(parsed.optionArgs, ["--timeout"]);
  const maxResultBytes = getOptionValue(parsed.optionArgs, ["--max-output"]);
  const script = parsed.positionals.length === 0 ? undefined : parsed.positionals.join(" ");
  const sourceCount = (script === undefined ? 0 : 1) + (hasOption(parsed.optionArgs, "--stdin") ? 1 : 0) + (base64 === undefined ? 0 : 1);
  if (sourceCount !== 1) {
    throw new CliUsageError("Specify exactly one eval source.");
  }

  return {
    optionArgs: parsed.optionArgs,
    source: base64 !== undefined ? "base64" : hasOption(parsed.optionArgs, "--stdin") ? "stdin" : "argv",
    ...(script === undefined ? {} : { script }),
    ...(base64 === undefined ? {} : { base64 }),
    ...(timeout === undefined ? {} : { timeout }),
    ...(maxResultBytes === undefined ? {} : { maxResultBytes }),
    json: parsed.json,
  };
}

async function readEvalScript(args: ParsedEvalArguments, dependencies: CliDependencies): Promise<string> {
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
