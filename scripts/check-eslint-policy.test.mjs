import { ESLint } from "eslint";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });

test("ESLint policy keeps type-aware safety rules enabled for TypeScript files", async () => {
  const rules = await rulesFor("packages/cli/src/index.ts");

  assert.deepEqual(rules["@typescript-eslint/no-explicit-any"], [2]);
  assert.deepEqual(rules["@typescript-eslint/no-floating-promises"], [2]);
  assert.deepEqual(rules["@typescript-eslint/no-unsafe-assignment"], [2]);
  assert.deepEqual(rules["@typescript-eslint/no-unsafe-call"], [2]);
  assert.deepEqual(rules["@typescript-eslint/no-unsafe-member-access"], [2]);
  assert.deepEqual(rules["@typescript-eslint/promise-function-async"], [2]);
  assert.deepEqual(rules["@typescript-eslint/consistent-type-assertions"], [2, { assertionStyle: "never" }]);
  assert.deepEqual(rules["@typescript-eslint/return-await"], [2, "in-try-catch"]);
});

test("ESLint policy keeps maintainability limits enabled for TypeScript files", async () => {
  const rules = await rulesFor("packages/cli/src/index.ts");

  assert.deepEqual(rules.complexity, [2, { max: 12 }]);
  assert.deepEqual(rules["max-depth"], [2, 4]);
  assert.deepEqual(rules["max-lines"], [2, { max: 350, skipBlankLines: true, skipComments: true }]);
  assert.deepEqual(rules["max-params"], [2, 4]);
  assert.deepEqual(rules["no-console"], [2, {}]);
});

test("ESLint policy allows terminal output in automation scripts", async () => {
  const scriptRules = await rulesFor("scripts/release-check.ts");

  assert.deepEqual(scriptRules["no-console"], [0, {}]);
});

test("ESLint policy keeps firefox-cli architecture rules enabled for TypeScript files", async () => {
  const rules = await rulesFor("packages/cli/src/index.ts");

  assert.deepEqual(rules["firefox-cli/no-mutable-exports"], [2]);
  assert.deepEqual(rules["firefox-cli/no-firefox-platform-outside-extension"], [2]);
  assert.deepEqual(rules["firefox-cli/no-node-builtins-in-extension-runtime"], [2]);
  assert.deepEqual(rules["firefox-cli/no-package-boundary-violations"], [2]);
});

test("ESLint policy provides Node/Bun globals for JavaScript automation files", async () => {
  const config = await eslint.calculateConfigForFile("scripts/check-dependency-policy.mjs");

  assert.equal(config.languageOptions.globals.process, "readonly");
  assert.equal(config.languageOptions.globals.URL, "readonly");
  assert.equal(config.languageOptions.globals.Bun, "readonly");
  assert.deepEqual(config.rules["no-undef"], [2, { typeof: false }]);
});

async function rulesFor(file) {
  return (await eslint.calculateConfigForFile(file)).rules;
}
