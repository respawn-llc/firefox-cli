import { FIREFOX_CLI_EXTENSION_UPDATE_URL } from "@firefox-cli/protocol";
import type { ExtensionManifest } from "./manifest-validation.js";

export const extensionDisplayMetadata = {
  name: "FF-CLI Bridge",
  description: "Browser extension bridge for CLI control.",
  actionTitle: "FF-CLI Bridge",
  updateUrl: FIREFOX_CLI_EXTENSION_UPDATE_URL,
} as const;

const amoTrademarkPattern = /\b(?:firefox|mozilla)\b/iu;

export function verifyExpectedExtensionDisplayMetadata(manifest: ExtensionManifest, label: string): void {
  if (manifest.name !== extensionDisplayMetadata.name) {
    throw new Error(`Expected ${label} name ${extensionDisplayMetadata.name}, received ${manifest.name}`);
  }
  if (manifest.description !== extensionDisplayMetadata.description) {
    throw new Error(`Expected ${label} description ${extensionDisplayMetadata.description}, received ${formatOptionalText(manifest.description)}`);
  }
  if (manifest.action.default_title !== extensionDisplayMetadata.actionTitle) {
    throw new Error(`Expected ${label} action title ${extensionDisplayMetadata.actionTitle}, received ${manifest.action.default_title ?? "<missing>"}`);
  }
  if (manifest.browser_specific_settings?.gecko.update_url !== extensionDisplayMetadata.updateUrl) {
    throw new Error(
      `Expected ${label} update URL ${extensionDisplayMetadata.updateUrl}, received ${formatOptionalText(manifest.browser_specific_settings?.gecko.update_url)}`,
    );
  }
  assertAmoSafeDisplayText(manifest.name, `${label} name`);
  assertAmoSafeDisplayText(manifest.action.default_title, `${label} action title`);
}

function formatOptionalText(value: string | undefined): string {
  return value ?? "<missing>";
}

function assertAmoSafeDisplayText(value: string | undefined, label: string): void {
  if (value !== undefined && amoTrademarkPattern.test(value)) {
    throw new Error(`${label} must not contain Mozilla or Firefox trademarks for AMO signing.`);
  }
}
