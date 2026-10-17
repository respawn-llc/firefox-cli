import { beforeAll, describe, expect, it } from "vitest";
import { verifySignedExtensionSignature } from "../signed-extension-signature.js";
import { createPkcs7Signature, createTestSigningMaterial } from "./signature-test-utils.js";

interface SignatureFixture {
  readonly material: Awaited<ReturnType<typeof createTestSigningMaterial>>;
  readonly signedContent: Buffer;
  readonly signatureData: Buffer;
}

describe("verifySignedExtensionSignature", () => {
  let fixture: SignatureFixture | null = null;

  beforeAll(async () => {
    const material = await createTestSigningMaterial();
    const signedContent = Buffer.from("Signature-Version: 1.0\r\n\r\n", "utf8");
    const signatureData = await createPkcs7Signature(signedContent, material);
    fixture = { material, signatureData, signedContent };
  }, 30_000);

  function getFixture(): SignatureFixture {
    if (fixture === null) {
      throw new Error("Signature verification fixture was not initialized.");
    }
    return fixture;
  }

  it("verifies detached PKCS7 content and signer identity", async () => {
    const { material, signatureData, signedContent } = getFixture();

    await verifySignedExtensionSignature({
      expectation: material.expectation,
      signatureData,
      signedContent,
    });
  });

  it("rejects detached PKCS7 content mismatches", async () => {
    const { material, signatureData } = getFixture();

    await expect(
      verifySignedExtensionSignature({
        expectation: material.expectation,
        signatureData,
        signedContent: Buffer.from("tampered", "utf8"),
      }),
    ).rejects.toThrow("PKCS7 verification failed");
  });

  it("rejects unexpected signer identity", async () => {
    const { material, signatureData, signedContent } = getFixture();

    await expect(
      verifySignedExtensionSignature({
        expectation: {
          ...material.expectation,
          trustRootsPem: material.certificatePem,
          subjectIncludes: ["CN=unexpected test signer"],
        },
        signatureData,
        signedContent,
      }),
    ).rejects.toThrow("signer subject");
  });
});
