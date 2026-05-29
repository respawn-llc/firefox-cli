import type { RequestEnvelope } from "@firefox-cli/protocol";
import {
  getPositionals,
  mergeTarget,
  normalizeOptionalUrl,
  optionalTarget,
  optionalUrl,
  parseOptionalTabTarget,
  parseOptionalWindowTarget,
  parseTargetOptions,
} from "../parse.js";
import { createValidatedRequest } from "../protocol-validation.js";

export function buildTabsRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const positional = getPositionals(args);
  const subcommand = positional[0];
  const target = parseTargetOptions(args);
  if (subcommand === "new") {
    return createValidatedRequest("tab.new", {
      ...optionalUrl(normalizeOptionalUrl(positional[1])),
      ...optionalTarget(target),
    });
  }
  if (subcommand === "select") {
    return createValidatedRequest("tab.select", {
      target: mergeTarget(target, parseOptionalTabTarget(positional[1], target)),
    });
  }
  if (subcommand === "close") {
    return createValidatedRequest("tab.close", {
      target: mergeTarget(target, parseOptionalTabTarget(positional[1], target)),
    });
  }
  return createValidatedRequest("tabs.list", {
    ...optionalTarget(target),
  });
}

export function buildWindowsRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const positional = getPositionals(args);
  const subcommand = positional[0];
  const target = parseTargetOptions(args);
  if (subcommand === "new") {
    return createValidatedRequest("window.new", {
      ...optionalUrl(normalizeOptionalUrl(positional[1])),
    });
  }
  if (subcommand === "select") {
    return createValidatedRequest("window.select", {
      target: mergeTarget(target, parseOptionalWindowTarget(positional[1], target)),
    });
  }
  if (subcommand === "close") {
    return createValidatedRequest("window.close", {
      target: mergeTarget(target, parseOptionalWindowTarget(positional[1], target)),
    });
  }
  return createValidatedRequest("windows.list", {});
}
