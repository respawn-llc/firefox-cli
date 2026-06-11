import { describe, expect, it } from "vitest";
import { resolveNpmPublishPlan } from "../npm-publish.js";

describe("resolveNpmPublishPlan", () => {
  it("plans a local cross-compiled publish", () => {
    const plan = resolveNpmPublishPlan(["--build-all"]);

    expect(plan.buildAll).toBe(true);
    expect(plan.dryRun).toBe(false);
    expect(plan.provenance).toBe(false);
    expect(plan.requireSignedXpi).toBe(false);
    expect(plan.registry).toBe("https://registry.npmjs.org");
    expect(plan.publishArgs).toEqual(["publish", "--access", "public", "--registry", "https://registry.npmjs.org"]);
    expect(plan.packageRoots.at(-1)).toMatch(/dist\/npm\/firefox-cli$/);
  });

  it("plans CI trusted-publishing release verification", () => {
    const plan = resolveNpmPublishPlan(["--require-signed-xpi", "--provenance", "--dry-run"]);

    expect(plan.buildAll).toBe(false);
    expect(plan.dryRun).toBe(true);
    expect(plan.provenance).toBe(true);
    expect(plan.requireSignedXpi).toBe(true);
    expect(plan.publishArgs).toEqual(["publish", "--access", "public", "--registry", "https://registry.npmjs.org", "--provenance", "--dry-run"]);
  });

  it("forwards local npm publish credentials and extra npm args", () => {
    const plan = resolveNpmPublishPlan(["--otp", "123456", "--", "--tag", "next"]);

    expect(plan.publishArgs).toEqual(["publish", "--access", "public", "--registry", "https://registry.npmjs.org", "--otp=123456", "--tag", "next"]);
  });
});
