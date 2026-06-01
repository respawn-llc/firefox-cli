import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getBinaryName, getPlatformKey, type PlatformInput } from "@firefox-cli/native-host";
import { getExtensionPermissionRequirements } from "@firefox-cli/protocol";
import { createTempDir } from "@firefox-cli/test-support";
import rootPackage from "../../package.json" with { type: "json" };
import { hashPayloadMap, packagedSignedExtensionProvenanceFile } from "../extension-artifact-provenance.js";
import type { SignedExtensionSignatureVerifier } from "../signed-extension-signature.js";
import { createPkcs7Signature, createTestSigningMaterial, type TestSigningMaterial } from "./signature-test-utils.js";
import { createZipFixture, type ZipFixtureEntryInput } from "./zip-test-utils.js";

export const packageCheckPlatform: PlatformInput = {
  platform: "linux",
  arch: "x64",
};

export const bypassSignatureVerifier: SignedExtensionSignatureVerifier = async () => undefined;

let signingMaterial: TestSigningMaterial | undefined;

export async function initializePackageCheckSigningMaterial(): Promise<void> {
  signingMaterial = await createTestSigningMaterial();
}

export const testSignatureVerifier: SignedExtensionSignatureVerifier = async (input) => {
  if (signingMaterial === undefined) {
    throw new Error("Package-check test signing material was not initialized.");
  }
  return verifySignedExtensionSignatureWithMaterial(input, signingMaterial);
};

export async function createPackageRoot(options: { readonly includeBinary?: boolean; readonly extensionVersion?: string } = {}): Promise<string> {
  const packageRoot = await createTempDir("firefox-cli-package-check");
  const platformKey = getPlatformKey(packageCheckPlatform);
  const extensionRequirements = getExtensionPermissionRequirements();

  await mkdir(join(packageRoot, "bin", platformKey), { recursive: true });
  await mkdir(join(packageRoot, "extension/development"), { recursive: true });

  await writeFile(
    join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "firefox-cli",
        version: rootPackage.version,
        type: "module",
        bin: {
          "firefox-cli": "./bin/firefox-cli.js",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(packageRoot, "README.md"), "# test\n");
  await writeFile(join(packageRoot, "LICENSE"), "AGPL-3.0-only\n");
  await writeFile(join(packageRoot, "bin/firefox-cli.js"), "#!/usr/bin/env node\n");
  await mkdir(join(packageRoot, "lib"), { recursive: true });
  await writeFile(join(packageRoot, "lib/platform-binary.js"), "export {};\n");
  await writeFile(
    join(packageRoot, "extension/development/manifest.json"),
    `${JSON.stringify(
      {
        manifest_version: 3,
        name: "FF-CLI Bridge",
        version: options.extensionVersion ?? rootPackage.version,
        description: "Browser extension bridge for CLI control.",
        browser_specific_settings: {
          gecko: {
            id: "firefox-cli@example.invalid",
            strict_min_version: extensionRequirements.firefoxStrictMinVersion,
            data_collection_permissions: extensionRequirements.dataCollection,
          },
        },
        background: { scripts: ["background.js"] },
        permissions: extensionRequirements.manifestPermissions,
        host_permissions: extensionRequirements.hostPermissions,
        action: { default_popup: "popup.html", default_title: "FF-CLI Bridge" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(packageRoot, "extension/development/background.js"), "console.log('bg');\n");
  await writeFile(join(packageRoot, "extension/development/content.js"), "console.log('cs');\n");
  await writeFile(join(packageRoot, "extension/development/popup.js"), "console.log('popup');\n");
  await writeFile(join(packageRoot, "extension/development/popup.html"), "<!doctype html>\n");
  await writeFile(join(packageRoot, "extension/development/popup.css"), "body {}\n");

  if (options.includeBinary !== false) {
    await writeFile(join(packageRoot, "bin", platformKey, getBinaryName(packageCheckPlatform)), "");
  }

  return packageRoot;
}

export function createPackageCheckOptions(packageRoot: string, requireSignedXpi: boolean) {
  return requireSignedXpi
    ? {
        packageRoot,
        platform: packageCheckPlatform,
        requireSignedXpi: true,
        signedExtensionSignatureVerifier: bypassSignatureVerifier,
      }
    : {
        packageRoot,
        platform: packageCheckPlatform,
        signedExtensionSignatureVerifier: bypassSignatureVerifier,
      };
}

export async function writeMatchingXpi(
  packageRoot: string,
  options: {
    readonly compressionMethod?: number;
    readonly eocdComment?: string;
    readonly manifestOverride?: Record<string, unknown>;
    readonly payloadOverrides?: Record<string, string | Buffer | undefined>;
    readonly realSignature?: boolean;
    readonly signed?: boolean;
    readonly signatureEntries?: Record<string, string | Buffer>;
    readonly useDataDescriptor?: boolean;
    readonly writeProvenance?: boolean;
    readonly provenanceOverrides?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const payload = await readDevelopmentPayload(packageRoot);
  applyPayloadOverrides(payload, options.payloadOverrides);
  applyManifestOverride(payload, options.manifestOverride);

  const payloadEntries: ZipFixtureEntryInput[] = [...payload.entries()].map(([name, data]) => ({
    name,
    data,
    compressionMethod: options.compressionMethod ?? 0,
    ...(options.useDataDescriptor === undefined ? {} : { useDataDescriptor: options.useDataDescriptor }),
  }));
  const signatureEntries = await createSignatureEntries(options, payload);
  const fixture = createZipFixture([...payloadEntries, ...signatureEntries], options.eocdComment === undefined ? {} : { eocdComment: options.eocdComment });

  await writeFile(join(packageRoot, "extension/firefox-cli.xpi"), fixture.data);
  if (options.signed !== false && options.writeProvenance !== false) {
    await writeSignedXpiProvenance(packageRoot, payload, fixture.data, options.provenanceOverrides);
  }
}

function applyPayloadOverrides(payload: Map<string, Buffer>, overrides: Record<string, string | Buffer | undefined> | undefined): void {
  for (const [file, data] of Object.entries(overrides ?? {})) {
    if (data === undefined) {
      payload.delete(file);
    } else {
      payload.set(file, Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"));
    }
  }
}

function applyManifestOverride(payload: Map<string, Buffer>, manifestOverride: Record<string, unknown> | undefined): void {
  if (manifestOverride !== undefined) {
    const parsedManifest: unknown = JSON.parse(payload.get("manifest.json")?.toString("utf8") ?? "{}");
    if (!isRecord(parsedManifest)) {
      throw new Error("Expected package-check fixture manifest to be an object.");
    }
    payload.set("manifest.json", Buffer.from(`${JSON.stringify({ ...parsedManifest, ...manifestOverride }, null, 2)}\n`));
  }
}

async function writeSignedXpiProvenance(
  packageRoot: string,
  payload: ReadonlyMap<string, Buffer>,
  fixtureData: Buffer,
  provenanceOverrides: Record<string, unknown> | undefined,
): Promise<void> {
  await writeFile(
    join(packageRoot, "extension", packagedSignedExtensionProvenanceFile),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        packageVersion: rootPackage.version,
        channel: "unlisted",
        sourceDir: join(packageRoot, "extension/development"),
        sourceSha256: hashPayloadMap(payload),
        xpiFile: "firefox-cli.xpi",
        xpiSha256: createHash("sha256").update(fixtureData).digest("hex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        ...provenanceOverrides,
      },
      null,
      2,
    )}\n`,
  );
}

async function createSignatureEntries(
  options: {
    readonly realSignature?: boolean;
    readonly signatureEntries?: Record<string, string | Buffer>;
    readonly signed?: boolean;
  },
  payload: ReadonlyMap<string, Buffer>,
): Promise<readonly ZipFixtureEntryInput[]> {
  if (options.signatureEntries !== undefined) {
    return Object.entries(options.signatureEntries).map(([name, data]) => ({
      name,
      data,
    }));
  }
  if (options.signed === false) {
    return [];
  }
  const manifestFile = createSignedManifest(payload);
  const signatureFile = createSignatureFile(manifestFile);
  const signatureData = options.realSignature === true ? await createRealSignature(signatureFile) : Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]);
  return [
    { name: "META-INF/manifest.mf", data: manifestFile },
    { name: "META-INF/mozilla.sf", data: signatureFile },
    { name: "META-INF/mozilla.rsa", data: signatureData },
  ];
}

async function createRealSignature(signatureFile: Buffer): Promise<Buffer> {
  if (signingMaterial === undefined) {
    throw new Error("Package-check test signing material was not initialized.");
  }
  return createPkcs7Signature(signatureFile, signingMaterial);
}

function createSignedManifest(payload: ReadonlyMap<string, Buffer>): Buffer {
  const lines = ["Manifest-Version: 1.0", ""];
  for (const [name, data] of [...payload.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`Name: ${name}`, `SHA256-Digest: ${sha256Digest(data)}`, "");
  }
  return Buffer.from(lines.join("\r\n"), "utf8");
}

function createSignatureFile(manifestFile: Buffer): Buffer {
  return Buffer.from(`Signature-Version: 1.0\r\nSHA256-Digest-Manifest: ${sha256Digest(manifestFile)}\r\n\r\n`, "utf8");
}

function sha256Digest(data: Buffer): string {
  return createHash("sha256").update(data).digest("base64");
}

async function readDevelopmentPayload(packageRoot: string): Promise<Map<string, Buffer>> {
  const extensionRoot = join(packageRoot, "extension/development");
  const packageOnlyFiles = new Set(["README.md", `firefox-cli-${rootPackage.version}.zip`]);
  const files = (await listRelativeFiles(extensionRoot)).filter((file) => !packageOnlyFiles.has(file));
  const entries = await Promise.all(files.map(async (file) => [file, await readFile(join(extensionRoot, file))] as const));
  return new Map(entries);
}

async function listRelativeFiles(root: string, prefix = ""): Promise<readonly string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? listRelativeFiles(root, relativePath) : [relativePath];
    }),
  );
  return files.flat();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function verifySignedExtensionSignatureWithMaterial(
  input: Parameters<SignedExtensionSignatureVerifier>[0],
  material: TestSigningMaterial,
): Promise<void> {
  const { verifySignedExtensionSignature } = await import("../signed-extension-signature.js");
  await verifySignedExtensionSignature({
    ...input,
    expectation: material.expectation,
  });
}
