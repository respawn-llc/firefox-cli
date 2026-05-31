import { basename } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import { hashFile, hashPayloadMap, type SignedExtensionProvenance } from "./extension-artifact-provenance.js";
import { defaultSignedExtensionChannel, packagedSignedExtensionXpiFile, type SignedExtensionChannel } from "./signed-extension-policy.js";
import { verifySignedExtensionSignature, type SignedExtensionSignatureVerifier } from "./signed-extension-signature.js";

export interface SignedExtensionArtifactVerificationInput {
  readonly artifactPath: string;
  readonly signatureEntries: ReadonlyMap<string, Buffer>;
  readonly xpiPayload: ReadonlyMap<string, Buffer>;
  readonly provenance: SignedExtensionProvenance;
  readonly expectedChannel?: SignedExtensionChannel;
  readonly expectedXpiFile?: string;
  readonly verifySignature?: SignedExtensionSignatureVerifier;
}

export async function verifySignedExtensionArtifactTrust(input: SignedExtensionArtifactVerificationInput): Promise<void> {
  await verifySignedExtensionProvenanceConsistency({
    artifactPath: input.artifactPath,
    provenance: input.provenance,
    xpiPayload: input.xpiPayload,
    ...(input.expectedChannel === undefined ? {} : { expectedChannel: input.expectedChannel }),
    ...(input.expectedXpiFile === undefined ? {} : { expectedXpiFile: input.expectedXpiFile }),
  });
  await (input.verifySignature ?? verifySignedExtensionSignature)({
    signatureData: getSignatureEntry(input.signatureEntries, "META-INF/mozilla.rsa"),
    signedContent: getSignatureEntry(input.signatureEntries, "META-INF/mozilla.sf"),
  });
}

export async function verifySignedExtensionProvenanceConsistency(input: {
  readonly artifactPath: string;
  readonly provenance: SignedExtensionProvenance;
  readonly xpiPayload?: ReadonlyMap<string, Buffer>;
  readonly expectedChannel?: SignedExtensionChannel;
  readonly expectedXpiFile?: string;
}): Promise<void> {
  const expectedChannel = input.expectedChannel ?? defaultSignedExtensionChannel;
  const expectedXpiFile = input.expectedXpiFile ?? packagedSignedExtensionXpiFile;

  if (input.provenance.packageVersion !== rootPackage.version) {
    throw new Error(`Expected signed extension provenance version ${rootPackage.version}, received ${input.provenance.packageVersion}`);
  }
  if (input.provenance.channel !== expectedChannel) {
    throw new Error(`Expected signed extension provenance channel ${expectedChannel}, received ${input.provenance.channel}`);
  }
  if (input.provenance.xpiFile !== expectedXpiFile) {
    throw new Error(`Expected signed extension provenance XPI file ${expectedXpiFile}, received ${input.provenance.xpiFile}`);
  }
  if (input.provenance.xpiSha256 !== (await hashFile(input.artifactPath))) {
    throw new Error("Signed extension provenance digest does not match packaged XPI.");
  }
  if (input.xpiPayload !== undefined && input.provenance.sourceSha256 !== hashPayloadMap(input.xpiPayload)) {
    throw new Error("Signed extension provenance source digest does not match packaged XPI.");
  }
}

export function normalizeSignedExtensionProvenanceForPackage(provenance: SignedExtensionProvenance): SignedExtensionProvenance {
  return {
    ...provenance,
    xpiFile: packagedSignedExtensionXpiFile,
  };
}

export async function verifySignedExtensionSourceProvenance(input: {
  readonly provenance: SignedExtensionProvenance;
  readonly sourceXpiPath: string;
  readonly expectedChannel?: SignedExtensionChannel;
}): Promise<void> {
  const expectedChannel = input.expectedChannel ?? defaultSignedExtensionChannel;
  const expectedXpiFile = basename(input.sourceXpiPath);
  if (input.provenance.packageVersion !== rootPackage.version) {
    throw new Error(`Expected signed extension provenance version ${rootPackage.version}, received ${input.provenance.packageVersion}`);
  }
  if (input.provenance.channel !== expectedChannel) {
    throw new Error(`Expected signed extension provenance channel ${expectedChannel}, received ${input.provenance.channel}`);
  }
  if (input.provenance.xpiFile !== expectedXpiFile) {
    throw new Error(`Expected signed extension provenance XPI file ${expectedXpiFile}, received ${input.provenance.xpiFile}`);
  }
  if (input.provenance.xpiSha256 !== (await hashFile(input.sourceXpiPath))) {
    throw new Error("Signed extension provenance digest does not match source XPI.");
  }
}

function getSignatureEntry(entries: ReadonlyMap<string, Buffer>, name: string): Buffer {
  const entry = entries.get(name);
  if (entry === undefined) {
    throw new Error(`Expected signed extension metadata entry: ${name}`);
  }
  return entry;
}
