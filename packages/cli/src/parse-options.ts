import { CliUsageError } from "./types.js";

export function optionalBooleanFlag(args: readonly string[], flag: string, outputKey: "first"): { readonly first?: true };
export function optionalBooleanFlag(args: readonly string[], flag: string, outputKey: "last"): { readonly last?: true };
export function optionalBooleanFlag(args: readonly string[], flag: string, outputKey: "first" | "last"): { readonly first?: true; readonly last?: true } {
  if (!args.includes(flag)) {
    return {};
  }
  return outputKey === "first" ? { first: true } : { last: true };
}

export function optionalNumberOption(args: readonly string[], names: readonly string[], outputKey: "x"): { readonly x?: number };
export function optionalNumberOption(args: readonly string[], names: readonly string[], outputKey: "y"): { readonly y?: number };
export function optionalNumberOption(args: readonly string[], names: readonly string[], outputKey: "button"): { readonly button?: number };
export function optionalNumberOption(args: readonly string[], names: readonly string[], outputKey: "deltaX"): { readonly deltaX?: number };
export function optionalNumberOption(args: readonly string[], names: readonly string[], outputKey: "deltaY"): { readonly deltaY?: number };
export function optionalNumberOption(
  args: readonly string[],
  names: readonly string[],
  outputKey: "x" | "y" | "button" | "deltaX" | "deltaY",
): {
  readonly x?: number;
  readonly y?: number;
  readonly button?: number;
  readonly deltaX?: number;
  readonly deltaY?: number;
} {
  const value = getOptionValue(args, names);
  if (value === undefined) {
    return {};
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CliUsageError(`Invalid ${outputKey}: ${value}`);
  }
  switch (outputKey) {
    case "x":
      return { x: parsed };
    case "y":
      return { y: parsed };
    case "button":
      return { button: parsed };
    case "deltaX":
      return { deltaX: parsed };
    case "deltaY":
      return { deltaY: parsed };
  }
}

export function optionalUrl(url: string | undefined): { readonly url?: string } {
  return url === undefined ? {} : { url };
}

export function optionalStringOption(args: readonly string[], names: readonly string[], outputKey: "selector"): { readonly selector?: string };
export function optionalStringOption(args: readonly string[], names: readonly string[], outputKey: "generationId"): { readonly generationId?: string };
export function optionalStringOption(args: readonly string[], names: readonly string[], outputKey: "urlGlob"): { readonly urlGlob?: string };
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
export function optionalPositiveInteger(args: readonly string[], names: readonly string[], label: string, outputKey: "nth"): { readonly nth?: number };
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

export function getOptionValue(args: readonly string[], names: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    if (names.includes(args[index] ?? "")) {
      const value = args[index + 1];
      if (value === undefined) {
        throw new CliUsageError(`Missing value for ${String(args[index])}.`);
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

export function isOneOf<const T extends readonly string[]>(values: T, value: string | undefined): value is T[number] {
  return value !== undefined && values.includes(value);
}
