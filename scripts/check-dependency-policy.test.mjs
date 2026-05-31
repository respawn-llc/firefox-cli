import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDependencyPolicy } from "./check-dependency-policy.mjs";

test("dependency policy accepts reviewed Bun direct dependencies", async () => {
  const root = await createWorkspace({
    policyDependencies: ["left-pad"],
    packageDependencies: { "left-pad": "1.3.0" },
  });
  assert.deepEqual(await checkDependencyPolicy(root), []);
});

test("dependency policy rejects unreviewed direct dependencies", async () => {
  const root = await createWorkspace({
    policyDependencies: [],
    packageDependencies: { "left-pad": "1.3.0" },
  });
  assert.match((await checkDependencyPolicy(root)).join("\n"), /unreviewed dependency left-pad/);
});

test("dependency policy rejects absent allowlisted dependencies", async () => {
  const root = await createWorkspace({ policyDependencies: ["left-pad"], packageDependencies: {} });
  assert.match((await checkDependencyPolicy(root)).join("\n"), /allowlists absent dependencies dependency left-pad/);
});

test("dependency policy enforces Bun package manager ownership", async () => {
  const root = await createWorkspace({
    policyDependencies: [],
    packageDependencies: {},
    packageManager: "pnpm@10.0.0",
  });
  assert.match((await checkDependencyPolicy(root)).join("\n"), /packageManager as bun@<version>/);
});

test("dependency policy rejects workspace package versions that drift from root", async () => {
  const root = await createWorkspace({
    policyDependencies: [],
    packageDependencies: {},
    workspacePackages: [{ name: "fixture-child", version: "9.9.9" }],
  });
  assert.match((await checkDependencyPolicy(root)).join("\n"), /packages\/fixture-child\/package\.json version must match root package\.json version 0\.1\.0/);
});

async function createWorkspace(options) {
  const root = join(tmpdir(), `firefox-cli-deps-policy-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "bun.lock"), "");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "0.1.0",
      packageManager: options.packageManager ?? "bun@1.3.14",
      dependencies: options.packageDependencies,
    }),
  );
  await writeFile(
    join(root, "dependency-policy.json"),
    JSON.stringify({
      packageManager: "bun",
      trustedDependenciesAllowlist: [],
      directDependencyAllowlist: { fixture: { dependencies: options.policyDependencies } },
    }),
  );
  for (const workspacePackage of options.workspacePackages ?? []) {
    await mkdir(join(root, "packages", workspacePackage.name), { recursive: true });
    await writeFile(
      join(root, "packages", workspacePackage.name, "package.json"),
      JSON.stringify({
        name: workspacePackage.name,
        version: workspacePackage.version,
      }),
    );
  }
  return root;
}
