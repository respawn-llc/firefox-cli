import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

test("extension manifest keeps the stable Firefox CLI boundary contract", async () => {
  const manifest = JSON.parse(await readFile(new URL("../packages/extension/src/manifest.json", import.meta.url), "utf8"));
  const constants = await readFile(new URL("../packages/protocol/src/constants.ts", import.meta.url), "utf8");
  const extensionId = /FIREFOX_CLI_EXTENSION_ID = "([^"]+)"/.exec(constants)?.[1];
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.browser_specific_settings?.gecko?.id, extensionId);
  assert.deepEqual(manifest.background?.scripts, ["background.js"]);
  assert.equal(manifest.action?.default_popup, "popup.html");
  for (const permission of ["nativeMessaging", "scripting", "tabs", "storage"]) {
    assert.ok(manifest.permissions.includes(permission), `missing permission ${permission}`);
  }
  assert.ok(manifest.host_permissions.includes("<all_urls>"));
});

test("native messaging manifest defaults stay aligned with the stable extension ID", async () => {
  const constants = await readFile(new URL("../packages/protocol/src/constants.ts", import.meta.url), "utf8");
  const nativeManifest = await readFile(new URL("../packages/native-host/src/native-manifest.ts", import.meta.url), "utf8");
  const extensionId = /FIREFOX_CLI_EXTENSION_ID = "([^"]+)"/.exec(constants)?.[1];
  const nativeHostName = /NATIVE_HOST_NAME = "([^"]+)"/.exec(constants)?.[1];
  assert.equal(extensionId, "firefox-cli@example.invalid");
  assert.equal(nativeHostName, "firefox_cli");
  assert.match(nativeManifest, /name: options\.name \?\? NATIVE_HOST_NAME/);
  assert.match(nativeManifest, /type: "stdio"/);
  assert.match(nativeManifest, /allowed_extensions: options\.allowedExtensions \?\? \[FIREFOX_CLI_EXTENSION_ID\]/);
});
