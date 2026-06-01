import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import { firefoxCliArchitecture } from "./scripts/eslint-firefox-cli-plugin.js";
const typeScriptFiles = ["**/*.{ts,tsx,mts,cts}"];
const automationScriptFiles = ["scripts/**/*.{ts,mts,cts,js,mjs,cjs}"];
const nodeRuntimeGlobals = Object.fromEntries(
  [
    "AbortController",
    "AbortSignal",
    "Buffer",
    "Bun",
    "TextDecoder",
    "TextEncoder",
    "URL",
    "URLSearchParams",
    "clearImmediate",
    "clearInterval",
    "clearTimeout",
    "console",
    "exports",
    "global",
    "module",
    "process",
    "require",
    "setImmediate",
    "setInterval",
    "setTimeout",
  ].map((name) => [name, "readonly"]),
);
const typeCheckedConfigs = [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked].map((config) => ({
  ...config,
  files: typeScriptFiles,
}));
export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/gen/**", "**/target/**", ".builder/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: nodeRuntimeGlobals },
  },
  ...typeCheckedConfigs,
  {
    files: typeScriptFiles,
    languageOptions: {
      parserOptions: {
        project: [
          "./packages/cli/tsconfig.json",
          "./packages/extension/tsconfig.json",
          "./packages/native-host/tsconfig.json",
          "./packages/protocol/tsconfig.json",
          "./packages/test-support/tsconfig.json",
          "./scripts/tsconfig.json",
          "./tsconfig.eslint.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "firefox-cli": firefoxCliArchitecture },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/promise-function-async": "error",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/return-await": ["error", "in-try-catch"],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      complexity: ["error", { max: 12 }],
      "firefox-cli/no-firefox-platform-outside-extension": "error",
      "firefox-cli/no-mutable-exports": "error",
      "firefox-cli/no-node-builtins-in-extension-runtime": "error",
      "firefox-cli/no-package-boundary-violations": "error",
      "max-depth": ["error", 4],
      "max-lines": ["error", { max: 350, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 4],
      "no-console": "error",
      "no-undef": "off",
    },
  },
  {
    files: automationScriptFiles,
    rules: {
      "no-console": "off",
    },
  },
  prettier,
];
