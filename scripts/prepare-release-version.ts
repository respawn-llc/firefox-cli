import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "./process-runner.js";
import { syncVersion } from "./sync-version.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export interface PreparedReleaseVersion {
  readonly previousVersion: string;
  readonly version: string;
  readonly tag: string;
  readonly changedFiles: readonly string[];
}

export async function prepareReleaseVersion(
  options: { readonly root?: string; readonly targetVersion?: string; readonly unavailableTags?: readonly string[]; readonly tagPrefix?: string } = {},
): Promise<PreparedReleaseVersion> {
  const root = options.root ?? repoRoot;
  const tagPrefix = options.tagPrefix ?? "v";
  const rootPackagePath = join(root, "package.json");
  const rootPackage = await readPackageJson(rootPackagePath);
  const previousVersion = readPackageVersion(rootPackage, rootPackagePath);
  const requestedVersion = options.targetVersion ?? previousVersion;
  const unavailableTags = options.unavailableTags ?? (await gitTags(root));
  const version = selectReleaseVersion(requestedVersion, unavailableTags, tagPrefix);
  const changedFiles = [];

  if (version !== previousVersion) {
    rootPackage.version = version;
    await writeFile(rootPackagePath, `${JSON.stringify(rootPackage, null, 2)}\n`);
    changedFiles.push("package.json");
  }

  changedFiles.push(...(await syncVersion({ root })));
  return {
    previousVersion,
    version,
    tag: `${tagPrefix}${version}`,
    changedFiles: [...new Set(changedFiles)],
  };
}

export function selectReleaseVersion(requestedVersion: string, unavailableTags: readonly string[], tagPrefix = "v"): string {
  let candidate = parsePatchVersion(requestedVersion);
  const unavailable = new Set(unavailableTags);

  while (unavailable.has(`${tagPrefix}${formatPatchVersion(candidate)}`)) {
    candidate = { ...candidate, patch: candidate.patch + 1 };
  }

  return formatPatchVersion(candidate);
}

function parsePatchVersion(version: string): {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
} {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) {
    throw new Error(`Expected release version to use x.y.z format: ${version}`);
  }

  const [, major, minor, patch] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
}

function formatPatchVersion(version: { readonly major: number; readonly minor: number; readonly patch: number }): string {
  return `${String(version.major)}.${String(version.minor)}.${String(version.patch)}`;
}

async function readPackageJson(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

function readPackageVersion(packageJson: Record<string, unknown>, path: string): string {
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error(`${path} must declare a non-empty version.`);
  }
  return packageJson.version;
}

async function gitTags(root: string): Promise<readonly string[]> {
  const result = await runProcess("git", ["tag", "--list"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.stdout
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function parseTargetVersionArg(argv: readonly string[]): string | undefined {
  const versionIndex = argv.indexOf("--version");
  if (versionIndex === -1) return undefined;
  const version = argv[versionIndex + 1];
  if (version === undefined || version.startsWith("--")) {
    throw new Error("--version requires a value.");
  }
  return version;
}

if (import.meta.main) {
  const targetVersion = parseTargetVersionArg(process.argv.slice(2));
  const result = await prepareReleaseVersion(targetVersion === undefined ? {} : { targetVersion });
  const output = JSON.stringify(result, null, 2);
  console.log(output);

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput !== undefined && githubOutput.length > 0) {
    await writeFile(
      githubOutput,
      `${[
        `version=${result.version}`,
        `tag=${result.tag}`,
        `changed=${result.changedFiles.length > 0 ? "true" : "false"}`,
        `changed_files=${result.changedFiles.join(" ")}`,
      ].join("\n")}\n`,
      { flag: "a" },
    );
  }
}
