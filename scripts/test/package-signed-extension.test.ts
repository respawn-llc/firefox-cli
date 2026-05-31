import { createHash } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import rootPackage from "../../package.json" with { type: "json" };
import { createTempDir } from "@firefox-cli/test-support";
import {
  packagedSignedExtensionProvenanceJson,
  readValidatedSignedExtensionSource,
} from "../package-signed-extension.js";
import type { SignedExtensionSignatureVerifier } from "../signed-extension-signature.js";
import { createZipFixture } from "./zip-test-utils.js";

const bypassSignatureVerifier: SignedExtensionSignatureVerifier = async () => undefined;

describe("readValidatedSignedExtensionSource", () => {
  it("accepts canonical XPI and matching source provenance", async () => {
    const root = await createTempDir("firefox-cli-signed-source");
    const xpiPath = join(root, `firefox-cli-${rootPackage.version}.xpi`);
    const provenancePath = `${xpiPath}.provenance.json`;
    const xpiData = createZipFixture([
      { name: "META-INF/mozilla.sf", data: "sf" },
      { name: "META-INF/mozilla.rsa", data: Buffer.from([0x30]) },
    ]).data;
    await writeFile(xpiPath, xpiData);
    await writeSourceProvenance(provenancePath, {
      sourceDir: join(root, "source"),
      xpiFile: `firefox-cli-${rootPackage.version}.xpi`,
      xpiSha256: sha256(xpiData),
    });

    const source = await readValidatedSignedExtensionSource({
      provenancePath,
      signatureVerifier: bypassSignatureVerifier,
      sourceXpiPath: xpiPath,
    });

    expect(source.xpiData.equals(xpiData)).toBe(true);
    expect(JSON.parse(packagedSignedExtensionProvenanceJson(source.provenance))).toMatchObject({
      xpiFile: "firefox-cli.xpi",
    });
  });

  it("rejects override sources that are not .xpi files", async () => {
    const root = await createTempDir("firefox-cli-signed-source");
    const xpiPath = join(root, "firefox-cli.zip");
    await writeFile(xpiPath, "zip bytes\n");

    await expect(
      readValidatedSignedExtensionSource({
        provenancePath: `${xpiPath}.provenance.json`,
        sourceXpiPath: xpiPath,
      }),
    ).rejects.toThrow(".xpi extension");
  });

  it("rejects symlinked signed XPI overrides before reading", async () => {
    const root = await createTempDir("firefox-cli-signed-source");
    const outside = await createTempDir("firefox-cli-signed-source-outside");
    const outsideXpi = join(outside, `firefox-cli-${rootPackage.version}.xpi`);
    const xpiPath = join(root, `firefox-cli-${rootPackage.version}.xpi`);
    await writeFile(outsideXpi, "outside xpi\n");
    await symlink(outsideXpi, xpiPath);

    await expect(
      readValidatedSignedExtensionSource({
        provenancePath: `${xpiPath}.provenance.json`,
        sourceXpiPath: xpiPath,
      }),
    ).rejects.toThrow("Refusing to read symlink");
  });

  it("rejects source provenance that does not match the override XPI", async () => {
    const root = await createTempDir("firefox-cli-signed-source");
    const xpiPath = join(root, `firefox-cli-${rootPackage.version}.xpi`);
    const provenancePath = `${xpiPath}.provenance.json`;
    await writeFile(xpiPath, "signed xpi bytes\n");
    await writeSourceProvenance(provenancePath, {
      sourceDir: join(root, "source"),
      xpiFile: "different.xpi",
      xpiSha256: "0".repeat(64),
    });

    await expect(
      readValidatedSignedExtensionSource({
        provenancePath,
        sourceXpiPath: xpiPath,
      }),
    ).rejects.toThrow("provenance XPI file");
  });

  it("rejects source XPIs that cannot be signature-verified", async () => {
    const root = await createTempDir("firefox-cli-signed-source");
    const xpiPath = join(root, `firefox-cli-${rootPackage.version}.xpi`);
    const provenancePath = `${xpiPath}.provenance.json`;
    await writeFile(xpiPath, "not a zip\n");
    await writeSourceProvenance(provenancePath, {
      sourceDir: join(root, "source"),
      xpiFile: `firefox-cli-${rootPackage.version}.xpi`,
      xpiSha256: sha256("not a zip\n"),
    });

    await expect(
      readValidatedSignedExtensionSource({
        provenancePath,
        sourceXpiPath: xpiPath,
      }),
    ).rejects.toThrow("missing end of central directory");
  });
});

async function writeSourceProvenance(
  path: string,
  overrides: {
    readonly sourceDir: string;
    readonly xpiFile: string;
    readonly xpiSha256: string;
  },
): Promise<void> {
  await mkdir(overrides.sourceDir, { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        packageVersion: rootPackage.version,
        channel: "unlisted",
        sourceDir: overrides.sourceDir,
        sourceSha256: "1".repeat(64),
        xpiFile: overrides.xpiFile,
        xpiSha256: overrides.xpiSha256,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
