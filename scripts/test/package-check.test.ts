import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { beforeAll, describe, expect, it } from "vitest";
import rootPackage from "../../package.json" with { type: "json" };
import { hashDirectoryPayload } from "../extension-artifact-provenance.js";
import { extensionDisplayMetadata } from "../extension-display-metadata.js";
import { verifyPackageLayout } from "../package-check.js";
import {
  createPackageCheckOptions,
  createPackageRoot,
  initializePackageCheckSigningMaterial,
  packageCheckPlatform,
  testSignatureVerifier,
  writeMatchingXpi,
} from "./package-check-test-utils.js";

const platform = packageCheckPlatform;

beforeAll(async () => {
  await initializePackageCheckSigningMaterial();
});

describe("verifyPackageLayout", () => {
  it("accepts a complete development package layout", async () => {
    const packageRoot = await createPackageRoot();
    await verifyPackageLayout({ packageRoot, platform });
  });

  it("requires the real platform binary", async () => {
    const packageRoot = await createPackageRoot({ includeBinary: false });
    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow();
  });

  it("requires signed XPI for release checks", async () => {
    const packageRoot = await createPackageRoot();
    await expect(verifyPackageLayout({ packageRoot, platform, requireSignedXpi: true })).rejects.toThrow("Expected signed extension XPI");
  });

  it("accepts a matching signed XPI with deflated data, data descriptors, and EOCD comments", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot, {
      compressionMethod: 8,
      eocdComment: "release candidate",
      realSignature: true,
      signed: true,
      useDataDescriptor: true,
    });

    await verifyPackageLayout({
      packageRoot,
      platform,
      requireSignedXpi: true,
      signedExtensionSignatureVerifier: testSignatureVerifier,
    });
  });

  it("requires signed XPI provenance for release checks", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot, { writeProvenance: false });

    await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, true))).rejects.toThrow("Expected signed extension provenance");
  });

  it("rejects signed XPI provenance that does not match the packaged XPI", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot, {
      provenanceOverrides: { xpiSha256: "0".repeat(64) },
    });

    await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, true))).rejects.toThrow("provenance digest");
  });

  it("rejects signed XPI provenance with the wrong packaged XPI name", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot, {
      provenanceOverrides: { xpiFile: `firefox-cli-${rootPackage.version}.xpi` },
    });

    await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, true))).rejects.toThrow("provenance XPI file");
  });

  it("rejects signed XPI provenance with the wrong signing channel", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot, {
      provenanceOverrides: { channel: "listed" },
    });

    await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, true))).rejects.toThrow("provenance channel");
  });

  it("rejects renamed unsigned ZIPs for signed release checks", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot, { signed: false });

    await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, true))).rejects.toThrow("Expected signed extension XPI signature metadata");
  });

  it("rejects renamed unsigned ZIPs when present in default package checks", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot, { signed: false });

    await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, false))).rejects.toThrow("Expected signed extension XPI signature metadata");
  });

  it("runs real PKCS7 verification by default for present signed XPIs", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot);

    await expect(verifyPackageLayout({ packageRoot, platform, requireSignedXpi: true })).rejects.toThrow("PKCS7 verification failed");
  });

  it("rejects malformed present XPIs instead of falling back to the development extension", async () => {
    const packageRoot = await createPackageRoot();
    await writeFile(join(packageRoot, "extension/firefox-cli.xpi"), "not a zip");

    await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, false))).rejects.toThrow("missing end of central directory");
  });

  it("rejects invalid signed-XPI metadata for signed release checks", async () => {
    for (const signatureEntries of [
      { "META-INF/manifest.mf": "" },
      {
        "META-INF/manifest.mf": "manifest",
        "META-INF/mozilla.sf": "sf",
        "META-INF/mozilla.rsa": "rsa",
        "META-INF/unexpected.txt": "unexpected",
      },
      {
        "META-INF/manifest.mf": "manifest",
        "META-INF/mozilla.sf": "sf",
        "META-INF/mozilla.rsa": "rsa",
        "META-INF/cose.manifest": "cose",
      },
    ] as const) {
      const packageRoot = await createPackageRoot();
      await writeMatchingXpi(packageRoot, { signatureEntries });

      await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, true))).rejects.toThrow("signed extension metadata");
    }
  });

  it("rejects signed-XPI digest metadata that does not match the payload", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot, {
      signatureEntries: {
        "META-INF/manifest.mf": "Manifest-Version: 1.0\r\n\r\nName: manifest.json\r\nSHA256-Digest: invalid\r\n\r\n",
        "META-INF/mozilla.sf": "Signature-Version: 1.0\r\nSHA256-Digest-Manifest: invalid\r\n\r\n",
        "META-INF/mozilla.rsa": Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]),
      },
    });

    await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, true))).rejects.toThrow("digest");
  });

  for (const requireSignedXpi of [false, true] as const) {
    const mode = requireSignedXpi ? "signed-release" : "default";

    it(`rejects stale same-version XPI payloads in ${mode} mode`, async () => {
      const packageRoot = await createPackageRoot();
      await writeMatchingXpi(packageRoot, {
        payloadOverrides: {
          "background.js": "console.log('stale but same version');\n",
        },
      });

      await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, requireSignedXpi))).rejects.toThrow("payload differs from package file");
    });

    it(`rejects XPI path-set mismatches in ${mode} mode`, async () => {
      const packageRoot = await createPackageRoot();
      await writeMatchingXpi(packageRoot, {
        payloadOverrides: {
          "unexpected.txt": "not part of the development payload",
        },
      });

      await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, requireSignedXpi))).rejects.toThrow("files outside the package payload");
    });

    it(`rejects missing XPI payload files in ${mode} mode`, async () => {
      const packageRoot = await createPackageRoot();
      await writeMatchingXpi(packageRoot, {
        payloadOverrides: {
          "popup.css": undefined,
        },
      });

      await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, requireSignedXpi))).rejects.toThrow("Expected extension artifact: popup.css");
    });

    it(`rejects signed manifest drift in ${mode} mode`, async () => {
      for (const manifestOverride of [
        { version: "9.9.9" },
        { browser_specific_settings: { gecko: { id: "wrong@example.invalid" } } },
        { browser_specific_settings: { gecko: { id: "ff-cli-bridge@respawn.pro" } } },
        { permissions: ["nativeMessaging", "scripting"] },
        { host_permissions: [] },
        {
          browser_specific_settings: {
            gecko: {
              id: "ff-cli-bridge@respawn.pro",
              data_collection_permissions: { required: ["technicalAndInteraction"] },
            },
          },
        },
      ] as const) {
        const packageRoot = await createPackageRoot();
        await writeMatchingXpi(packageRoot, {
          manifestOverride,
        });

        await expect(verifyPackageLayout(createPackageCheckOptions(packageRoot, requireSignedXpi))).rejects.toThrow("Expected extension");
      }
    });
  }

  it("ignores package-only development artifacts when comparing signed XPI payloads", async () => {
    const packageRoot = await createPackageRoot();
    await writeFile(join(packageRoot, "extension/development/README.md"), "package notes\n");
    await writeFile(join(packageRoot, `extension/development/firefox-cli-${rootPackage.version}.zip`), "development archive placeholder");
    await writeMatchingXpi(packageRoot);

    await verifyPackageLayout(createPackageCheckOptions(packageRoot, true));
  });

  it("rejects malformed and wrong-shape package manifests", async () => {
    const malformed = await createPackageRoot();
    await writeFile(join(malformed, "package.json"), "{");
    await expect(verifyPackageLayout({ packageRoot: malformed, platform })).rejects.toThrow("Invalid package manifest JSON");

    const wrongShape = await createPackageRoot();
    await writeFile(join(wrongShape, "package.json"), JSON.stringify({ name: "firefox-cli", version: 1, bin: "bin/firefox-cli.js" }));
    await expect(verifyPackageLayout({ packageRoot: wrongShape, platform })).rejects.toThrow("Invalid package manifest");
  });

  it("rejects malformed and wrong-shape development extension manifests", async () => {
    const malformed = await createPackageRoot();
    await writeFile(join(malformed, "extension/development/manifest.json"), "{");
    await expect(verifyPackageLayout({ packageRoot: malformed, platform })).rejects.toThrow("Invalid development extension manifest JSON");

    const wrongShape = await createPackageRoot();
    await writeFile(
      join(wrongShape, "extension/development/manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: extensionDisplayMetadata.name,
        version: rootPackage.version,
        background: { scripts: "background.js" },
        permissions: "scripting",
        action: { default_popup: "popup.html" },
      }),
    );
    await expect(verifyPackageLayout({ packageRoot: wrongShape, platform })).rejects.toThrow("Invalid development extension manifest");
  });

  it("fails when packaged extension metadata drifts from the product version", async () => {
    const packageRoot = await createPackageRoot({ extensionVersion: "9.9.9" });

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow("Expected extension version");
  });

  it("rejects extension bundles with shared JavaScript chunks", async () => {
    const packageRoot = await createPackageRoot();
    await mkdir(join(packageRoot, "extension/development/chunks"), { recursive: true });
    await writeFile(join(packageRoot, "extension/development/chunks/index.js"), "export {};\n");

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow("Unexpected extension JavaScript artifacts");
  });

  it("rejects extension entry scripts that import generated chunks", async () => {
    const packageRoot = await createPackageRoot();
    await writeFile(join(packageRoot, "extension/development/background.js"), 'import "./chunks/index.js";\n');

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow("Expected standalone extension script");
  });

  it("rejects symlinks in the packaged development extension payload", async () => {
    const packageRoot = await createPackageRoot();
    const outsideFile = join(await createTempDir("firefox-cli-outside-extension"), "secret.txt");
    await writeFile(outsideFile, "outside package\n");
    await symlink(outsideFile, join(packageRoot, "extension/development/outside.txt"));

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow("Refusing to traverse symlink");
  });

  it("rejects symlinked signed extension artifacts before reading them", async () => {
    const packageRoot = await createPackageRoot();
    const outsideFile = join(await createTempDir("firefox-cli-outside-xpi"), "firefox-cli.xpi");
    await writeFile(outsideFile, "not really an xpi\n");
    await symlink(outsideFile, join(packageRoot, "extension/firefox-cli.xpi"));

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow("Refusing to read symlink");
  });

  it("rejects symlinks when hashing extension source provenance", async () => {
    const packageRoot = await createPackageRoot();
    const outsideFile = join(await createTempDir("firefox-cli-outside-provenance"), "secret.txt");
    await writeFile(outsideFile, "outside package\n");
    await symlink(outsideFile, join(packageRoot, "extension/development/outside.txt"));

    await expect(hashDirectoryPayload(join(packageRoot, "extension/development"))).rejects.toThrow("Refusing to traverse symlink");
  });
});
