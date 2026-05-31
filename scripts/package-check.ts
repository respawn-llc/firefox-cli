import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import { resolvePackagedBinary, type PlatformInput } from "@firefox-cli/native-host";
import {
  packagedSignedExtensionProvenanceFile,
  readSignedExtensionProvenance,
} from "./extension-artifact-provenance.js";
import {
  extensionManifestSchema,
  parseJsonManifestContent,
  packageManifestSchema,
} from "./manifest-validation.js";
import { verifyExpectedExtensionManifest } from "./extension-manifest-check.js";
import {
  readDevelopmentExtensionPayload,
  verifyExtensionBundlePayload,
  verifyPayloadMatchesDevelopmentBundle,
} from "./extension-payload-check.js";
import { readOptionalRegularFileUnder, readRegularFileUnder } from "./safe-extension-files.js";
import { verifySignedExtensionArtifactTrust } from "./signed-extension-artifact.js";
import { packagedSignedExtensionXpiFile, type SignedExtensionChannel } from "./signed-extension-policy.js";
import type { SignedExtensionSignatureVerifier } from "./signed-extension-signature.js";
import { readZipArchive } from "./zip-archive.js";

const SIGNED_EXTENSION_REQUIRED_METADATA = [
  "META-INF/manifest.mf",
  "META-INF/mozilla.sf",
  "META-INF/mozilla.rsa",
] as const;
const SIGNED_EXTENSION_OPTIONAL_COSE_METADATA = ["META-INF/cose.manifest", "META-INF/cose.sig"] as const;
const SIGNED_EXTENSION_DIGEST_HEADERS = [
  { algorithm: "sha256", headers: ["sha256-digest", "sha-256-digest"] },
  { algorithm: "sha384", headers: ["sha384-digest", "sha-384-digest"] },
  { algorithm: "sha512", headers: ["sha512-digest", "sha-512-digest"] },
] as const;
const SIGNED_EXTENSION_MANIFEST_DIGEST_HEADERS = [
  { algorithm: "sha256", headers: ["sha256-digest-manifest", "sha-256-digest-manifest"] },
  { algorithm: "sha384", headers: ["sha384-digest-manifest", "sha-384-digest-manifest"] },
  { algorithm: "sha512", headers: ["sha512-digest-manifest", "sha-512-digest-manifest"] },
] as const;

export type PackageCheckOptions = {
  readonly packageRoot: string;
  readonly platform?: PlatformInput;
  readonly requireSignedXpi?: boolean;
  readonly signedExtensionChannel?: SignedExtensionChannel;
  readonly signedExtensionSignatureVerifier?: SignedExtensionSignatureVerifier;
};

export async function verifyPackageLayout(options: PackageCheckOptions): Promise<readonly string[]> {
  const artifacts = ["package.json", "README.md", "LICENSE", "bin/firefox-cli.js", "lib/platform-binary.js"];

  await Promise.all(
    artifacts.map((artifact) => readRegularFileUnder(options.packageRoot, artifact, artifact)),
  );
  await verifyPackageJson(options.packageRoot);
  const binaryPath = await resolvePackagedBinary(options.packageRoot, options.platform);
  await readRegularFileUnder(
    options.packageRoot,
    relative(options.packageRoot, binaryPath),
    "platform binary",
  );
  await verifyExtensionArtifact(options);

  return artifacts;
}

async function verifyPackageJson(packageRoot: string): Promise<void> {
  const packageJson = parseJsonManifestContent(
    (await readRegularFileUnder(packageRoot, "package.json", "package manifest")).toString("utf8"),
    "package manifest",
    resolve(packageRoot, "package.json"),
    packageManifestSchema,
  );

  if (packageJson.name !== "firefox-cli") {
    throw new Error(`Expected package name firefox-cli, received ${packageJson.name ?? "<missing>"}`);
  }
  if (packageJson.version !== rootPackage.version) {
    throw new Error(`Expected package version ${rootPackage.version}, received ${packageJson.version}`);
  }
  if (packageJson.bin?.["firefox-cli"] !== "./bin/firefox-cli.js") {
    throw new Error("Expected firefox-cli bin to point at ./bin/firefox-cli.js");
  }
}

async function verifyExtensionArtifact(options: PackageCheckOptions): Promise<void> {
  const signedXpiPath = resolve(options.packageRoot, `extension/${packagedSignedExtensionXpiFile}`);
  const signedXpi = await readOptionalRegularFileUnder(
    options.packageRoot,
    `extension/${packagedSignedExtensionXpiFile}`,
    "signed extension XPI",
  );

  if (signedXpi !== undefined) {
    await verifySignedExtensionArtifact({
      packageRoot: options.packageRoot,
      artifactPath: signedXpiPath,
      archiveData: signedXpi,
      ...(options.signedExtensionChannel === undefined
        ? {}
        : { expectedChannel: options.signedExtensionChannel }),
      ...(options.signedExtensionSignatureVerifier === undefined
        ? {}
        : { verifySignature: options.signedExtensionSignatureVerifier }),
    });
    return;
  }

  if (options.requireSignedXpi) {
    throw new Error(`Expected signed extension XPI at ${signedXpiPath}`);
  }

  const developmentPayload = await readDevelopmentExtensionPayload(options.packageRoot);
  const manifest = parseJsonManifestContent(
    (
      await readRegularFileUnder(
        options.packageRoot,
        "extension/development/manifest.json",
        "development extension manifest",
      )
    ).toString("utf8"),
    "development extension manifest",
    resolve(options.packageRoot, "extension/development/manifest.json"),
    extensionManifestSchema,
  );
  verifyExpectedExtensionManifest(manifest);
  await verifyExtensionBundlePayload(developmentPayload);
}

async function verifySignedExtensionArtifact(input: {
  readonly packageRoot: string;
  readonly artifactPath: string;
  readonly archiveData: Buffer;
  readonly expectedChannel?: SignedExtensionChannel;
  readonly verifySignature?: SignedExtensionSignatureVerifier;
}): Promise<void> {
  const archive = readZipArchive(input.archiveData);
  const signatureEntries = new Map<string, Buffer>();
  const xpiPayload = new Map<string, Buffer>();

  for (const entry of archive.entries) {
    if (entry.isDirectory) {
      continue;
    }

    const data = archive.readEntry(entry);
    if (entry.name.startsWith("META-INF/")) {
      signatureEntries.set(entry.name, data);
    } else {
      xpiPayload.set(entry.name, data);
    }
  }

  verifySignedExtensionMetadata(signatureEntries);
  verifySignedExtensionDigests(signatureEntries, xpiPayload);
  const provenancePath = resolve(input.packageRoot, "extension", packagedSignedExtensionProvenanceFile);
  const provenance = await readSignedExtensionProvenance(provenancePath).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Expected signed extension provenance at ${provenancePath}: ${message}`);
  });
  await verifySignedExtensionArtifactTrust({
    artifactPath: input.artifactPath,
    provenance,
    signatureEntries,
    xpiPayload,
    ...(input.expectedChannel === undefined ? {} : { expectedChannel: input.expectedChannel }),
    ...(input.verifySignature === undefined ? {} : { verifySignature: input.verifySignature }),
  });

  const manifestData = xpiPayload.get("manifest.json");
  if (manifestData === undefined) {
    throw new Error(`Expected signed extension manifest in ${input.artifactPath}`);
  }
  const manifest = parseJsonManifestContent(
    manifestData.toString("utf8"),
    "signed extension manifest",
    `${input.artifactPath}!/manifest.json`,
    extensionManifestSchema,
  );

  verifyExpectedExtensionManifest(manifest);
  await verifyExtensionBundlePayload(xpiPayload);
  await verifyPayloadMatchesDevelopmentBundle(input.packageRoot, xpiPayload);
}

function verifySignedExtensionMetadata(entries: ReadonlyMap<string, Buffer>): void {
  const allowedEntries: ReadonlySet<string> = new Set([
    ...SIGNED_EXTENSION_REQUIRED_METADATA,
    ...SIGNED_EXTENSION_OPTIONAL_COSE_METADATA,
  ]);
  if (entries.size === 0) {
    throw new Error("Expected signed extension XPI signature metadata under META-INF");
  }

  const unexpectedEntries = [...entries.keys()].filter((entry) => !allowedEntries.has(entry));
  if (unexpectedEntries.length > 0) {
    throw new Error(`Unexpected signed extension metadata: ${unexpectedEntries.join(", ")}`);
  }

  for (const entry of SIGNED_EXTENSION_REQUIRED_METADATA) {
    const data = entries.get(entry);
    if (data === undefined) {
      throw new Error(`Expected signed extension metadata entry: ${entry}`);
    }
    if (data.length === 0) {
      throw new Error(`Expected non-empty signed extension metadata entry: ${entry}`);
    }
  }

  const coseManifest = entries.get("META-INF/cose.manifest");
  const coseSignature = entries.get("META-INF/cose.sig");
  if ((coseManifest === undefined) !== (coseSignature === undefined)) {
    throw new Error("Expected COSE signed extension metadata entries to be present as a pair");
  }
  for (const entry of SIGNED_EXTENSION_OPTIONAL_COSE_METADATA) {
    const data = entries.get(entry);
    if (data !== undefined && data.length === 0) {
      throw new Error(`Expected non-empty signed extension metadata entry: ${entry}`);
    }
  }
}

function verifySignedExtensionDigests(
  signatureEntries: ReadonlyMap<string, Buffer>,
  xpiPayload: ReadonlyMap<string, Buffer>,
): void {
  const manifestFile = getSignatureEntry(signatureEntries, "META-INF/manifest.mf");
  const signatureFile = getSignatureEntry(signatureEntries, "META-INF/mozilla.sf");
  const rsaSignature = getSignatureEntry(signatureEntries, "META-INF/mozilla.rsa");
  if (rsaSignature[0] !== 0x30) {
    throw new Error("Expected signed extension PKCS7 metadata entry: META-INF/mozilla.rsa");
  }

  const signableEntries = new Map<string, Buffer>(xpiPayload);
  for (const entry of SIGNED_EXTENSION_OPTIONAL_COSE_METADATA) {
    const data = signatureEntries.get(entry);
    if (data !== undefined) {
      signableEntries.set(entry, data);
    }
  }

  const manifestSections = parseJarManifest(manifestFile, "META-INF/manifest.mf");
  const manifestEntries = new Map<string, ReadonlyMap<string, string>>();
  for (const section of manifestSections) {
    const name = section.get("name");
    if (name === undefined) {
      continue;
    }
    if (manifestEntries.has(name)) {
      throw new Error(`Duplicate signed extension manifest digest entry: ${name}`);
    }
    manifestEntries.set(name, section);
  }

  for (const [file, data] of signableEntries) {
    const section = manifestEntries.get(file);
    if (section === undefined) {
      throw new Error(`Expected signed extension digest for package file: ${file}`);
    }
    verifyDigestHeader(section, data, file, SIGNED_EXTENSION_DIGEST_HEADERS);
  }

  const unexpectedDigestEntries = [...manifestEntries.keys()].filter((file) => !signableEntries.has(file));
  if (unexpectedDigestEntries.length > 0) {
    throw new Error(
      `Signed extension metadata contains digest entries outside the package payload: ${unexpectedDigestEntries.join(
        ", ",
      )}`,
    );
  }

  const signatureMainSection = parseJarManifest(signatureFile, "META-INF/mozilla.sf")[0];
  if (signatureMainSection === undefined) {
    throw new Error("Expected signed extension signature file metadata");
  }
  verifyDigestHeader(
    signatureMainSection,
    manifestFile,
    "META-INF/manifest.mf",
    SIGNED_EXTENSION_MANIFEST_DIGEST_HEADERS,
  );
}

function getSignatureEntry(
  entries: ReadonlyMap<string, Buffer>,
  name: (typeof SIGNED_EXTENSION_REQUIRED_METADATA)[number],
): Buffer {
  const entry = entries.get(name);
  if (entry === undefined) {
    throw new Error(`Expected signed extension metadata entry: ${name}`);
  }
  return entry;
}

function parseJarManifest(data: Buffer, label: string): readonly ReadonlyMap<string, string>[] {
  const sections: Map<string, string>[] = [];
  let currentSection = new Map<string, string>();
  let currentKey: string | undefined;

  for (const line of data.toString("utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    if (line.length === 0) {
      if (currentSection.size > 0) {
        sections.push(currentSection);
      }
      currentSection = new Map<string, string>();
      currentKey = undefined;
      continue;
    }
    if (line.startsWith(" ")) {
      if (currentKey === undefined) {
        throw new Error(`Invalid signed extension manifest metadata in ${label}`);
      }
      currentSection.set(currentKey, `${currentSection.get(currentKey) ?? ""}${line.slice(1)}`);
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid signed extension manifest metadata in ${label}`);
    }
    const key = line.slice(0, separatorIndex).toLowerCase();
    if (currentSection.has(key)) {
      throw new Error(`Duplicate signed extension manifest metadata header in ${label}: ${key}`);
    }
    const rawValue = line.slice(separatorIndex + 1);
    currentSection.set(key, rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue);
    currentKey = key;
  }

  if (currentSection.size > 0) {
    sections.push(currentSection);
  }

  return sections;
}

function verifyDigestHeader(
  section: ReadonlyMap<string, string>,
  data: Buffer,
  label: string,
  digestHeaders: typeof SIGNED_EXTENSION_DIGEST_HEADERS | typeof SIGNED_EXTENSION_MANIFEST_DIGEST_HEADERS,
): void {
  for (const { algorithm, headers } of digestHeaders) {
    for (const header of headers) {
      const expectedDigest = section.get(header);
      if (expectedDigest === undefined) {
        continue;
      }
      const actualDigest = createHash(algorithm).update(data).digest("base64");
      if (actualDigest !== expectedDigest) {
        throw new Error(`Signed extension digest mismatch for ${label}`);
      }
      return;
    }
  }

  throw new Error(`Expected signed extension SHA-256 digest for ${label}`);
}

if (import.meta.main) {
  verifyPackageLayout({ packageRoot: resolve("dist/package") })
    .then(() => {
      console.log("Package layout check passed.");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
