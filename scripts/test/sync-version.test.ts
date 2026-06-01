import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { syncVersion, updateBunLockWorkspaceVersions } from "../sync-version.js";

describe("syncVersion", () => {
  it("syncs workspace package, extension manifest, and lockfile versions from root package.json", async () => {
    const root = await createVersionFixture("0.1.0", "0.0.0");

    await expect(syncVersion({ root })).resolves.toEqual([
      "packages/cli/package.json",
      "packages/extension/package.json",
      "packages/native-host/package.json",
      "packages/protocol/package.json",
      "packages/test-support/package.json",
      "packages/extension/src/manifest.json",
      ".claude-plugin/plugin.json",
      "bun.lock",
    ]);

    await expect(readJsonVersion(join(root, "packages/cli/package.json"))).resolves.toBe("0.1.0");
    await expect(readJsonVersion(join(root, "packages/extension/src/manifest.json"))).resolves.toBe("0.1.0");
    await expect(readJsonVersion(join(root, ".claude-plugin/plugin.json"))).resolves.toBe("0.1.0");
    await expect(readFile(join(root, "bun.lock"), "utf8")).resolves.toContain('"version": "0.1.0"');
  });

  it("fails check mode without mutating stale version files", async () => {
    const root = await createVersionFixture("0.1.0", "0.0.0");

    await expect(syncVersion({ root, check: true })).resolves.toContain("packages/cli/package.json");
    await expect(readJsonVersion(join(root, "packages/cli/package.json"))).resolves.toBe("0.0.0");
  });

  it("updates only configured bun.lock workspace versions", () => {
    const result = updateBunLockWorkspaceVersions(
      [
        '    "packages/cli": {',
        '      "name": "@firefox-cli/cli",',
        '      "version": "0.0.0",',
        "    },",
        '    "third-party": {',
        '      "version": "9.9.9",',
        "    },",
        '    "packages/extension": {',
        '      "version": "0.0.0",',
        "    },",
        '    "packages/native-host": {',
        '      "version": "0.0.0",',
        "    },",
        '    "packages/protocol": {',
        '      "version": "0.0.0",',
        "    },",
        '    "packages/test-support": {',
        '      "version": "0.0.0",',
        "    },",
      ].join("\n"),
      "0.1.0",
    );

    expect(result.missingWorkspaces).toEqual([]);
    expect(result.output).toContain('"packages/cli": {\n      "name": "@firefox-cli/cli",\n      "version": "0.1.0"');
    expect(result.output).toContain('"third-party": {\n      "version": "9.9.9"');
  });
});

async function createVersionFixture(rootVersion: string, staleVersion: string): Promise<string> {
  const root = await createTempDir("firefox-cli-version-sync");
  await writeJson(join(root, "package.json"), {
    name: "firefox-cli-workspace",
    version: rootVersion,
  });

  for (const path of [
    "packages/cli/package.json",
    "packages/extension/package.json",
    "packages/native-host/package.json",
    "packages/protocol/package.json",
    "packages/test-support/package.json",
  ]) {
    await writeJson(join(root, path), { name: path, version: staleVersion });
  }
  await writeJson(join(root, "packages/extension/src/manifest.json"), {
    manifest_version: 3,
    name: "FF-CLI Bridge",
    version: staleVersion,
  });
  await writeJson(join(root, ".claude-plugin/plugin.json"), {
    name: "firefox-cli",
    version: staleVersion,
  });
  await writeFile(
    join(root, "bun.lock"),
    [
      '    "packages/cli": {',
      '      "version": "0.0.0",',
      "    },",
      '    "packages/extension": {',
      '      "version": "0.0.0",',
      "    },",
      '    "packages/native-host": {',
      '      "version": "0.0.0",',
      "    },",
      '    "packages/protocol": {',
      '      "version": "0.0.0",',
      "    },",
      '    "packages/test-support": {',
      '      "version": "0.0.0",',
      "    },",
    ].join("\n"),
  );
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonVersion(path: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  return parsed !== null && typeof parsed === "object" && "version" in parsed ? parsed.version : undefined;
}
