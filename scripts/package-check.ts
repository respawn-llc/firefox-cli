import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import { resolvePackagedBinary, type PlatformInput } from "@firefox-cli/native-host";

export type PackageCheckOptions = {
  readonly packageRoot: string;
  readonly platform?: PlatformInput;
  readonly requireSignedXpi?: boolean;
};

export async function verifyPackageLayout(
  options: PackageCheckOptions,
): Promise<readonly string[]> {
  const artifacts = [
    "package.json",
    "README.md",
    "LICENSE",
    "bin/firefox-cli.js",
    "lib/platform-binary.js",
  ];

  await Promise.all(artifacts.map((artifact) => access(resolve(options.packageRoot, artifact))));
  await verifyPackageJson(options.packageRoot);
  await resolvePackagedBinary(options.packageRoot, options.platform);
  await verifyExtensionArtifact(options);

  return artifacts;
}

async function verifyPackageJson(packageRoot: string): Promise<void> {
  const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    bin?: Record<string, string>;
  };

  if (packageJson.name !== "firefox-cli") {
    throw new Error(
      `Expected package name firefox-cli, received ${packageJson.name ?? "<missing>"}`,
    );
  }
  if (packageJson.version !== rootPackage.version) {
    throw new Error(
      `Expected package version ${rootPackage.version}, received ${packageJson.version}`,
    );
  }
  if (packageJson.bin?.["firefox-cli"] !== "./bin/firefox-cli.js") {
    throw new Error("Expected firefox-cli bin to point at ./bin/firefox-cli.js");
  }
}

async function verifyExtensionArtifact(options: PackageCheckOptions): Promise<void> {
  const signedXpiPath = resolve(options.packageRoot, "extension/firefox-cli.xpi");

  if (options.requireSignedXpi) {
    await access(signedXpiPath);
    return;
  }

  try {
    await access(signedXpiPath);
    return;
  } catch {
    const manifestPath = resolve(options.packageRoot, "extension/development/manifest.json");
    await access(manifestPath);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      readonly version?: string;
    };
    if (manifest.version !== rootPackage.version) {
      throw new Error(
        `Expected extension version ${rootPackage.version}, received ${manifest.version ?? "<missing>"}`,
      );
    }
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
