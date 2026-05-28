import { access, readFile, readdir } from "node:fs/promises";
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
      readonly background?: { readonly scripts?: readonly string[] };
      readonly permissions?: readonly string[];
      readonly action?: { readonly default_popup?: string };
    };
    if (manifest.version !== rootPackage.version) {
      throw new Error(
        `Expected extension version ${rootPackage.version}, received ${manifest.version ?? "<missing>"}`,
      );
    }
    await verifyDevelopmentExtensionBundle(options.packageRoot, manifest);
  }
}

async function verifyDevelopmentExtensionBundle(
  packageRoot: string,
  manifest: {
    readonly background?: { readonly scripts?: readonly string[] };
    readonly permissions?: readonly string[];
    readonly action?: { readonly default_popup?: string };
  },
): Promise<void> {
  const extensionRoot = resolve(packageRoot, "extension/development");
  const requiredFiles = ["background.js", "content.js", "popup.js", "popup.html"] as const;
  await Promise.all(requiredFiles.map((artifact) => access(resolve(extensionRoot, artifact))));

  if (manifest.background?.scripts?.join(",") !== "background.js") {
    throw new Error("Expected extension background script to be background.js");
  }
  if (manifest.permissions?.includes("scripting") !== true) {
    throw new Error("Expected extension to request scripting permission for content.js injection");
  }
  if (manifest.action?.default_popup !== "popup.html") {
    throw new Error("Expected extension popup to be popup.html");
  }

  const unexpectedJs = (await listRelativeFiles(extensionRoot))
    .filter((file) => file.endsWith(".js"))
    .filter((file) => !["background.js", "content.js", "popup.js"].includes(file));
  if (unexpectedJs.length > 0) {
    throw new Error(`Unexpected extension JavaScript artifacts: ${unexpectedJs.join(", ")}`);
  }

  await Promise.all(
    ["background.js", "content.js", "popup.js"].map(async (artifact) => {
      const source = await readFile(resolve(extensionRoot, artifact), "utf8");
      if (
        source.includes('from"./') ||
        source.includes('from "./') ||
        source.includes('import"./') ||
        source.includes('import "./') ||
        source.includes("import(")
      ) {
        throw new Error(`Expected standalone extension script without chunk imports: ${artifact}`);
      }
    }),
  );
}

async function listRelativeFiles(root: string, prefix = ""): Promise<readonly string[]> {
  const entries = await readdir(resolve(root, prefix), { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? listRelativeFiles(root, relativePath) : [relativePath];
    }),
  );

  return files.flat();
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
