import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const packageManifestPaths = [
  "packages/cli/package.json",
  "packages/extension/package.json",
  "packages/native-host/package.json",
  "packages/protocol/package.json",
  "packages/test-support/package.json",
];
const extensionManifestPath = "packages/extension/src/manifest.json";
const lockfileWorkspacePaths = ["packages/cli", "packages/extension", "packages/native-host", "packages/protocol", "packages/test-support"];

export type SyncVersionOptions = {
  readonly root?: string;
  readonly check?: boolean;
};

export async function syncVersion(options: SyncVersionOptions = {}): Promise<readonly string[]> {
  const root = options.root ?? repoRoot;
  const version = await readRootVersion(root);
  const changes = [
    ...(await syncJsonManifestVersions(root, version, options.check ?? false)),
    ...(await syncBunLockWorkspaceVersions(root, version, options.check ?? false)),
  ];
  return changes;
}

async function readRootVersion(root: string): Promise<string> {
  const rootPackage = await readJsonFile(join(root, "package.json"));
  if (typeof rootPackage.version !== "string" || rootPackage.version.length === 0) {
    throw new Error("Root package.json must declare a non-empty version.");
  }
  return rootPackage.version;
}

async function syncJsonManifestVersions(root: string, version: string, check: boolean): Promise<readonly string[]> {
  const changes = [];
  for (const path of [...packageManifestPaths, extensionManifestPath]) {
    const absolutePath = join(root, path);
    const manifest = await readJsonFile(absolutePath);
    if (manifest.version === version) continue;
    changes.push(path);
    if (!check) {
      manifest.version = version;
      await writeFile(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  return changes;
}

async function syncBunLockWorkspaceVersions(root: string, version: string, check: boolean): Promise<readonly string[]> {
  const lockfilePath = join(root, "bun.lock");
  const source = await readFile(lockfilePath, "utf8");
  const update = updateBunLockWorkspaceVersions(source, version);
  const path = relative(root, lockfilePath);

  if (update.missingWorkspaces.length > 0) {
    throw new Error(`bun.lock is missing workspace entries: ${update.missingWorkspaces.join(", ")}`);
  }

  if (update.output === source) return [];
  if (!check) {
    await writeFile(lockfilePath, update.output);
  }
  return [path];
}

export function updateBunLockWorkspaceVersions(
  source: string,
  version: string,
): {
  readonly output: string;
  readonly missingWorkspaces: readonly string[];
} {
  const lines = source.split(/(?<=\n)/);
  const remaining = new Set(lockfileWorkspacePaths);
  let currentWorkspace: string | undefined;
  const output = lines.map((line) => {
    const workspaceMatch = /^    "([^"]+)": \{\n?$/.exec(line);
    if (workspaceMatch !== null) {
      currentWorkspace = workspaceMatch[1];
      return line;
    }

    if (currentWorkspace !== undefined && /^    \},\n?$/.test(line)) {
      currentWorkspace = undefined;
      return line;
    }

    if (currentWorkspace !== undefined && remaining.has(currentWorkspace) && /^      "version": "[^"]+",\n?$/.test(line)) {
      remaining.delete(currentWorkspace);
      const newline = line.endsWith("\n") ? "\n" : "";
      return `      "version": "${version}",${newline}`;
    }

    return line;
  });

  return {
    output: output.join(""),
    missingWorkspaces: [...remaining].sort(),
  };
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const changes = await syncVersion({ check });
  if (changes.length > 0) {
    console.error(check ? `Version files are out of sync with root package.json: ${changes.join(", ")}` : `Synced version files: ${changes.join(", ")}`);
    process.exit(check ? 1 : 0);
  }
  console.log("Version files are in sync with root package.json.");
}
