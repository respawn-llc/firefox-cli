import { lstat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import { resolvePackagedBinary, type PlatformInput } from "@firefox-cli/native-host";
import { parseJsonManifestContent, packageManifestSchema } from "./manifest-validation.js";
import { readRegularFileUnder } from "./safe-extension-files.js";
import { packagedSignedExtensionXpiFile } from "./signed-extension-policy.js";

export interface PackageCheckOptions {
  readonly packageRoot: string;
  readonly platform?: PlatformInput;
  readonly requireSignedXpi?: boolean;
}

export async function verifyPackageLayout(options: PackageCheckOptions): Promise<readonly string[]> {
  const artifacts = ["package.json", "README.md", "LICENSE", "bin/firefox-cli.js", "lib/platform-binary.js"];

  await Promise.all(artifacts.map(async (artifact) => readRegularFileUnder(options.packageRoot, artifact, artifact)));
  await verifyPackageJson(options.packageRoot);
  const binaryPath = await resolvePackagedBinary(options.packageRoot, options.platform);
  await readRegularFileUnder(options.packageRoot, relative(options.packageRoot, binaryPath), "platform binary");
  await verifyAbsentPackagePath(options.packageRoot, "extension", "Package must not contain embedded extension artifacts under extension/");
  await verifyAbsentPackagePath(options.packageRoot, "docs/firefox-cli/updates.json", "Package must not contain a copied extension update manifest");
  if (options.requireSignedXpi) {
    throw new Error(`Signed extension XPIs are downloadable release artifacts and must not be packaged at extension/${packagedSignedExtensionXpiFile}`);
  }

  return artifacts;
}

async function verifyAbsentPackagePath(packageRoot: string, relativePath: string, message: string): Promise<void> {
  const extensionPath = resolve(packageRoot, relativePath);
  try {
    await lstat(extensionPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  throw new Error(message);
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function verifyPackageJson(packageRoot: string): Promise<void> {
  const packageJson = parseJsonManifestContent(
    (await readRegularFileUnder(packageRoot, "package.json", "package manifest")).toString("utf8"),
    "package manifest",
    resolve(packageRoot, "package.json"),
    packageManifestSchema,
  );

  if (packageJson.name !== "firefox-cli") {
    throw new Error(`Expected package name firefox-cli, received ${packageJson.name}`);
  }
  if (packageJson.version !== rootPackage.version) {
    throw new Error(`Expected package version ${rootPackage.version}, received ${packageJson.version}`);
  }
  if (packageJson.bin?.["firefox-cli"] !== "bin/firefox-cli.js") {
    throw new Error("Expected firefox-cli bin to point at bin/firefox-cli.js");
  }
}

if (import.meta.main) {
  verifyPackageLayout({ packageRoot: resolve("dist/package") })
    .then(() => {
      console.log("Package layout check passed.");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
