import { FIREFOX_CLI_EXTENSION_ID, FIREFOX_CLI_EXTENSION_UPDATE_URL } from "@firefox-cli/protocol";
import { CliUsageError } from "./types.js";

const extensionUpdatesFetchTimeoutMs = 10_000;

export type ExtensionUpdatesFetcher = () => Promise<unknown>;

export async function resolveExtensionInstallUrl(version: string, fetchUpdates: ExtensionUpdatesFetcher = fetchExtensionUpdates): Promise<string> {
  const metadata = await fetchUpdatesWithUsageError(fetchUpdates);
  const update = findMatchingExtensionUpdate(metadata, version);
  if (update === undefined) {
    throw new CliUsageError(`No firefox-cli extension download found for CLI version ${version} in ${FIREFOX_CLI_EXTENSION_UPDATE_URL}.`);
  }
  return update.updateLink;
}

async function fetchUpdatesWithUsageError(fetchUpdates: ExtensionUpdatesFetcher): Promise<unknown> {
  try {
    return await fetchUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliUsageError(`Failed to fetch firefox-cli extension update manifest from ${FIREFOX_CLI_EXTENSION_UPDATE_URL}: ${message}`);
  }
}

async function fetchExtensionUpdates(): Promise<unknown> {
  const response = await fetch(FIREFOX_CLI_EXTENSION_UPDATE_URL, {
    signal: AbortSignal.timeout(extensionUpdatesFetchTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)} ${response.statusText}`);
  }
  return response.json();
}

function findMatchingExtensionUpdate(metadata: unknown, version: string): { readonly updateLink: string } | undefined {
  const updates = parseExtensionUpdates(metadata);
  const matches = updates.filter((update) => update.version === version);
  if (matches.length > 1) {
    throw new CliUsageError(`Invalid firefox-cli extension update manifest: duplicate entries for version ${version}.`);
  }
  return matches[0];
}

function parseExtensionUpdates(metadata: unknown): readonly { readonly version: string; readonly updateLink: string }[] {
  const root = requireRecord(metadata, "extension update manifest");
  const addons = requireRecord(root.addons, "extension update manifest addons");
  const extensionMetadata = requireRecord(addons[FIREFOX_CLI_EXTENSION_ID], `extension update manifest add-on ${FIREFOX_CLI_EXTENSION_ID}`);
  const updates = requireArray(extensionMetadata.updates, `extension update manifest add-on ${FIREFOX_CLI_EXTENSION_ID} updates`);
  return updates.map(parseExtensionUpdate);
}

function parseExtensionUpdate(value: unknown, index: number): { readonly version: string; readonly updateLink: string } {
  const label = `extension update manifest update ${String(index)}`;
  const update = requireRecord(value, label);
  const version = requireString(update.version, `${label} version`);
  const updateLink = requireString(update.update_link, `${label} update_link`);
  if (!isHttpsUrl(updateLink)) {
    throw new CliUsageError(`Invalid firefox-cli extension download URL for version ${version}: expected HTTPS URL.`);
  }
  return { version, updateLink };
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliUsageError(`Invalid firefox-cli extension update manifest: expected ${label} to be an object.`);
  }
  return Object.fromEntries(Object.entries(value));
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new CliUsageError(`Invalid firefox-cli extension update manifest: expected ${label} to be an array.`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CliUsageError(`Invalid firefox-cli extension update manifest: expected ${label} to be a non-empty string.`);
  }
  return value;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
