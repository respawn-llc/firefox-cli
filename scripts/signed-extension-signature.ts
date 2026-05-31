import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mozillaAmoProductionSignerExpectation,
  type SignedExtensionSignerExpectation,
} from "./signed-extension-policy.js";
import { runProcess, type ProcessResult } from "./process-runner.js";

export type SignedExtensionSignatureVerifier = (
  input: SignedExtensionSignatureVerificationInput,
) => Promise<void>;

export type SignedExtensionSignatureVerificationInput = {
  readonly signatureData: Buffer;
  readonly signedContent: Buffer;
  readonly expectation?: SignedExtensionSignerExpectation;
  readonly opensslBinary?: string;
  readonly run?: typeof runProcess;
};

export async function verifySignedExtensionSignature(
  input: SignedExtensionSignatureVerificationInput,
): Promise<void> {
  const expectation = input.expectation ?? mozillaAmoProductionSignerExpectation;
  const run = input.run ?? runProcess;
  const opensslBinary = input.opensslBinary ?? "openssl";
  const tempRoot = await mkdtemp(join(tmpdir(), "firefox-cli-xpi-signature-"));
  const signaturePath = join(tempRoot, "mozilla.rsa");
  const contentPath = join(tempRoot, "mozilla.sf");
  const outputPath = join(tempRoot, "verified-content");
  const signerPath = join(tempRoot, "signer.pem");
  const trustRootsPath = join(tempRoot, "trust-roots.pem");

  try {
    await Promise.all([
      writeFile(signaturePath, input.signatureData),
      writeFile(contentPath, input.signedContent),
      writeFile(trustRootsPath, expectation.trustRootsPem),
    ]);

    let result: ProcessResult;
    try {
      result = await run(
        opensslBinary,
        [
          "cms",
          "-verify",
          "-inform",
          "DER",
          "-in",
          signaturePath,
          "-content",
          contentPath,
          "-binary",
          "-CAfile",
          trustRootsPath,
          "-no-CApath",
          "-no-CAstore",
          "-purpose",
          "any",
          "-signer",
          signerPath,
          "-out",
          outputPath,
        ],
        {
          label: "signed extension PKCS7 verification",
          timeoutMs: 30_000,
          maxOutputBytes: 16 * 1024,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Signed extension PKCS7 verification failed: ${message}`);
    }

    if (result.exitCode !== 0) {
      throw new Error(`Signed extension PKCS7 verification failed: ${result.stderr}`);
    }

    const certificates = parsePemCertificates(await readFile(signerPath, "utf8"));
    if (certificates.length === 0) {
      throw new Error("Signed extension PKCS7 verification did not expose a signer certificate.");
    }
    const signer = certificates[0];
    if (signer === undefined) {
      throw new Error("Signed extension PKCS7 verification returned an invalid signer.");
    }
    verifySignerIdentity(signer, expectation);
  } finally {
    await cleanupTempFiles([signaturePath, contentPath, outputPath, signerPath, trustRootsPath], tempRoot);
  }
}

async function cleanupTempFiles(files: readonly string[], directory: string): Promise<void> {
  await Promise.all(files.map((file) => unlink(file).catch(() => undefined)));
  await rmdir(directory).catch(() => undefined);
}

function parsePemCertificates(content: string): readonly X509Certificate[] {
  const matches = content.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu);
  return (matches ?? []).map((pem) => new X509Certificate(pem));
}

function verifySignerIdentity(signer: X509Certificate, expectation: SignedExtensionSignerExpectation): void {
  for (const expectedSubject of expectation.subjectIncludes) {
    if (!signer.subject.includes(expectedSubject)) {
      throw new Error(
        `Signed extension signer subject ${signer.subject} does not include ${expectedSubject}`,
      );
    }
  }

  for (const expectedIssuer of expectation.issuerIncludes) {
    if (!signer.issuer.includes(expectedIssuer)) {
      throw new Error(`Signed extension signer issuer ${signer.issuer} does not include ${expectedIssuer}`);
    }
  }
}
