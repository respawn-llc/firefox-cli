import { describe, expect, it } from "vitest";
import { compileGlob, matchesGlob } from "./glob.js";

describe("glob matching", () => {
  it("matches anchored star wildcards across paths and URLs", () => {
    expect(matchesGlob("https://example.test/app/main.js", "https://*.test/*.js")).toBe(true);
    expect(matchesGlob("/downloads/report.csv", "/downloads/*.csv")).toBe(true);
    expect(matchesGlob("prefix-suffix", "prefix*suffix")).toBe(true);
    expect(matchesGlob("prefix-only", "prefix*suffix")).toBe(false);
  });

  it("keeps question marks literal by default for URL queries and filenames", () => {
    expect(matchesGlob("https://example.test/api?x=1", "https://example.test/api?x=1")).toBe(true);
    expect(matchesGlob("https://example.test/api/x=1", "https://example.test/api?x=1")).toBe(false);
    expect(matchesGlob("report?.csv", "report?.csv")).toBe(true);
    expect(matchesGlob("report1.csv", "report?.csv")).toBe(false);
  });

  it("supports opt-in question-mark wildcards for URL waits", () => {
    expect(
      matchesGlob("https://example.test/a", "https://example.test/?", {
        questionMark: "wildcard",
      }),
    ).toBe(true);
    expect(
      matchesGlob("https://example.test/ab", "https://example.test/?", {
        questionMark: "wildcard",
      }),
    ).toBe(false);
  });

  it("treats regular-expression metacharacters as literals", () => {
    expect(matchesGlob("file+name[1](draft).txt", "file+name[1](draft).txt")).toBe(true);
    expect(matchesGlob("fileXname1draftYtxt", "file+name[1](draft).txt")).toBe(false);
    expect(matchesGlob("price.$^", "price.$^")).toBe(true);
  });

  it("keeps empty glob anchored to empty values only", () => {
    expect(matchesGlob("", "")).toBe(true);
    expect(matchesGlob("https://example.test/", "")).toBe(false);
  });

  it("returns reusable regular expressions", () => {
    const expression = compileGlob("*.json");

    expect(expression.test("manifest.json")).toBe(true);
    expect(expression.test("manifest.json.backup")).toBe(false);
  });
});
