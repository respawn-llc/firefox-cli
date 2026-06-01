import { describe, expect, it } from "vitest";
import { readWebExtJwtCredentials } from "../sign-extension-credentials.js";

describe("readWebExtJwtCredentials", () => {
  it("accepts Mozilla JWT issuer and secret names", () => {
    expect(
      readWebExtJwtCredentials({
        WEB_EXT_JWT_ISSUER: "issuer",
        WEB_EXT_JWT_SECRET: "secret",
      }),
    ).toEqual({
      issuer: "issuer",
      secret: "secret",
    });
  });

  it("rejects legacy web-ext API credential names", () => {
    expect(() =>
      readWebExtJwtCredentials({
        WEB_EXT_API_KEY: "issuer",
        WEB_EXT_API_SECRET: "secret",
      }),
    ).toThrow("Missing WEB_EXT_JWT_ISSUER");
  });
});
