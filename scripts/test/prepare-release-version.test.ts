import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { extensionDisplayMetadata } from "../extension-display-metadata.js";
import { extensionReleaseXpiUrl, extensionUpdateManifestPath } from "../extension-update-manifest.js";
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
        "docs/firefox-cli/updates.json",
      ],
    });
    await expect(readJsonVersion(join(root, "package.json"))).resolves.toBe("0.1.1");
    await expect(readJsonVersion(join(root, "packages/cli/package.json"))).resolves.toBe("0.1.1");
    await expect(readJsonVersion(join(root, "packages/extension/src/manifest.json"))).resolves.toBe("0.1.1");
    await expect(readJsonVersion(join(root, ".claude-plugin/plugin.json"))).resolves.toBe("0.1.1");
    await expect(readFile(join(root, "bun.lock"), "utf8")).resolves.toContain('"version": "0.1.1"');
    await expect(readExtensionUpdateLink(join(root, extensionUpdateManifestPath), "0.1.1")).resolves.toBe(extensionReleaseXpiUrl("0.1.1"));
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
    await expect(readExtensionUpdateLink(join(root, extensionUpdateManifestPath), "0.2.0")).resolves.toBe(extensionReleaseXpiUrl("0.2.0"));
  });

  it("preserves unknown update manifest metadata during release version prep", async () => {
    const root = await createReleaseFixture("0.1.0");
    const manifestPath = join(root, extensionUpdateManifestPath);
    const manifest = await readJsonObject(manifestPath);
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          ...manifest,
          schema_version: 1,
          addons: {
            "ff-cli-bridge@respawn.pro": {
              custom_addon_field: true,
              updates: [
                {
                  version: "0.1.0",
                  update_link: extensionReleaseXpiUrl("0.1.0"),
                  update_hash: "sha256:old",
                },
              ],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    await prepareReleaseVersion({
      root,
      targetVersion: "0.1.0",
      unavailableTags: [],
    });

    const updated = await readJsonObject(manifestPath);
    expect(updated).toMatchObject({
      schema_version: 1,
      addons: {
        "ff-cli-bridge@respawn.pro": {
          custom_addon_field: true,
          updates: [
            {
              version: "0.1.0",
              update_link: extensionReleaseXpiUrl("0.1.0"),
              update_hash: "sha256:old",
            },
          ],
        },
      },
    });
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
  await writeVersionJson(join(root, "packages/extension/src/manifest.json"), extensionDisplayMetadata.name, version);
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
  const updateManifestFixturePath = join(root, extensionUpdateManifestPath);
  await mkdir(dirname(updateManifestFixturePath), { recursive: true });
  await writeFile(
    updateManifestFixturePath,
    `${JSON.stringify(
      {
        addons: {
          "ff-cli-bridge@respawn.pro": {
            updates: [
              {
                version,
                update_link: extensionReleaseXpiUrl(version),
                applications: {
                  gecko: {
                    strict_min_version: "150.0",
                  },
                },
              },
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
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
  const parsed = await readJsonObject(path);
  return "version" in parsed ? parsed.version : undefined;
}

async function readJsonObject(path: string): Promise<Readonly<Record<string, unknown>>> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsed;
}

async function readExtensionUpdateLink(path: string, version: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.addons)) {
    return undefined;
  }
  const addon = parsed.addons["ff-cli-bridge@respawn.pro"];
  if (!isRecord(addon)) {
    return undefined;
  }
  if (!isUnknownArray(addon.updates)) {
    return undefined;
  }
  const match = addon.updates.find((update) => isRecord(update) && update.version === version);
  return isRecord(match) ? match.update_link : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
