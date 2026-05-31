import { describe, expect, it } from "vitest";
import { verifySignedExtensionSignature } from "../signed-extension-signature.js";
import { createPkcs7Signature, createTestSigningMaterial } from "./signature-test-utils.js";

describe("verifySignedExtensionSignature", () => {
  it("verifies detached PKCS7 content and signer identity", async () => {
    const material = await createTestSigningMaterial();
    const signedContent = Buffer.from("Signature-Version: 1.0\r\n\r\n", "utf8");
    const signatureData = await createPkcs7Signature(signedContent, material);

    await verifySignedExtensionSignature({
      expectation: material.expectation,
      signatureData,
      signedContent,
    });
  });

  it("rejects detached PKCS7 content mismatches", async () => {
    const material = await createTestSigningMaterial();
    const signatureData = await createPkcs7Signature(Buffer.from("original", "utf8"), material);

    await expect(
      verifySignedExtensionSignature({
        expectation: material.expectation,
        signatureData,
        signedContent: Buffer.from("tampered", "utf8"),
      }),
    ).rejects.toThrow("PKCS7 verification failed");
  });

  it("rejects unexpected signer identity", async () => {
    const material = await createTestSigningMaterial("unexpected test signer");
    const signedContent = Buffer.from("Signature-Version: 1.0\r\n\r\n", "utf8");
    const signatureData = await createPkcs7Signature(signedContent, material);

    await expect(
      verifySignedExtensionSignature({
        expectation: {
          trustRootsPem: material.certificatePem,
          issuerIncludes: ["CN=firefox-cli test signer"],
          subjectIncludes: ["CN=firefox-cli test signer"],
        },
        signatureData,
        signedContent,
      }),
    ).rejects.toThrow("signer subject");
  });
});
