import { z } from "zod";

import type { CliRouteSelectorDimensions, CommandSchemaEntry } from "../metadata.js";

export type CommandRegistryFragment = Readonly<Record<string, CommandSchemaEntry>>;

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;

type AssembledCommandRegistry<Fragments extends readonly CommandRegistryFragment[]> = UnionToIntersection<Fragments[number]>;

export function defineCommandEntries<const T extends CommandRegistryFragment>(entries: T): T {
  return entries;
}

export function assembleCommandRegistry<const Fragments extends readonly CommandRegistryFragment[]>(
  ...fragments: Fragments
): AssembledCommandRegistry<Fragments>;
export function assembleCommandRegistry(...fragments: readonly CommandRegistryFragment[]): CommandRegistryFragment {
  const registry: Record<string, CommandSchemaEntry> = {};
  for (const fragment of fragments) {
    for (const [command, schema] of Object.entries(fragment)) {
      if (Object.hasOwn(registry, command)) {
        throw new Error(`Duplicate command id: ${command}`);
      }
      registry[command] = schema;
    }
  }
  assertCliRouteSelectorDimensions(registry);

  return registry;
}

function assertCliRouteSelectorDimensions(registry: Readonly<Record<string, CommandSchemaEntry>>): void {
  for (const [command, schema] of Object.entries(registry)) {
    for (const route of schema.cliRoutes) {
      const selectorDimensions: CliRouteSelectorDimensions = route.selectorDimensions;
      const paramsSelectorDimensions = selectorDimensionsAcceptedByCommand(schema);
      if (selectorDimensions !== paramsSelectorDimensions) {
        throw new Error(
          `CLI route selector dimensions disagree with command params: ${command} (${route.id}) declares ${selectorDimensions}, params accept ${paramsSelectorDimensions}.`,
        );
      }
    }
  }
}

function selectorDimensionsAcceptedByCommand(schema: CommandSchemaEntry): CliRouteSelectorDimensions {
  if (!(schema.params instanceof z.ZodObject)) {
    return "neither";
  }
  // Zod's public object shape getter is untyped in v4 despite the runtime schema boundary.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const selectorSchema = schema.params.def.shape.target;
  if (selectorSchema === undefined) return "neither";
  const acceptsWindow = selectorSchema.safeParse({ window: { kind: "active" } }).success;
  const acceptsTab = selectorSchema.safeParse({ tab: { kind: "active" } }).success;
  if (acceptsWindow && acceptsTab) {
    return "both";
  }
  if (acceptsWindow) {
    return "window";
  }
  if (acceptsTab) {
    return "tab";
  }
  return "neither";
}
