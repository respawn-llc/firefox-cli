import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { prepareReleaseVersion, selectReleaseVersion } from "../prepare-release-version.js";

describe("prepareReleaseVersion", () => {
  it("selects the requested version when its release tag is available", () => {
    expect(selectReleaseVersion("0.1.0", ["v0.0.9"])).toBe("0.1.0");
  });

  it("increments patch version until the release tag is available", () => {
    expect(selectReleaseVersion("0.1.0", ["v0.1.0", "v0.1.1"])).toBe("0.1.2");
  });

  it("updates root and synced version files when the target release tag already exists", async () => {
    const root = await createReleaseFixture("0.1.0");

    const result = await prepareReleaseVersion({
      root,
      unavailableTags: ["v0.1.0"],
    });

    expect(result).toEqual({
      previousVersion: "0.1.0",
      version: "0.1.1",
      tag: "v0.1.1",
      changedFiles: [
        "package.json",
        "packages/cli/package.json",
        "packages/extension/package.json",
        "packages/native-host/package.json",
        "packages/protocol/package.json",
        "packages/test-support/package.json",
        "packages/extension/src/manifest.json",
        ".claude-plugin/plugin.json",
        "bun.lock",
      ],
    });
    await expect(readJsonVersion(join(root, "package.json"))).resolves.toBe("0.1.1");
    await expect(readJsonVersion(join(root, "packages/cli/package.json"))).resolves.toBe("0.1.1");
    await expect(readJsonVersion(join(root, "packages/extension/src/manifest.json"))).resolves.toBe("0.1.1");
    await expect(readJsonVersion(join(root, ".claude-plugin/plugin.json"))).resolves.toBe("0.1.1");
    await expect(readFile(join(root, "bun.lock"), "utf8")).resolves.toContain('"version": "0.1.1"');
  });

  it("accepts an explicit manual target version", async () => {
    const root = await createReleaseFixture("0.1.0");

    const result = await prepareReleaseVersion({
      root,
      targetVersion: "0.2.0",
      unavailableTags: [],
    });

    expect(result.version).toBe("0.2.0");
    expect(result.tag).toBe("v0.2.0");
    await expect(readJsonVersion(join(root, "package.json"))).resolves.toBe("0.2.0");
  });
});

async function createReleaseFixture(version: string): Promise<string> {
  const root = await createTempDir("firefox-cli-release-version");
  await writeVersionJson(join(root, "package.json"), "firefox-cli-workspace", version);
  for (const path of [
    "packages/cli/package.json",
    "packages/extension/package.json",
    "packages/native-host/package.json",
    "packages/protocol/package.json",
    "packages/test-support/package.json",
  ]) {
    await writeVersionJson(join(root, path), path, version);
  }
  await writeVersionJson(join(root, "packages/extension/src/manifest.json"), "firefox-cli", version);
  await writeVersionJson(join(root, ".claude-plugin/plugin.json"), "firefox-cli", version);
  await writeFile(
    join(root, "bun.lock"),
    [
      '    "packages/cli": {',
      `      "version": "${version}",`,
      "    },",
      '    "packages/extension": {',
      `      "version": "${version}",`,
      "    },",
      '    "packages/native-host": {',
      `      "version": "${version}",`,
      "    },",
      '    "packages/protocol": {',
      `      "version": "${version}",`,
      "    },",
      '    "packages/test-support": {',
      `      "version": "${version}",`,
      "    },",
    ].join("\n"),
  );
  return root;
}

async function writeVersionJson(path: string, name: string, version: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        name,
        version,
      },
      null,
      2,
    )}\n`,
  );
}

async function readJsonVersion(path: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  return parsed !== null && typeof parsed === "object" && "version" in parsed ? parsed.version : undefined;
}
