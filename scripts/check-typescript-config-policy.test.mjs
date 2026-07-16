import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

test("base TypeScript config keeps strict policy switches enabled", async () => {
  const config = JSON.parse(await readFile(new URL("../tsconfig.base.json", import.meta.url), "utf8"));
  const compilerOptions = config.compilerOptions;
  assert.equal(compilerOptions.allowJs, false);
  assert.equal(compilerOptions.strict, true);
  assert.equal(compilerOptions.exactOptionalPropertyTypes, true);
  assert.equal(compilerOptions.noFallthroughCasesInSwitch, true);
  assert.equal(compilerOptions.noImplicitOverride, true);
  assert.equal(compilerOptions.noUncheckedIndexedAccess, true);
  assert.equal(compilerOptions.skipLibCheck, false);
  assert.equal(compilerOptions.isolatedModules, true);
  assert.equal(compilerOptions.module, "NodeNext");
  assert.equal(compilerOptions.moduleResolution, "NodeNext");
});

test("root TypeScript config remains a project-reference entrypoint", async () => {
  const config = JSON.parse(await readFile(new URL("../tsconfig.json", import.meta.url), "utf8"));
  assert.deepEqual(config.files, []);
  assert.deepEqual(config.references.map((reference) => reference.path).sort(), [
    "./packages/cli",
    "./packages/extension",
    "./packages/native-host",
    "./packages/protocol",
    "./packages/test-support",
    "./scripts",
  ]);
});

test("TypeScript 7 compiler and TypeScript 6 tooling API remain isolated", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.devDependencies["@typescript/native"], /^npm:typescript@\^7\./);
  assert.match(packageJson.devDependencies.typescript, /^\^6\./);
  assert.equal(packageJson.scripts.tsc, "node ./node_modules/@typescript/native/bin/tsc");

  for (const packageName of ["cli", "extension", "native-host", "protocol", "test-support"]) {
    const packageManifest = JSON.parse(await readFile(new URL(`../packages/${packageName}/package.json`, import.meta.url), "utf8"));
    assert.match(packageManifest.scripts.typecheck, /^bun run --cwd \.\.\/\.\. tsc -- /);
  }
});
