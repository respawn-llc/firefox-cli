import { access, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDefault = fileURLToPath(new URL("..", import.meta.url));
const dependencySections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const ignoredDirectories = new Set([".builder", ".git", "coverage", "dist", "gen", "node_modules", "target"]);
const forbiddenLockfiles = ["package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock"];

export async function checkDependencyPolicy(root = rootDefault) {
  const policy = JSON.parse(await readFile(join(root, "dependency-policy.json"), "utf8"));
  const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const errors = [];
  const rootVersion = typeof rootPackage.version === "string" ? rootPackage.version : undefined;

  if (policy.packageManager !== "bun") errors.push("dependency-policy.json must set packageManager to bun.");
  if (rootVersion === undefined || rootVersion.length === 0) {
    errors.push("Root package.json must declare a non-empty version.");
  }
  if (typeof rootPackage.packageManager !== "string" || !rootPackage.packageManager.startsWith("bun@")) {
    errors.push("Root package.json must declare packageManager as bun@<version>.");
  }
  if (!(await exists(join(root, "bun.lock"))))
    errors.push("bun.lock must be present as the single reviewed dependency lockfile.");

  for (const lockfile of forbiddenLockfiles) {
    if (await exists(join(root, lockfile)))
      errors.push(`${lockfile} is not allowed; this workspace is pinned to Bun.`);
  }

  const packages = new Map();
  const trustedAllowlist = new Set(policy.trustedDependenciesAllowlist ?? []);
  for (const packagePath of await packageJsonFiles(root)) {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    if (typeof packageJson.name !== "string" || packageJson.name.length === 0) {
      errors.push(`${relative(root, packagePath)} is missing package name.`);
      continue;
    }

    packages.set(packageJson.name, packagePath);
    if (
      rootVersion !== undefined &&
      packagePath !== join(root, "package.json") &&
      packageJson.version !== rootVersion
    ) {
      errors.push(
        `${relative(root, packagePath)} version must match root package.json version ${rootVersion}.`,
      );
    }

    for (const dependency of packageJson.trustedDependencies ?? []) {
      if (!trustedAllowlist.has(dependency)) {
        errors.push(`${packageJson.name} trustedDependencies contains unreviewed dependency ${dependency}.`);
      }
    }

    const allowed = policy.directDependencyAllowlist?.[packageJson.name];
    if (allowed === undefined) {
      errors.push(`${packageJson.name} has no direct dependency allowlist in dependency-policy.json.`);
      continue;
    }

    for (const section of dependencySections) {
      const actual = Object.keys(packageJson[section] ?? {}).sort();
      const listed = [...(allowed[section] ?? [])].sort();
      for (const dependency of actual) {
        if (!listed.includes(dependency))
          errors.push(`${packageJson.name} ${section} contains unreviewed dependency ${dependency}.`);
      }
      for (const dependency of listed) {
        if (!actual.includes(dependency))
          errors.push(`${packageJson.name} policy allowlists absent ${section} dependency ${dependency}.`);
      }
    }
  }

  for (const packageName of Object.keys(policy.directDependencyAllowlist ?? {}).sort()) {
    if (!packages.has(packageName))
      errors.push(
        `dependency-policy.json contains package ${packageName}, but no matching package.json exists.`,
      );
  }

  return errors;
}

async function packageJsonFiles(root) {
  const output = [];
  await visit(root);
  return output.sort();
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(path);
      } else if (entry.isFile() && entry.name === "package.json") {
        output.push(path);
      }
    }
  }
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = await checkDependencyPolicy();
  if (errors.length > 0) {
    console.error("Dependency policy failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
}
