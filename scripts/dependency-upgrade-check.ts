import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { runProcess, type ProcessRunnerOptions } from "./process-runner.js";

export type DependencyUpgradeKind = "none" | "patch" | "minor" | "major" | "unknown";

export interface DependencyUpgradePolicy {
  readonly patchMinorReleaseAgeDays: number;
  readonly majorReleaseAgeDays: number;
  readonly auditCommand: readonly string[];
  readonly agedOutdatedCommand: readonly string[];
  readonly upgradeVerificationCommands: readonly (readonly string[])[];
  readonly localUnsignedReleaseVerificationCommand: readonly string[];
}

export const SECONDS_PER_DAY = 24 * 60 * 60;
export const PATCH_MINOR_RELEASE_AGE_DAYS = 7;
export const MAJOR_RELEASE_AGE_DAYS = 30;

export const dependencyUpgradePolicy: DependencyUpgradePolicy = {
  patchMinorReleaseAgeDays: PATCH_MINOR_RELEASE_AGE_DAYS,
  majorReleaseAgeDays: MAJOR_RELEASE_AGE_DAYS,
  auditCommand: ["bun", "audit"],
  agedOutdatedCommand: ["bun", "outdated", `--minimum-release-age=${String(PATCH_MINOR_RELEASE_AGE_DAYS * SECONDS_PER_DAY)}`],
  upgradeVerificationCommands: [
    ["bun", "run", "check"],
    ["bun", "run", "release:check"],
  ],
  localUnsignedReleaseVerificationCommand: ["bun", "run", "release:check:local"],
};

export interface DependencyUpgradeCheckOptions {
  readonly runCommand?: DependencyUpgradeCommandRunner;
  readonly write?: (message: string) => void;
}

export type DependencyUpgradeCommandRunner = (command: string, args: readonly string[], options: ProcessRunnerOptions) => Promise<unknown>;

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function classifyVersionChange(current: string, target: string): DependencyUpgradeKind {
  const currentVersion = parseVersion(current);
  const targetVersion = parseVersion(target);
  if (currentVersion === undefined || targetVersion === undefined) {
    return "unknown";
  }

  if (targetVersion.major > currentVersion.major) {
    return "major";
  }
  if (targetVersion.major < currentVersion.major) {
    return "none";
  }
  if (targetVersion.minor > currentVersion.minor) {
    return "minor";
  }
  if (targetVersion.minor < currentVersion.minor) {
    return "none";
  }
  if (targetVersion.patch > currentVersion.patch) {
    return "patch";
  }
  return "none";
}

export function minimumReleaseAgeDaysFor(kind: DependencyUpgradeKind): number {
  if (kind === "major" || kind === "unknown") {
    return MAJOR_RELEASE_AGE_DAYS;
  }
  if (kind === "patch" || kind === "minor") {
    return PATCH_MINOR_RELEASE_AGE_DAYS;
  }
  return 0;
}

export function renderDependencyUpgradePolicy(policy: DependencyUpgradePolicy = dependencyUpgradePolicy): string {
  return [
    "Dependency upgrade lane:",
    `- security fixes: eligible immediately when backed by audit/advisory evidence; run ${renderCommand(requiredCommand(policy.upgradeVerificationCommands, 0))} and ${renderCommand(requiredCommand(policy.upgradeVerificationCommands, 1))}`,
    `- patch/minor upgrades: minimum release age ${String(policy.patchMinorReleaseAgeDays)} days; use the aged outdated report as the safe lane`,
    `- major migrations: minimum release age ${String(policy.majorReleaseAgeDays)} days plus an explicit migration plan`,
    `- local unsigned release verification: ${renderCommand(policy.localUnsignedReleaseVerificationCommand)}`,
  ].join("\n");
}

export async function runDependencyUpgradeCheck(options: DependencyUpgradeCheckOptions = {}): Promise<void> {
  const runCommand = options.runCommand ?? runDependencyCommand;
  const write = options.write ?? console.log;

  write(renderDependencyUpgradePolicy());
  await runCommand(dependencyUpgradePolicy.auditCommand[0] ?? "", dependencyUpgradePolicy.auditCommand.slice(1), {
    label: "dependency audit",
    stdout: "inherit",
    stderr: "inherit",
    timeoutMs: 120_000,
  });
  await runCommand(dependencyUpgradePolicy.agedOutdatedCommand[0] ?? "", dependencyUpgradePolicy.agedOutdatedCommand.slice(1), {
    label: "aged dependency drift report",
    stdout: "inherit",
    stderr: "inherit",
    timeoutMs: 120_000,
  });
  write("Dependency upgrade lane check passed.");
}

function parseVersion(value: string): ParsedVersion | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (match === null) {
    return undefined;
  }

  const [, major, minor, patch] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
}

function renderCommand(command: readonly string[]): string {
  return command.join(" ");
}

function requiredCommand(commands: readonly (readonly string[])[], index: number): readonly string[] {
  const command = commands[index];
  if (command === undefined) {
    throw new Error(`Dependency upgrade policy is missing command ${String(index)}.`);
  }
  return command;
}

async function runDependencyCommand(command: string, args: readonly string[], options: ProcessRunnerOptions): Promise<unknown> {
  return runProcess(command, args, options);
}

function isMain(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === moduleUrl;
}

if (isMain(import.meta.url, process.argv[1])) {
  await runDependencyUpgradeCheck();
}
