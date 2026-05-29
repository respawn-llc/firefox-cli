import type { RequestEnvelope } from "@firefox-cli/protocol";
import {
  getPositionals,
  normalizeOptionalUrl,
  optionalTarget,
  parseTargetOptions,
} from "../parse.js";
import { createValidatedRequest } from "../protocol-validation.js";
import { CliUsageError } from "../types.js";

export function buildCapabilitiesRequest(argv: readonly string[]): RequestEnvelope {
  parseTargetOptions(argv.slice(1));
  return createValidatedRequest("capabilities", {});
}

export function buildOpenRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const url = normalizeOptionalUrl(getPositionals(args)[0]);
  if (url === undefined) {
    throw new CliUsageError("Missing URL.");
  }
  return createValidatedRequest("open", {
    url,
    newTab: args.includes("--new-tab"),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

export function buildNavigationRequest(argv: readonly string[]): RequestEnvelope {
  const command = argv[0];
  if (command !== "back" && command !== "forward" && command !== "reload") {
    throw new CliUsageError("Invalid navigation command.");
  }
  const args = argv.slice(1);
  return createValidatedRequest(command, {
    ...optionalTarget(parseTargetOptions(args)),
  });
}
