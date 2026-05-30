import type { TargetSelector } from "@firefox-cli/protocol";
import { cliArgumentOptionInventory } from "./argv-contracts.js";
import { CliUsageError } from "./types.js";

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
      if (shouldPreserveOptionLiteral(args, index, 1, positionals.length, options)) {
        positionals.push(arg);
      } else {
        optionArgs.push(arg);
      }
      continue;
    }

    if (isValuePositionalOption(arg)) {
      if (shouldPreserveOptionLiteral(args, index, 2, positionals.length, options)) {
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
      if (shouldTreatOptionAsPayload(args, index, 1, positionals.length, options)) {
        positionals.push(arg);
      } else {
        optionArgs.push(arg);
      }
      continue;
    }

    if (isValuePositionalOption(arg)) {
      if (shouldTreatOptionAsPayload(args, index, 2, positionals.length, options)) {
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

function shouldPreserveOptionLiteral(
  args: readonly string[],
  index: number,
  width: number,
  currentPositionals: number,
  options: { readonly preserveUnknownOptions?: boolean; readonly minPositionals?: number },
): boolean {
  const minimum = options.minPositionals ?? 0;
  return (
    options.preserveUnknownOptions === true &&
    currentPositionals + Math.max(0, args.length - index - width) < minimum
  );
}

function shouldTreatOptionAsPayload(
  args: readonly string[],
  index: number,
  width: number,
  currentPositionals: number,
  options: {
    readonly payloadStartPositionals: number;
    readonly minPositionals: number;
    readonly variadicAfterMin?: boolean;
  },
): boolean {
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
    throw new CliUsageError(`Invalid target prefix: ${prefix}`);
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliUsageError(`Invalid target: ${value}`);
  }

  return prefix === "id" ? { kind: "id", id: parsed } : { kind: "index", index: parsed };
}

export function parseOptionalTabTarget(
  value: string | undefined,
  base: TargetSelector,
): TargetSelector {
  if (value !== undefined) {
    return { tab: parseTargetValue(value) };
  }

  return base.tab === undefined ? { tab: { kind: "active" } } : {};
}

export function parseOptionalWindowTarget(
  value: string | undefined,
  base: TargetSelector,
): TargetSelector {
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
    return parsed.ref === undefined
      ? { sourceSelector: parsed.selector ?? value }
      : { sourceRef: parsed.ref };
  }
  return parsed.ref === undefined
    ? { targetSelector: parsed.selector ?? value }
    : { targetRef: parsed.ref };
}

export function hasOption(args: readonly string[], option: string): boolean {
  return args.includes(option);
}

export function optionalBooleanFlag<K extends string>(
  args: readonly string[],
  flag: string,
  outputKey: K,
): { readonly [P in K]?: true } {
  return args.includes(flag) ? ({ [outputKey]: true } as { readonly [P in K]?: true }) : {};
}

export function optionalNumberOption<K extends string>(
  args: readonly string[],
  names: readonly string[],
  outputKey: K,
): { readonly [P in K]?: number } {
  const value = getOptionValue(args, names);
  if (value === undefined) {
    return {};
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CliUsageError(`Invalid ${outputKey}: ${value}`);
  }
  return { [outputKey]: parsed } as { readonly [P in K]?: number };
}

export function optionalUrl(url: string | undefined): { readonly url?: string } {
  return url === undefined ? {} : { url };
}

export function optionalStringOption(
  args: readonly string[],
  names: readonly string[],
  outputKey: "selector",
): { readonly selector?: string };
export function optionalStringOption(
  args: readonly string[],
  names: readonly string[],
  outputKey: "generationId",
): { readonly generationId?: string };
export function optionalStringOption(
  args: readonly string[],
  names: readonly string[],
  outputKey: "urlGlob",
): { readonly urlGlob?: string };
export function optionalStringOption(
  args: readonly string[],
  names: readonly string[],
  outputKey: "selector" | "generationId" | "urlGlob",
): { readonly selector?: string; readonly generationId?: string; readonly urlGlob?: string } {
  const value = getOptionValue(args, names);
  if (value === undefined) {
    return {};
  }

  if (value.length === 0) {
    throw new CliUsageError(`Missing ${outputKey}.`);
  }

  return { [outputKey]: value };
}

export function optionalPositiveInteger(
  args: readonly string[],
  names: readonly string[],
  label: string,
  outputKey: "maxDepth" | "maxOutputBytes",
): { readonly maxDepth?: number; readonly maxOutputBytes?: number };
export function optionalPositiveInteger(
  args: readonly string[],
  names: readonly string[],
  label: string,
  outputKey: "durationMs",
): { readonly durationMs?: number };
export function optionalPositiveInteger(
  args: readonly string[],
  names: readonly string[],
  label: string,
  outputKey: "nth",
): { readonly nth?: number };
export function optionalPositiveInteger(
  args: readonly string[],
  names: readonly string[],
  label: string,
  outputKey: "maxDepth" | "maxOutputBytes" | "nth" | "durationMs",
): {
  readonly maxDepth?: number;
  readonly maxOutputBytes?: number;
  readonly nth?: number;
  readonly durationMs?: number;
} {
  const value = getOptionValue(args, names);
  if (value === undefined) {
    return {};
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || (outputKey === "maxOutputBytes" && parsed === 0)) {
    throw new CliUsageError(`Invalid ${label}: ${value}`);
  }

  return { [outputKey]: parsed };
}

export function parsePositiveIntegerValue(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliUsageError(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

export function readFlagValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new CliUsageError(`Missing value for ${flag}.`);
  }
  return value;
}

export function getOptionValue(
  args: readonly string[],
  names: readonly string[],
): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    if (names.includes(args[index] ?? "")) {
      const value = args[index + 1];
      if (value === undefined) {
        throw new CliUsageError(`Missing value for ${args[index]}.`);
      }
      return value;
    }
  }

  return undefined;
}

export function normalizeOptionalUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return value;
  }

  return `https://${value}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isOneOf<const T extends readonly string[]>(
  values: T,
  value: string | undefined,
): value is T[number] {
  return value !== undefined && values.includes(value);
}
