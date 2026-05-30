import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import {
  FIREFOX_CLI_EXTENSION_ID,
  resolvePackagedBinary,
  type PlatformInput,
} from "@firefox-cli/native-host";
import {
  getExtensionPermissionRequirements,
  type FirefoxDataCollectionPermission,
  type FirefoxManifestPermission,
} from "@firefox-cli/protocol";
import {
  hashFile,
  hashPayloadMap,
  packagedSignedExtensionProvenanceFile,
  readSignedExtensionProvenance,
} from "./extension-artifact-provenance.js";
import {
  extensionManifestSchema,
  parseJsonManifestContent,
  packageManifestSchema,
  readJsonManifestFile,
  type ExtensionManifest,
} from "./manifest-validation.js";
import { readZipArchive } from "./zip-archive.js";

const SIGNED_EXTENSION_REQUIRED_METADATA = [
  "META-INF/manifest.mf",
  "META-INF/mozilla.sf",
  "META-INF/mozilla.rsa",
] as const;
const SIGNED_EXTENSION_OPTIONAL_COSE_METADATA = [
  "META-INF/cose.manifest",
  "META-INF/cose.sig",
] as const;
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
};

export async function verifyPackageLayout(
  options: PackageCheckOptions,
): Promise<readonly string[]> {
  const artifacts = [
    "package.json",
    "README.md",
    "LICENSE",
    "bin/firefox-cli.js",
    "lib/platform-binary.js",
  ];

  await Promise.all(artifacts.map((artifact) => access(resolve(options.packageRoot, artifact))));
  await verifyPackageJson(options.packageRoot);
  await resolvePackagedBinary(options.packageRoot, options.platform);
  await verifyExtensionArtifact(options);

  return artifacts;
}

async function verifyPackageJson(packageRoot: string): Promise<void> {
  const packageJson = await readJsonManifestFile(
    resolve(packageRoot, "package.json"),
    "package manifest",
    packageManifestSchema,
  );

  if (packageJson.name !== "firefox-cli") {
    throw new Error(
      `Expected package name firefox-cli, received ${packageJson.name ?? "<missing>"}`,
    );
  }
  if (packageJson.version !== rootPackage.version) {
    throw new Error(
      `Expected package version ${rootPackage.version}, received ${packageJson.version}`,
    );
  }
  if (packageJson.bin?.["firefox-cli"] !== "./bin/firefox-cli.js") {
    throw new Error("Expected firefox-cli bin to point at ./bin/firefox-cli.js");
  }
}

async function verifyExtensionArtifact(options: PackageCheckOptions): Promise<void> {
  const signedXpiPath = resolve(options.packageRoot, "extension/firefox-cli.xpi");
  const signedXpi = await readOptionalFile(signedXpiPath);

  if (signedXpi !== undefined) {
    await verifySignedExtensionArtifact({
      packageRoot: options.packageRoot,
      artifactPath: signedXpiPath,
      archiveData: signedXpi,
    });
    return;
  }

  if (options.requireSignedXpi) {
    throw new Error(`Expected signed extension XPI at ${signedXpiPath}`);
  }

  const developmentPayload = await readDevelopmentExtensionPayload(options.packageRoot);
  const manifest = await readJsonManifestFile(
    resolve(options.packageRoot, "extension/development/manifest.json"),
    "development extension manifest",
    extensionManifestSchema,
  );
  verifyExpectedExtensionManifest(manifest);
  await verifyExtensionBundlePayload(developmentPayload);
}

async function verifySignedExtensionArtifact(input: {
  readonly packageRoot: string;
  readonly artifactPath: string;
  readonly archiveData: Buffer;
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
  await verifySignedExtensionProvenance(input.packageRoot, input.artifactPath, xpiPayload);

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

async function verifySignedExtensionProvenance(
  packageRoot: string,
  artifactPath: string,
  xpiPayload: ReadonlyMap<string, Buffer>,
): Promise<void> {
  const provenancePath = resolve(packageRoot, "extension", packagedSignedExtensionProvenanceFile);
  const provenance = await readSignedExtensionProvenance(provenancePath).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Expected signed extension provenance at ${provenancePath}: ${message}`);
  });

  if (provenance.packageVersion !== rootPackage.version) {
    throw new Error(
      `Expected signed extension provenance version ${rootPackage.version}, received ${provenance.packageVersion}`,
    );
  }
  if (provenance.xpiSha256 !== (await hashFile(artifactPath))) {
    throw new Error("Signed extension provenance digest does not match packaged XPI.");
  }
  if (provenance.sourceSha256 !== hashPayloadMap(xpiPayload)) {
    throw new Error("Signed extension provenance source digest does not match packaged XPI.");
  }
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

  const unexpectedDigestEntries = [...manifestEntries.keys()].filter(
    (file) => !signableEntries.has(file),
  );
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

  for (const line of data
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")) {
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
  digestHeaders:
    | typeof SIGNED_EXTENSION_DIGEST_HEADERS
    | typeof SIGNED_EXTENSION_MANIFEST_DIGEST_HEADERS,
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

function verifyExpectedExtensionManifest(manifest: ExtensionManifest): void {
  const requirements = getExtensionPermissionRequirements();
  if (manifest.name !== "firefox-cli") {
    throw new Error(`Expected extension name firefox-cli, received ${manifest.name}`);
  }
  if (manifest.version !== rootPackage.version) {
    throw new Error(
      `Expected extension version ${rootPackage.version}, received ${manifest.version ?? "<missing>"}`,
    );
  }
  if (manifest.browser_specific_settings?.gecko.id !== FIREFOX_CLI_EXTENSION_ID) {
    throw new Error(
      `Expected extension ID ${FIREFOX_CLI_EXTENSION_ID}, received ${
        manifest.browser_specific_settings?.gecko.id ?? "<missing>"
      }`,
    );
  }
  if (
    manifest.browser_specific_settings?.gecko.strict_min_version !==
    requirements.firefoxStrictMinVersion
  ) {
    throw new Error(
      `Expected extension Firefox minimum version ${requirements.firefoxStrictMinVersion}, received ${
        manifest.browser_specific_settings?.gecko.strict_min_version ?? "<missing>"
      }`,
    );
  }
  if (manifest.background?.scripts?.join(",") !== "background.js") {
    throw new Error("Expected extension background script to be background.js");
  }
  if (manifest.action?.default_popup !== "popup.html") {
    throw new Error("Expected extension popup to be popup.html");
  }

  assertExactSet(
    manifest.permissions,
    requirements.manifestPermissions,
    "extension manifest permissions",
  );
  assertExactSet(
    manifest.host_permissions ?? [],
    requirements.hostPermissions,
    "extension host permissions",
  );
  assertExactSet(
    manifest.browser_specific_settings?.gecko.data_collection_permissions?.required ?? [],
    requirements.dataCollection.required,
    "extension required data collection permissions",
  );
  assertExactSet(
    manifest.browser_specific_settings?.gecko.data_collection_permissions?.optional ?? [],
    requirements.dataCollection.optional,
    "extension optional data collection permissions",
  );
}

function assertExactSet<
  T extends FirefoxManifestPermission | FirefoxDataCollectionPermission | string,
>(actual: readonly T[], expected: readonly T[], label: string): void {
  const actualSorted = [...actual].sort((left, right) => left.localeCompare(right));
  const expectedSorted = [...expected].sort((left, right) => left.localeCompare(right));
  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    throw new Error(
      `Expected ${label} ${expectedSorted.join(", ")}, received ${
        actualSorted.length === 0 ? "<none>" : actualSorted.join(", ")
      }`,
    );
  }
}

async function verifyExtensionBundlePayload(payload: ReadonlyMap<string, Buffer>): Promise<void> {
  const requiredFiles = [
    "manifest.json",
    "background.js",
    "content.js",
    "popup.js",
    "popup.html",
    "popup.css",
  ] as const;
  for (const artifact of requiredFiles) {
    if (!payload.has(artifact)) {
      throw new Error(`Expected extension artifact: ${artifact}`);
    }
  }

  const unexpectedJs = [...payload.keys()]
    .filter((file) => file.endsWith(".js"))
    .filter((file) => !["background.js", "content.js", "popup.js"].includes(file));
  if (unexpectedJs.length > 0) {
    throw new Error(`Unexpected extension JavaScript artifacts: ${unexpectedJs.join(", ")}`);
  }

  await Promise.all(
    ["background.js", "content.js", "popup.js"].map(async (artifact) => {
      const source = payload.get(artifact)?.toString("utf8") ?? "";
      if (
        source.includes('from"./') ||
        source.includes('from "./') ||
        source.includes('import"./') ||
        source.includes('import "./') ||
        source.includes("import(")
      ) {
        throw new Error(`Expected standalone extension script without chunk imports: ${artifact}`);
      }
    }),
  );
}

async function verifyPayloadMatchesDevelopmentBundle(
  packageRoot: string,
  xpiPayload: ReadonlyMap<string, Buffer>,
): Promise<void> {
  const developmentPayload = await readDevelopmentExtensionPayload(packageRoot);
  const developmentFiles = [...developmentPayload.keys()].sort();
  const xpiFiles = [...xpiPayload.keys()].sort();
  const missingFiles = developmentFiles.filter((file) => !xpiPayload.has(file));
  const unexpectedFiles = xpiFiles.filter((file) => !developmentPayload.has(file));

  if (missingFiles.length > 0) {
    throw new Error(`Signed extension XPI is missing package files: ${missingFiles.join(", ")}`);
  }
  if (unexpectedFiles.length > 0) {
    throw new Error(
      `Signed extension XPI contains files outside the package payload: ${unexpectedFiles.join(", ")}`,
    );
  }

  for (const [file, expected] of developmentPayload) {
    const actual = xpiPayload.get(file);
    if (actual === undefined || !actual.equals(expected)) {
      throw new Error(`Signed extension XPI payload differs from package file: ${file}`);
    }
  }
}

async function readDevelopmentExtensionPayload(
  packageRoot: string,
): Promise<ReadonlyMap<string, Buffer>> {
  const extensionRoot = resolve(packageRoot, "extension/development");
  const packageOnlyFiles = new Set(["README.md", `firefox-cli-${rootPackage.version}.zip`]);
  const files = (await listRelativeFiles(extensionRoot)).filter(
    (file) => !packageOnlyFiles.has(file),
  );
  const payload = await Promise.all(
    files.map(async (file) => [file, await readFile(resolve(extensionRoot, file))] as const),
  );
  return new Map(payload);
}

async function listRelativeFiles(root: string, prefix = ""): Promise<readonly string[]> {
  const entries = await readdir(resolve(root, prefix), { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? listRelativeFiles(root, relativePath) : [relativePath];
    }),
  );

  return files.flat();
}

async function readOptionalFile(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
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
