import rootPackage from "../package.json" with { type: "json" };
import { FIREFOX_CLI_EXTENSION_ID } from "@firefox-cli/native-host";
import {
  getExtensionPermissionRequirements,
  type FirefoxDataCollectionPermission,
  type FirefoxManifestPermission,
} from "@firefox-cli/protocol";
import type { ExtensionManifest } from "./manifest-validation.js";

export function verifyExpectedExtensionManifest(manifest: ExtensionManifest): void {
  const requirements = getExtensionPermissionRequirements();
  if (manifest.name !== "firefox-cli") {
    throw new Error(`Expected extension name firefox-cli, received ${manifest.name}`);
  }
  if (manifest.version !== rootPackage.version) {
    throw new Error(
      `Expected extension version ${rootPackage.version}, received ${manifest.version ?? "<missing>"}`,
    );
  }
  if (manifest.browser_specific_settings?.gecko.id !== FIREFOX_CLI_EXTENSION_ID) {
    throw new Error(
      `Expected extension ID ${FIREFOX_CLI_EXTENSION_ID}, received ${
        manifest.browser_specific_settings?.gecko.id ?? "<missing>"
      }`,
    );
  }
  if (manifest.browser_specific_settings?.gecko.strict_min_version !== requirements.firefoxStrictMinVersion) {
    throw new Error(
      `Expected extension Firefox minimum version ${requirements.firefoxStrictMinVersion}, received ${
        manifest.browser_specific_settings?.gecko.strict_min_version ?? "<missing>"
      }`,
    );
  }
  if (manifest.background?.scripts?.join(",") !== "background.js") {
    throw new Error("Expected extension background script to be background.js");
  }
  if (manifest.action?.default_popup !== "popup.html") {
    throw new Error("Expected extension popup to be popup.html");
  }

  assertExactSet(manifest.permissions, requirements.manifestPermissions, "extension manifest permissions");
  assertExactSet(manifest.host_permissions ?? [], requirements.hostPermissions, "extension host permissions");
  assertExactSet(
    manifest.browser_specific_settings?.gecko.data_collection_permissions?.required ?? [],
    requirements.dataCollection.required,
    "extension required data collection permissions",
  );
  assertExactSet(
    manifest.browser_specific_settings?.gecko.data_collection_permissions?.optional ?? [],
    requirements.dataCollection.optional,
    "extension optional data collection permissions",
  );
}

function assertExactSet<T extends FirefoxManifestPermission | FirefoxDataCollectionPermission | string>(
  actual: readonly T[],
  expected: readonly T[],
  label: string,
): void {
  const actualSorted = [...actual].sort((left, right) => left.localeCompare(right));
  const expectedSorted = [...expected].sort((left, right) => left.localeCompare(right));
  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    throw new Error(
      `Expected ${label} ${expectedSorted.join(", ")}, received ${
        actualSorted.length === 0 ? "<none>" : actualSorted.join(", ")
      }`,
    );
  }
}
