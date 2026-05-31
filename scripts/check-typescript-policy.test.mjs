import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTypeScriptPolicy } from "./check-typescript-policy.mjs";

test("TypeScript policy rejects explicit any annotations", async () => {
  const root = await createTypeScriptFixture("const value: any = 1;");
  assert.match((await checkTypeScriptPolicy(root)).join("\n"), /fixture\.ts uses explicit any/);
});

test("TypeScript policy rejects any assertions", async () => {
  const root = await createTypeScriptFixture("const value = input as any;");
  assert.match((await checkTypeScriptPolicy(root)).join("\n"), /fixture\.ts uses explicit any/);
});

test("TypeScript policy ignores comments and strings", async () => {
  const root = await createTypeScriptFixture('const text = "any"; // any');
  assert.deepEqual(await checkTypeScriptPolicy(root), []);
});

test("TypeScript policy rejects any inside template interpolations", async () => {
  const root = await createTypeScriptFixture("const text = `$" + "{value as any}`;");
  assert.match((await checkTypeScriptPolicy(root)).join("\n"), /fixture\.ts uses explicit any/);
});

async function createTypeScriptFixture(source) {
  const root = join(tmpdir(), `firefox-cli-ts-policy-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "fixture.ts"), source);
  return root;
}
