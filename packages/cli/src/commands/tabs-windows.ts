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
    const selectedTarget = mergeTarget(target, parseOptionalTabTarget(positional[1]));
    return createValidatedRequest("tab.select", {
      ...optionalTarget(selectedTarget),
    });
  }
  if (subcommand === "close") {
    const selectedTarget = mergeTarget(target, parseOptionalTabTarget(positional[1]));
    return createValidatedRequest("tab.close", {
      ...optionalTarget(selectedTarget),
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
    const selectedTarget = mergeTarget(target, parseOptionalWindowTarget(positional[1]));
    return createValidatedRequest("window.select", {
      ...optionalTarget(selectedTarget),
    });
  }
  if (subcommand === "close") {
    const selectedTarget = mergeTarget(target, parseOptionalWindowTarget(positional[1]));
    return createValidatedRequest("window.close", {
      ...optionalTarget(selectedTarget),
    });
  }
  return createValidatedRequest("windows.list", {});
}
