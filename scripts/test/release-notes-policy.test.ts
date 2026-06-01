import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { firstReleaseNotesHeadings, validateReleaseNotesBody } from "../release-notes-policy.js";

describe("release notes policy", () => {
  it("rejects literal newline escapes in release body markdown", () => {
    expect(validateReleaseNotesBody("Broken\\n\\n## Highlights", ["## Highlights"])).toEqual(["Release notes contain literal newline escape sequences."]);
  });

  it("requires first-release sections in v0.1.1 release notes", async () => {
    const body = await readFile("docs/release-notes/v0.1.1.md", "utf8");

    expect(validateReleaseNotesBody(body, firstReleaseNotesHeadings)).toEqual([]);
  });
});
