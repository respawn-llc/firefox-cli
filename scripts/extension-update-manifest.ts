import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIREFOX_CLI_EXTENSION_ID } from "@firefox-cli/protocol";

export const extensionUpdateManifestPath = "docs/firefox-cli/updates.json";

export function extensionReleaseXpiUrl(version: string): string {
  return `https://github.com/respawn-llc/firefox-cli/releases/download/v${version}/firefox-cli-${version}.xpi`;
}

export async function syncExtensionUpdateManifest(options: { readonly root: string; readonly version: string }): Promise<readonly string[]> {
  const path = join(options.root, extensionUpdateManifestPath);
  const before = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  });
  const manifest = before === undefined ? createEmptyManifest() : parseUpdateManifest(before, path);
  const addon = ensureAddon(manifest);
  const existingUpdate = addon.updates.find((update) => update.version === options.version);
  const nextUpdate = {
    ...cloneUpdateTemplate(addon.updates.at(-1)),
    ...existingUpdate,
    version: options.version,
    update_link: extensionReleaseXpiUrl(options.version),
  };
  const filteredUpdates = addon.updates.filter((update) => update.version !== options.version);
  addon.updates = [...filteredUpdates, nextUpdate].sort((left, right) => left.version.localeCompare(right.version));
  const after = `${JSON.stringify(manifest, null, 2)}\n`;
  if (before === after) {
    return [];
  }
  await writeFile(path, after);
  return [extensionUpdateManifestPath];
}

export async function verifyExtensionUpdateManifestEntry(options: { readonly root: string; readonly version: string }): Promise<void> {
  const path = join(options.root, extensionUpdateManifestPath);
  const manifest = parseUpdateManifest(await readFile(path, "utf8"), path);
  const addon = requireAddon(manifest);
  const matches = addon.updates.filter((update) => update.version === options.version);
  if (matches.length === 0) {
    throw new Error(`Expected ${extensionUpdateManifestPath} to include extension version ${options.version}`);
  }
  if (matches.length > 1) {
    throw new Error(`Expected ${extensionUpdateManifestPath} to contain one entry for extension version ${options.version}`);
  }
  const expectedUrl = extensionReleaseXpiUrl(options.version);
  if (matches[0]?.update_link !== expectedUrl) {
    throw new Error(`Expected ${extensionUpdateManifestPath} version ${options.version} update_link ${expectedUrl}`);
  }
}

interface ExtensionUpdateManifest extends Record<string, unknown> {
  readonly addons: Record<string, ExtensionUpdateAddon>;
}

interface ExtensionUpdateAddon extends Record<string, unknown> {
  updates: ExtensionUpdate[];
}

interface ExtensionUpdate extends Record<string, unknown> {
  version: string;
  update_link: string;
}

function createEmptyManifest(): ExtensionUpdateManifest {
  return {
    addons: {
      [FIREFOX_CLI_EXTENSION_ID]: {
        updates: [],
      },
    },
  };
}

function ensureAddon(manifest: ExtensionUpdateManifest): ExtensionUpdateAddon {
  const existing = manifest.addons[FIREFOX_CLI_EXTENSION_ID];
  if (existing !== undefined) {
    return existing;
  }
  const addon = { updates: [] };
  manifest.addons[FIREFOX_CLI_EXTENSION_ID] = addon;
  return addon;
}

function requireAddon(manifest: ExtensionUpdateManifest): ExtensionUpdateAddon {
  const addon = manifest.addons[FIREFOX_CLI_EXTENSION_ID];
  if (addon === undefined) {
    throw new Error(`Expected ${extensionUpdateManifestPath} to include add-on ${FIREFOX_CLI_EXTENSION_ID}`);
  }
  return addon;
}

function cloneUpdateTemplate(update: ExtensionUpdate | undefined): Partial<ExtensionUpdate> {
  return update?.applications === undefined ? {} : { applications: update.applications };
}

function parseUpdateManifest(content: string, path: string): ExtensionUpdateManifest {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed) || !isRecord(parsed.addons)) {
    throw new Error(`${path} must contain an addons object.`);
  }
  const addons = Object.fromEntries(Object.entries(parsed.addons).map(([id, addon]) => [id, parseAddon(addon, path, id)]));
  return { ...copyRecord(parsed), addons };
}

function parseAddon(value: unknown, path: string, id: string): ExtensionUpdateAddon {
  if (!isRecord(value) || !Array.isArray(value.updates)) {
    throw new Error(`${path} add-on ${id} must contain an updates array.`);
  }
  return {
    ...copyRecord(value),
    updates: value.updates.map((update, index) => parseUpdate(update, path, id, index)),
  };
}

function parseUpdate(value: unknown, path: string, id: string, index: number): ExtensionUpdate {
  if (!isRecord(value) || typeof value.version !== "string" || typeof value.update_link !== "string") {
    throw new Error(`${path} add-on ${id} update ${String(index)} must contain version and update_link strings.`);
  }
  return {
    ...copyRecord(value),
    version: value.version,
    update_link: value.update_link,
  };
}

function copyRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
