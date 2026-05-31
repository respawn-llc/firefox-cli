import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { runProcess } from "../process-runner.js";
import type { SignedExtensionSignerExpectation } from "../signed-extension-policy.js";

export type TestSigningMaterial = {
  readonly certificatePem: string;
  readonly certificatePath: string;
  readonly keyPath: string;
  readonly expectation: SignedExtensionSignerExpectation;
};

export async function createTestSigningMaterial(
  commonName = "firefox-cli test signer",
): Promise<TestSigningMaterial> {
  const root = await createTempDir("firefox-cli-signature-fixture");
  const certificatePath = join(root, "signer.pem");
  const keyPath = join(root, "signer.key");
  await runProcess(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
      "-days",
      "1",
      "-nodes",
      "-subj",
      `/O=firefox-cli tests/CN=${commonName}`,
    ],
    { label: "test signing certificate generation", timeoutMs: 30_000 },
  );
  const certificatePem = await readFile(certificatePath, "utf8");
  return {
    certificatePath,
    certificatePem,
    expectation: {
      trustRootsPem: certificatePem,
      subjectIncludes: [`CN=${commonName}`],
      issuerIncludes: [`CN=${commonName}`],
    },
    keyPath,
  };
}

export async function createPkcs7Signature(
  signedContent: Buffer,
  material: TestSigningMaterial,
): Promise<Buffer> {
  const root = await createTempDir("firefox-cli-pkcs7-fixture");
  const contentPath = join(root, "mozilla.sf");
  const signaturePath = join(root, "mozilla.rsa");
  await writeFile(contentPath, signedContent);
  await runProcess(
    "openssl",
    [
      "cms",
      "-sign",
      "-binary",
      "-in",
      contentPath,
      "-signer",
      material.certificatePath,
      "-inkey",
      material.keyPath,
      "-outform",
      "DER",
      "-out",
      signaturePath,
    ],
    { label: "test PKCS7 signature generation", timeoutMs: 30_000 },
  );
  return readFile(signaturePath);
}
