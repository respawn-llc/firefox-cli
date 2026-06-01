import { FIREFOX_CLI_EXTENSION_ID } from "@firefox-cli/native-host";
import { getExtensionPermissionRequirements } from "@firefox-cli/protocol";
import rootPackage from "../package.json" with { type: "json" };
import { verifyExpectedExtensionDisplayMetadata } from "./extension-display-metadata.js";
import type { ExtensionManifest } from "./manifest-validation.js";

export function verifyExpectedExtensionManifest(manifest: ExtensionManifest): void {
  const requirements = getExtensionPermissionRequirements();
  const gecko = manifest.browser_specific_settings?.gecko;
  const geckoIdentity =
    gecko === undefined
      ? undefined
      : {
          id: gecko.id,
          ...(gecko.strict_min_version === undefined ? {} : { strict_min_version: gecko.strict_min_version }),
        };
  const dataCollection = gecko?.data_collection_permissions;
  verifyExtensionIdentity(manifest, geckoIdentity, requirements.firefoxStrictMinVersion);
  verifyExtensionEntryPoints(manifest);
  assertExactSet(manifest.permissions, requirements.manifestPermissions, "extension manifest permissions");
  assertExactSet(manifest.host_permissions ?? [], requirements.hostPermissions, "extension host permissions");
  assertExactSet(dataCollection?.required ?? [], requirements.dataCollection.required, "extension required data collection permissions");
  assertExactSet(dataCollection?.optional ?? [], requirements.dataCollection.optional, "extension optional data collection permissions");
}

function verifyExtensionIdentity(
  manifest: ExtensionManifest,
  gecko: { readonly id: string; readonly strict_min_version?: string } | undefined,
  firefoxStrictMinVersion: string,
): void {
  verifyExpectedExtensionDisplayMetadata(manifest, "extension manifest");
  if (manifest.version !== rootPackage.version) {
    throw new Error(`Expected extension version ${rootPackage.version}, received ${manifest.version}`);
  }
  if (gecko?.id !== FIREFOX_CLI_EXTENSION_ID) {
    throw new Error(`Expected extension ID ${FIREFOX_CLI_EXTENSION_ID}, received ${gecko?.id ?? "<missing>"}`);
  }
  if (gecko.strict_min_version !== firefoxStrictMinVersion) {
    throw new Error(`Expected extension Firefox minimum version ${firefoxStrictMinVersion}, received ${gecko.strict_min_version ?? "<missing>"}`);
  }
}

function verifyExtensionEntryPoints(manifest: ExtensionManifest): void {
  if (manifest.background.scripts.join(",") !== "background.js") {
    throw new Error("Expected extension background script to be background.js");
  }
  if (manifest.action.default_popup !== "popup.html") {
    throw new Error("Expected extension popup to be popup.html");
  }
}

function assertExactSet(actual: readonly string[], expected: readonly string[], label: string): void {
  const actualSorted = [...actual].sort((left, right) => left.localeCompare(right));
  const expectedSorted = [...expected].sort((left, right) => left.localeCompare(right));
  if (actualSorted.length !== expectedSorted.length || actualSorted.some((value, index) => value !== expectedSorted[index])) {
    throw new Error(`Expected ${label} ${expectedSorted.join(", ")}, received ${actualSorted.length === 0 ? "<none>" : actualSorted.join(", ")}`);
  }
}
