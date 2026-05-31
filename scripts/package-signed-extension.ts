import { extname, resolve } from "node:path";
import {
  readSignedExtensionProvenance,
  type SignedExtensionProvenance,
} from "./extension-artifact-provenance.js";
import {
  normalizeSignedExtensionProvenanceForPackage,
  verifySignedExtensionSourceProvenance,
} from "./signed-extension-artifact.js";
import {
  verifySignedExtensionSignature,
  type SignedExtensionSignatureVerifier,
} from "./signed-extension-signature.js";
import { readRegularFile } from "./safe-extension-files.js";
import { readZipArchive } from "./zip-archive.js";

export type ValidatedSignedExtensionSource = {
  readonly sourceXpiPath: string;
  readonly xpiData: Buffer;
  readonly provenance: SignedExtensionProvenance;
};

export class SignedExtensionSourceNotFoundError extends Error {
  readonly sourceXpiPath: string;

  constructor(sourceXpiPath: string) {
    super(`Signed extension XPI source not found: ${sourceXpiPath}`);
    this.name = "SignedExtensionSourceNotFoundError";
    this.sourceXpiPath = sourceXpiPath;
  }
}

export async function readValidatedSignedExtensionSource(input: {
  readonly sourceXpiPath: string;
  readonly provenancePath: string;
  readonly signatureVerifier?: SignedExtensionSignatureVerifier;
}): Promise<ValidatedSignedExtensionSource> {
  const sourceXpiPath = resolve(input.sourceXpiPath);
  if (extname(sourceXpiPath) !== ".xpi") {
    throw new Error(`Expected signed extension XPI source to use .xpi extension: ${sourceXpiPath}`);
  }

  let xpiData: Buffer;
  try {
    xpiData = await readRegularFile(sourceXpiPath, "signed extension XPI source");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new SignedExtensionSourceNotFoundError(sourceXpiPath);
    }
    throw error;
  }
  const provenance = await readSignedExtensionProvenance(resolve(input.provenancePath));
  await verifySignedExtensionSourceProvenance({
    provenance,
    sourceXpiPath,
  });
  await verifySignedExtensionSourceSignature(xpiData, input.signatureVerifier);

  return { sourceXpiPath, xpiData, provenance };
}

async function verifySignedExtensionSourceSignature(
  xpiData: Buffer,
  signatureVerifier: SignedExtensionSignatureVerifier | undefined,
): Promise<void> {
  const archive = readZipArchive(xpiData);
  const signatureEntries = new Map<string, Buffer>();
  for (const entry of archive.entries) {
    if (!entry.isDirectory && entry.name.startsWith("META-INF/")) {
      signatureEntries.set(entry.name, archive.readEntry(entry));
    }
  }
  await (signatureVerifier ?? verifySignedExtensionSignature)({
    signatureData: getSignatureEntry(signatureEntries, "META-INF/mozilla.rsa"),
    signedContent: getSignatureEntry(signatureEntries, "META-INF/mozilla.sf"),
  });
}

function getSignatureEntry(entries: ReadonlyMap<string, Buffer>, name: string): Buffer {
  const entry = entries.get(name);
  if (entry === undefined) {
    throw new Error(`Expected signed extension metadata entry: ${name}`);
  }
  return entry;
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function packagedSignedExtensionProvenanceJson(
  provenance: SignedExtensionProvenance,
): string {
  return `${JSON.stringify(normalizeSignedExtensionProvenanceForPackage(provenance), null, 2)}\n`;
}
