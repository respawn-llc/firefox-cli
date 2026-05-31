import { describe, expect, it } from "vitest";
import {
  classifySourceFile,
  evaluateSourceSizes,
  runSourceSizeCheck,
  sourceSizePolicy,
  type SourceFileSize,
} from "../source-size-check.js";

describe("source size check", () => {
  it("classifies runtime, tests, disposable E2E, and generated paths", () => {
    expect(classifySourceFile("packages/cli/src/index.ts")).toBe("production");
    expect(classifySourceFile("packages/cli/src/cli.test.ts")).toBe("test-support");
    expect(classifySourceFile("scripts/test/package-check.test.ts")).toBe("test-support");
    expect(classifySourceFile("scripts/e2e-disposable-workflow.ts")).toBe("test-support");
    expect(classifySourceFile("packages/test-support/src/index.ts")).toBe("test-support");
    expect(classifySourceFile("packages/cli/dist/index.ts")).toBe("ignored");
    expect(classifySourceFile("packages/protocol/src/index.d.ts")).toBe("ignored");
  });

  it("fails production files above the hard threshold", async () => {
    const writes: string[] = [];
    await expect(
      runSourceSizeCheck({
        files: [
          productionFile(
            "packages/cli/src/route-registry.ts",
            sourceSizePolicy.productionMaxLines + 1,
          ),
        ],
        write: (message) => writes.push(message),
      }),
    ).rejects.toThrow("Production source size check failed");

    expect(writes.join("\n")).toContain("packages/cli/src/route-registry.ts");
  });

  it("reports oversized test support without failing the production gate", async () => {
    const report = await runSourceSizeCheck({
      files: [
        productionFile("packages/cli/src/route-registry.ts", sourceSizePolicy.productionMaxLines),
        testSupportFile(
          "packages/cli/src/cli.test.ts",
          sourceSizePolicy.testSupportReviewTargetLines + 1,
        ),
      ],
      write: () => undefined,
    });

    expect(report.productionViolations).toEqual([]);
    expect(report.oversizedTestSupport).toEqual([
      testSupportFile(
        "packages/cli/src/cli.test.ts",
        sourceSizePolicy.testSupportReviewTargetLines + 1,
      ),
    ]);
  });

  it("sorts production violations by descending line count", () => {
    expect(
      evaluateSourceSizes(
        [productionFile("packages/a/src/a.ts", 801), productionFile("packages/b/src/b.ts", 900)],
        sourceSizePolicy,
      ).productionViolations.map((file) => file.path),
    ).toEqual(["packages/b/src/b.ts", "packages/a/src/a.ts"]);
  });
});

function productionFile(path: string, lines: number): SourceFileSize {
  return { path, lines, kind: "production" };
}

function testSupportFile(path: string, lines: number): SourceFileSize {
  return { path, lines, kind: "test-support" };
}
