import { resolve } from "node:path";
import type { RequestEnvelope } from "@firefox-cli/protocol";
import { getPositionals, optionalTarget, parsePositiveIntegerValue, parseTargetOptions } from "../parse.js";
import { createValidatedRequest } from "../protocol-validation.js";
import { CliUsageError, type CliDependencies } from "../types.js";

export function buildPdfRequest(argv: readonly string[], dependencies: CliDependencies): RequestEnvelope {
  const path = getPositionals(argv.slice(1))[0];
  if (path === undefined) {
    throw new CliUsageError("Missing PDF path.");
  }
  return createValidatedRequest("pdf", {
    path: resolve(dependencies.cwd ?? process.cwd(), path),
    ...optionalTarget(parseTargetOptions(argv.slice(1))),
  });
}

export function buildSetViewportRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const positional = getPositionals(args);
  if (positional[0] !== "viewport") {
    throw new CliUsageError("Missing or invalid set command.");
  }
  return createValidatedRequest("set.viewport", {
    width: parsePositiveIntegerValue(positional[1] ?? "", "width"),
    height: parsePositiveIntegerValue(positional[2] ?? "", "height"),
    ...optionalTarget(parseTargetOptions(args)),
  });
}
