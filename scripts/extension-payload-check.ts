import { resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import { listRegularFilesUnder, readRegularFileUnder } from "./safe-extension-files.js";

export async function verifyExtensionBundlePayload(payload: ReadonlyMap<string, Buffer>): Promise<void> {
  const requiredFiles = [
    "manifest.json",
    "background.js",
    "content.js",
    "popup.js",
    "popup.html",
    "popup.css",
  ] as const;
  for (const artifact of requiredFiles) {
    if (!payload.has(artifact)) {
      throw new Error(`Expected extension artifact: ${artifact}`);
    }
  }

  const unexpectedJs = [...payload.keys()]
    .filter((file) => file.endsWith(".js"))
    .filter((file) => !["background.js", "content.js", "popup.js"].includes(file));
  if (unexpectedJs.length > 0) {
    throw new Error(`Unexpected extension JavaScript artifacts: ${unexpectedJs.join(", ")}`);
  }

  await Promise.all(
    ["background.js", "content.js", "popup.js"].map(async (artifact) => {
      const source = payload.get(artifact)?.toString("utf8") ?? "";
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

export async function verifyPayloadMatchesDevelopmentBundle(
  packageRoot: string,
  xpiPayload: ReadonlyMap<string, Buffer>,
): Promise<void> {
  const developmentPayload = await readDevelopmentExtensionPayload(packageRoot);
  const developmentFiles = [...developmentPayload.keys()].sort();
  const xpiFiles = [...xpiPayload.keys()].sort();
  const missingFiles = developmentFiles.filter((file) => !xpiPayload.has(file));
  const unexpectedFiles = xpiFiles.filter((file) => !developmentPayload.has(file));

  if (missingFiles.length > 0) {
    throw new Error(`Signed extension XPI is missing package files: ${missingFiles.join(", ")}`);
  }
  if (unexpectedFiles.length > 0) {
    throw new Error(
      `Signed extension XPI contains files outside the package payload: ${unexpectedFiles.join(", ")}`,
    );
  }

  for (const [file, expected] of developmentPayload) {
    const actual = xpiPayload.get(file);
    if (actual === undefined || !actual.equals(expected)) {
      throw new Error(`Signed extension XPI payload differs from package file: ${file}`);
    }
  }
}

export async function readDevelopmentExtensionPayload(
  packageRoot: string,
): Promise<ReadonlyMap<string, Buffer>> {
  const extensionRoot = resolve(packageRoot, "extension/development");
  const packageOnlyFiles = new Set(["README.md", `firefox-cli-${rootPackage.version}.zip`]);
  const files = (await listRegularFilesUnder(extensionRoot, "development extension payload")).filter(
    (file) => !packageOnlyFiles.has(file.relativePath),
  );
  const payload = await Promise.all(
    files.map(
      async (file) =>
        [
          file.relativePath,
          await readRegularFileUnder(extensionRoot, file.relativePath, "development extension payload"),
        ] as const,
    ),
  );
  return new Map(payload);
}
