import type { TargetSelector } from "@firefox-cli/protocol";
import { cliArgumentOptionInventory } from "./argv-contracts.js";
import { readFlagValue } from "./parse-options.js";
import { CliUsageError } from "./types.js";
export {
  getOptionValue,
  isOneOf,
  isRecord,
  normalizeOptionalUrl,
  optionalBooleanFlag,
  optionalNumberOption,
  optionalPositiveInteger,
  optionalStringOption,
  optionalUrl,
  parsePositiveIntegerValue,
} from "./parse-options.js";

export function getPositionals(
  args: readonly string[],
  options: { readonly preserveUnknownOptions?: boolean; readonly minPositionals?: number } = {},
): readonly string[] {
  return parsePositionalsAndOptions(args, options).positionals;
}

export function parsePositionalsAndOptions(
  args: readonly string[],
  options: { readonly preserveUnknownOptions?: boolean; readonly minPositionals?: number } = {},
): { readonly positionals: readonly string[]; readonly optionArgs: readonly string[] } {
  const positionals: string[] = [];
  const optionArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (isBooleanPositionalOption(arg)) {
      if (
        shouldPreserveOptionLiteral({
          args,
          index,
          width: 1,
          currentPositionals: positionals.length,
          options,
        })
      ) {
        positionals.push(arg);
      } else {
        optionArgs.push(arg);
      }
      continue;
    }

    if (isValuePositionalOption(arg)) {
      if (
        shouldPreserveOptionLiteral({
          args,
          index,
          width: 2,
          currentPositionals: positionals.length,
          options,
        })
      ) {
        positionals.push(arg);
        continue;
      }
      optionArgs.push(arg);
      const value = args[index + 1];
      if (value !== undefined) {
        optionArgs.push(value);
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--") && options.preserveUnknownOptions !== true) {
      continue;
    }

    positionals.push(arg);
  }

  return { positionals, optionArgs };
}

export function parsePayloadPositionalsAndOptions(
  args: readonly string[],
  options: {
    readonly payloadStartPositionals: number;
    readonly minPositionals: number;
    readonly variadicAfterMin?: boolean;
  },
): { readonly positionals: readonly string[]; readonly optionArgs: readonly string[] } {
  const positionals: string[] = [];
  const optionArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (isBooleanPositionalOption(arg)) {
      if (
        shouldTreatOptionAsPayload({
          args,
          index,
          width: 1,
          currentPositionals: positionals.length,
          options,
        })
      ) {
        positionals.push(arg);
      } else {
        optionArgs.push(arg);
      }
      continue;
    }

    if (isValuePositionalOption(arg)) {
      if (
        shouldTreatOptionAsPayload({
          args,
          index,
          width: 2,
          currentPositionals: positionals.length,
          options,
        })
      ) {
        positionals.push(arg);
        continue;
      }

      optionArgs.push(arg);
      const value = args[index + 1];
      if (value !== undefined) {
        optionArgs.push(value);
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--") && positionals.length < options.payloadStartPositionals) {
      continue;
    }

    positionals.push(arg);
  }

  return { positionals, optionArgs };
}

function isBooleanPositionalOption(arg: string): boolean {
  return cliArgumentOptionInventory.flags.has(arg);
}

function isValuePositionalOption(arg: string): boolean {
  return cliArgumentOptionInventory.valueOptions.has(arg);
}

function shouldPreserveOptionLiteral(context: {
  readonly args: readonly string[];
  readonly index: number;
  readonly width: number;
  readonly currentPositionals: number;
  readonly options: { readonly preserveUnknownOptions?: boolean; readonly minPositionals?: number };
}): boolean {
  const { args, index, width, currentPositionals, options } = context;
  const minimum = options.minPositionals ?? 0;
  return options.preserveUnknownOptions === true && currentPositionals + Math.max(0, args.length - index - width) < minimum;
}

function shouldTreatOptionAsPayload(context: {
  readonly args: readonly string[];
  readonly index: number;
  readonly width: number;
  readonly currentPositionals: number;
  readonly options: {
    readonly payloadStartPositionals: number;
    readonly minPositionals: number;
    readonly variadicAfterMin?: boolean;
  };
}): boolean {
  const { args, index, width, currentPositionals, options } = context;
  if (currentPositionals < options.payloadStartPositionals) {
    return false;
  }

  if (options.variadicAfterMin === true && currentPositionals >= options.minPositionals) {
    return true;
  }

  return currentPositionals + Math.max(0, args.length - index - width) < options.minPositionals;
}

export function parseTargetOptions(args: readonly string[]): TargetSelector {
  let target: TargetSelector = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--window") {
      target = mergeTarget(target, { window: parseTargetValue(readFlagValue(args, index, arg)) });
      index += 1;
    } else if (arg === "--tab") {
      target = mergeTarget(target, { tab: parseTargetValue(readFlagValue(args, index, arg)) });
      index += 1;
    }
  }

  return target;
}

export function parseTargetValue(value: string | undefined): NonNullable<TargetSelector["tab"]> {
  if (value === undefined || value === "active") {
    return { kind: "active" };
  }

  const [prefix, rawValue] = value.includes(":") ? value.split(":", 2) : ["index", value];
  if (prefix !== "id" && prefix !== "index") {
    throw new CliUsageError(`Invalid target prefix: ${String(prefix)}`);
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliUsageError(`Invalid target: ${value}`);
  }

  return prefix === "id" ? { kind: "id", id: parsed } : { kind: "index", index: parsed };
}

export function parseOptionalTabTarget(value: string | undefined, base: TargetSelector): TargetSelector {
  if (value !== undefined) {
    return { tab: parseTargetValue(value) };
  }

  return base.tab === undefined ? { tab: { kind: "active" } } : {};
}

export function parseOptionalWindowTarget(value: string | undefined, base: TargetSelector): TargetSelector {
  if (value !== undefined) {
    return { window: parseTargetValue(value) };
  }

  return base.window === undefined ? { window: { kind: "active" } } : {};
}

export function mergeTarget(base: TargetSelector, override: TargetSelector): TargetSelector {
  return {
    ...(base.window === undefined ? {} : { window: base.window }),
    ...(base.tab === undefined ? {} : { tab: base.tab }),
    ...(override.window === undefined ? {} : { window: override.window }),
    ...(override.tab === undefined ? {} : { tab: override.tab }),
  };
}

export function optionalTarget(target: TargetSelector): { readonly target?: TargetSelector } {
  return target.window === undefined && target.tab === undefined ? {} : { target };
}

export function parseElementTarget(value: string | undefined): {
  readonly selector?: string;
  readonly ref?: string;
} {
  if (value === undefined) {
    return {};
  }

  if (/^@e[1-9]\d*$/u.test(value)) {
    return { ref: value };
  }

  if (value.startsWith("@")) {
    throw new CliUsageError(`Invalid ref: ${value}`);
  }

  return { selector: value };
}

export function sourceDragTarget(
  value: string,
  role: "source" | "target",
): {
  readonly sourceSelector?: string;
  readonly sourceRef?: string;
  readonly targetSelector?: string;
  readonly targetRef?: string;
} {
  const parsed = parseElementTarget(value);
  if (role === "source") {
    return parsed.ref === undefined ? { sourceSelector: parsed.selector ?? value } : { sourceRef: parsed.ref };
  }
  return parsed.ref === undefined ? { targetSelector: parsed.selector ?? value } : { targetRef: parsed.ref };
}

export function hasOption(args: readonly string[], option: string): boolean {
  return args.includes(option);
}
