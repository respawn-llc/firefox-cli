import type { RequestEnvelope } from "@firefox-cli/protocol";
import {
  getPositionals,
  normalizeOptionalUrl,
  optionalBooleanFlag,
  optionalPositiveInteger,
  optionalStringOption,
  optionalTarget,
  parseElementTarget,
  parsePayloadPositionalsAndOptions,
  parsePositionalsAndOptions,
  parseTargetOptions,
} from "../parse.js";
import { createValidatedRequest } from "../protocol-validation.js";
import { CliUsageError } from "../types.js";
import {
  isClipboardAction,
  isCookieAction,
  isDialogAction,
  isDiffKind,
  isFindKind,
  isGetKind,
  isIsKind,
  isLogAction,
  isNetworkAction,
  isStorageAction,
  isStorageArea,
} from "./guards.js";

export function buildSnapshotRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  return createValidatedRequest("snapshot", {
    interactiveOnly: args.includes("-i") || args.includes("--interactive"),
    compact: args.includes("-c") || args.includes("--compact") || !args.includes("--verbose"),
    ...optionalPositiveInteger(args, ["-d", "--depth"], "depth", "maxDepth"),
    ...optionalStringOption(args, ["-s", "--selector"], "selector"),
    ...optionalPositiveInteger(args, ["--max-output"], "max output", "maxOutputBytes"),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

export function buildRefRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const ref = getPositionals(args)[0];
  if (ref === undefined) {
    throw new CliUsageError("Missing ref.");
  }
  return createValidatedRequest("ref.resolve", {
    ref,
    ...optionalStringOption(args, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

export function buildGetRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const positional = getPositionals(args);
  const kind = positional[0];
  if (!isGetKind(kind)) {
    throw new CliUsageError("Missing or invalid get kind.");
  }
  const elementTarget = positional[1];
  const attribute = positional[2];
  if (kind === "attr" && attribute === undefined) {
    throw new CliUsageError("Missing attribute name.");
  }
  if ((kind === "title" || kind === "url") && elementTarget !== undefined) {
    throw new CliUsageError(`get ${kind} does not accept a selector or ref.`);
  }
  if (kind !== "title" && kind !== "url" && elementTarget === undefined) {
    throw new CliUsageError("Missing selector or ref.");
  }
  return createValidatedRequest("get", {
    kind,
    ...parseElementTarget(elementTarget),
    ...(kind === "attr" && attribute !== undefined ? { attribute } : {}),
    ...optionalStringOption(args, ["--generation"], "generationId"),
    ...optionalPositiveInteger(args, ["--max-output"], "max output", "maxOutputBytes"),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

export function buildIsRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const positional = getPositionals(args);
  const kind = positional[0];
  if (!isIsKind(kind)) {
    throw new CliUsageError("Missing or invalid is kind.");
  }
  const elementTarget = positional[1];
  if (elementTarget === undefined) {
    throw new CliUsageError("Missing selector or ref.");
  }
  return createValidatedRequest("is", {
    kind,
    ...parseElementTarget(elementTarget),
    ...optionalStringOption(args, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

export function buildFindRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 1,
    minPositionals: 2,
  });
  const [kind, value] = parsed.positionals;
  if (!isFindKind(kind) || value === undefined) {
    throw new CliUsageError("Missing or invalid find kind/value.");
  }
  return createValidatedRequest("find", {
    kind,
    value,
    ...optionalBooleanFlag(parsed.optionArgs, "--first", "first"),
    ...optionalBooleanFlag(parsed.optionArgs, "--last", "last"),
    ...optionalPositiveInteger(parsed.optionArgs, ["--nth"], "nth", "nth"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

export function buildFrameRequest(argv: readonly string[]): RequestEnvelope {
  return createValidatedRequest("frame", { ...optionalTarget(parseTargetOptions(argv.slice(1))) });
}

export function buildDownloadRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  parseTargetOptions(args);
  const positional = getPositionals(args);
  const url = normalizeOptionalUrl(positional[0]);
  if (url === undefined) {
    throw new CliUsageError("Missing download URL.");
  }
  return createValidatedRequest("download", {
    url,
    ...(positional[1] === undefined ? {} : { filename: positional[1] }),
    saveAs: args.includes("--save-as"),
  });
}

export function buildDialogRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const positional = getPositionals(args, { preserveUnknownOptions: true });
  const action = positional[0] ?? "status";
  if (!isDialogAction(action)) {
    throw new CliUsageError("Missing or invalid dialog action.");
  }
  return createValidatedRequest("dialog", {
    action,
    ...(positional[1] === undefined ? {} : { promptText: positional[1] }),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

export function buildClipboardRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 1,
    minPositionals: 1,
  });
  const action = parsed.positionals[0] ?? "read";
  if (!isClipboardAction(action)) {
    throw new CliUsageError("Missing or invalid clipboard action.");
  }
  const value = parsed.positionals[1];
  return createValidatedRequest("clipboard", {
    action,
    ...(action === "write" ? { text: value ?? "" } : parseElementTarget(value)),
    ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

export function buildCookiesRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 2,
    minPositionals: 2,
  });
  parseTargetOptions(parsed.optionArgs);
  const [action, url, name, value] = parsed.positionals;
  if (!isCookieAction(action) || url === undefined) {
    throw new CliUsageError("Missing or invalid cookies action/url.");
  }
  return createValidatedRequest("cookies", {
    action,
    url: normalizeOptionalUrl(url) ?? url,
    ...(name === undefined ? {} : { name }),
    ...(value === undefined ? {} : { value }),
  });
}

export function buildStorageRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 2,
    minPositionals: 2,
  });
  const [area, action, key, value] = parsed.positionals;
  if (!isStorageArea(area) || !isStorageAction(action)) {
    throw new CliUsageError("Missing or invalid storage area/action.");
  }
  return createValidatedRequest("storage", {
    area,
    action,
    ...(key === undefined ? {} : { key }),
    ...(value === undefined ? {} : { value }),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

export function buildNetworkRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  parseTargetOptions(args);
  const action = getPositionals(args)[0] ?? "list";
  if (!isNetworkAction(action)) {
    throw new CliUsageError("Missing or invalid network action.");
  }
  return createValidatedRequest("network", {
    action,
    ...optionalStringOption(args, ["--url"], "urlGlob"),
  });
}

export function buildLogRequest(argv: readonly string[]): RequestEnvelope {
  const command = argv[0];
  if (command !== "console" && command !== "errors") {
    throw new CliUsageError("Invalid log command.");
  }
  const args = argv.slice(1);
  const action = getPositionals(args)[0] ?? "list";
  if (!isLogAction(action)) {
    throw new CliUsageError(`Missing or invalid ${command} action.`);
  }
  return createValidatedRequest(command, { action, ...optionalTarget(parseTargetOptions(args)) });
}

export function buildHighlightRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePositionalsAndOptions(argv.slice(1));
  const elementTarget = parsed.positionals[0];
  if (elementTarget === undefined) {
    throw new CliUsageError("Missing selector or ref.");
  }
  return createValidatedRequest("highlight", {
    ...parseElementTarget(elementTarget),
    ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
    ...optionalPositiveInteger(parsed.optionArgs, ["--duration"], "duration", "durationMs"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

export function buildDiffRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 1,
    minPositionals: 2,
  });
  const [kind, expected] = parsed.positionals;
  if (!isDiffKind(kind) || expected === undefined) {
    throw new CliUsageError("Missing or invalid diff kind/expected value.");
  }
  return createValidatedRequest("diff", {
    kind,
    expected,
    ...optionalStringOption(parsed.optionArgs, ["--selector"], "selector"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}
