import type { CommandSchemaEntry } from "../metadata.js";

export type CommandRegistryFragment = {
  readonly [command: string]: CommandSchemaEntry;
};

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

type AssembledCommandRegistry<Fragments extends readonly CommandRegistryFragment[]> = UnionToIntersection<
  Fragments[number]
>;

export function defineCommandEntries<const T extends CommandRegistryFragment>(entries: T): T {
  return entries;
}

export function assembleCommandRegistry<const Fragments extends readonly CommandRegistryFragment[]>(
  ...fragments: Fragments
): AssembledCommandRegistry<Fragments> {
  const registry: Record<string, CommandSchemaEntry> = Object.create(null);

  for (const fragment of fragments) {
    for (const [command, schema] of Object.entries(fragment)) {
      if (Object.hasOwn(registry, command)) {
        throw new Error(`Duplicate command id: ${command}`);
      }
      registry[command] = schema;
    }
  }

  return registry as AssembledCommandRegistry<Fragments>;
}
