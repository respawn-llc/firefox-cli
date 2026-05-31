import { describe, expect, it } from "vitest";
import {
  classifyVersionChange,
  dependencyUpgradePolicy,
  MAJOR_RELEASE_AGE_DAYS,
  minimumReleaseAgeDaysFor,
  PATCH_MINOR_RELEASE_AGE_DAYS,
  renderDependencyUpgradePolicy,
  runDependencyUpgradeCheck,
  SECONDS_PER_DAY,
} from "../dependency-upgrade-check.js";

describe("dependency upgrade policy", () => {
  it("classifies semantic version upgrades by migration risk", () => {
    expect(classifyVersionChange("4.1.6", "4.1.7")).toBe("patch");
    expect(classifyVersionChange("^7.2.4", "7.3.3")).toBe("minor");
    expect(classifyVersionChange("5.9.3", "6.0.3")).toBe("major");
    expect(classifyVersionChange("24.12.4", "24.12.4")).toBe("none");
    expect(classifyVersionChange("workspace:*", "1.0.0")).toBe("unknown");
  });

  it("assigns release-age gates by upgrade risk", () => {
    expect(minimumReleaseAgeDaysFor("patch")).toBe(PATCH_MINOR_RELEASE_AGE_DAYS);
    expect(minimumReleaseAgeDaysFor("minor")).toBe(PATCH_MINOR_RELEASE_AGE_DAYS);
    expect(minimumReleaseAgeDaysFor("major")).toBe(MAJOR_RELEASE_AGE_DAYS);
    expect(minimumReleaseAgeDaysFor("unknown")).toBe(MAJOR_RELEASE_AGE_DAYS);
    expect(minimumReleaseAgeDaysFor("none")).toBe(0);
  });

  it("records the aged outdated command in seconds", () => {
    expect(dependencyUpgradePolicy.agedOutdatedCommand).toEqual([
      "bun",
      "outdated",
      `--minimum-release-age=${String(PATCH_MINOR_RELEASE_AGE_DAYS * SECONDS_PER_DAY)}`,
    ]);
  });

  it("renders the verification commands required after upgrades", () => {
    expect(renderDependencyUpgradePolicy()).toContain("bun run check");
    expect(renderDependencyUpgradePolicy()).toContain("bun run release:check");
    expect(renderDependencyUpgradePolicy()).toContain("bun run release:check:local");
  });

  it("runs audit before the aged dependency drift report", async () => {
    const calls: {
      readonly command: string;
      readonly args: readonly string[];
      readonly label: string | undefined;
    }[] = [];

    await runDependencyUpgradeCheck({
      runCommand: async (command, args, options) => {
        calls.push({ command, args, label: options.label });
      },
      write: () => undefined,
    });

    expect(calls).toEqual([
      {
        command: "bun",
        args: ["audit"],
        label: "dependency audit",
      },
      {
        command: "bun",
        args: ["outdated", `--minimum-release-age=${String(PATCH_MINOR_RELEASE_AGE_DAYS * SECONDS_PER_DAY)}`],
        label: "aged dependency drift report",
      },
    ]);
  });
});
