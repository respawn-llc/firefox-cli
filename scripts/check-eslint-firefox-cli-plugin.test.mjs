import { RuleTester } from "eslint";
import { test } from "node:test";
import tseslint from "typescript-eslint";
import { firefoxCliArchitecture } from "./eslint-firefox-cli-plugin.js";

RuleTester.afterAll = () => undefined;
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (name, fn) => test(name, fn);

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    parser: tseslint.parser,
    parserOptions: { sourceType: "module" },
    sourceType: "module",
  },
});

test("firefox-cli/no-mutable-exports rejects exported mutable bindings", () => {
  ruleTester.run("no-mutable-exports", firefoxCliArchitecture.rules["no-mutable-exports"], {
    valid: ["export const value = 1;", "let state = 1; export const read = () => state;", "const value = 1; function f() { let value = 2; } export { value };"],
    invalid: [
      { code: "export let value = 1;", errors: [{ messageId: "mutableExport" }] },
      { code: "let value = 1; export { value };", errors: [{ messageId: "mutableExport" }] },
      { code: "let { state } = source; export { state };", errors: [{ messageId: "mutableExport" }] },
    ],
  });
});

test("firefox-cli/no-firefox-platform-outside-extension keeps browser APIs extension-local", () => {
  ruleTester.run("no-firefox-platform-outside-extension", firefoxCliArchitecture.rules["no-firefox-platform-outside-extension"], {
    valid: [
      { code: "browser.tabs.query({});", filename: "/repo/packages/extension/src/background.ts" },
      {
        code: "const browser = createAdapter(); browser.tabs();",
        filename: "/repo/packages/cli/src/index.ts",
      },
    ],
    invalid: [
      {
        code: "browser.tabs.query({});",
        filename: "/repo/packages/cli/src/index.ts",
        errors: [{ messageId: "platformOutsideExtension" }],
      },
      {
        code: "chrome.tabs.query({});",
        filename: "/repo/packages/native-host/src/index.ts",
        errors: [{ messageId: "platformOutsideExtension" }],
      },
    ],
  });
});

test("firefox-cli/no-node-builtins-in-extension-runtime rejects Node imports in extension runtime", () => {
  ruleTester.run("no-node-builtins-in-extension-runtime", firefoxCliArchitecture.rules["no-node-builtins-in-extension-runtime"], {
    valid: [
      {
        code: 'import { readFile } from "node:fs/promises";',
        filename: "/repo/packages/native-host/src/index.ts",
      },
      {
        code: 'import { readFile } from "node:fs/promises";',
        filename: "/repo/packages/extension/src/background.test.ts",
      },
    ],
    invalid: [
      {
        code: 'import { readFile } from "node:fs/promises";',
        filename: "/repo/packages/extension/src/background.ts",
        errors: [{ messageId: "nodeBuiltinInExtension" }],
      },
      {
        code: 'await import("node:fs/promises");',
        filename: "/repo/packages/extension/src/background.ts",
        errors: [{ messageId: "nodeBuiltinInExtension" }],
      },
      {
        code: 'const fs = require("fs");',
        filename: "/repo/packages/extension/src/background.ts",
        errors: [{ messageId: "nodeBuiltinInExtension" }],
      },
      {
        code: 'import { Database } from "bun:sqlite";',
        filename: "/repo/packages/extension/src/background.ts",
        errors: [{ messageId: "nodeBuiltinInExtension" }],
      },
    ],
  });
});

test("firefox-cli/no-package-boundary-violations rejects forbidden package imports", () => {
  ruleTester.run("no-package-boundary-violations", firefoxCliArchitecture.rules["no-package-boundary-violations"], {
    valid: [
      { code: 'import { x } from "@firefox-cli/protocol";', filename: "/repo/packages/cli/src/index.ts" },
      { code: 'import { x } from "./local.js";', filename: "/repo/packages/protocol/src/index.ts" },
    ],
    invalid: [
      {
        code: 'import { x } from "@firefox-cli/extension";',
        filename: "/repo/packages/cli/src/index.ts",
        errors: [{ messageId: "packageBoundary" }],
      },
      {
        code: 'import { x } from "@firefox-cli/protocol/src/private.js";',
        filename: "/repo/packages/cli/src/index.ts",
        errors: [{ messageId: "packageBoundary" }],
      },
      {
        code: 'import { x } from "../../extension/src/background.js";',
        filename: "/repo/packages/native-host/src/index.ts",
        errors: [{ messageId: "packageBoundary" }],
      },
      {
        code: 'import { x } from "@firefox-cli/cli";',
        filename: "/repo/packages/protocol/src/index.ts",
        errors: [{ messageId: "packageBoundary" }],
      },
    ],
  });
});
