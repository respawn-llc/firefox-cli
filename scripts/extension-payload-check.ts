import { resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import { listRegularFilesUnder, readRegularFileUnder } from "./safe-extension-files.js";

export async function verifyExtensionBundlePayload(payload: ReadonlyMap<string, Buffer>): Promise<void> {
  const requiredFiles = ["manifest.json", "background.js", "content.js", "popup.js", "popup.html", "popup.css"] as const;
  for (const artifact of requiredFiles) {
    if (!payload.has(artifact)) {
      throw new Error(`Expected extension artifact: ${artifact}`);
    }
  }

  const unexpectedJs = [...payload.keys()].filter((file) => file.endsWith(".js")).filter((file) => !["background.js", "content.js", "popup.js"].includes(file));
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

export async function verifyPayloadMatchesDevelopmentBundle(packageRoot: string, xpiPayload: ReadonlyMap<string, Buffer>): Promise<void> {
  const developmentPayload = await readDevelopmentExtensionPayload(packageRoot);
  verifyPayloadMatchesExpectedPayload(developmentPayload, xpiPayload, "package file");
}

export async function verifyPayloadMatchesExtensionSource(sourceDir: string, xpiPayload: ReadonlyMap<string, Buffer>): Promise<void> {
  const sourcePayload = await readExtensionPayload(sourceDir, "extension source payload");
  verifyPayloadMatchesExpectedPayload(sourcePayload, xpiPayload, "source file");
}

function verifyPayloadMatchesExpectedPayload(expectedPayload: ReadonlyMap<string, Buffer>, xpiPayload: ReadonlyMap<string, Buffer>, label: string): void {
  const expectedFiles = [...expectedPayload.keys()].sort();
  const xpiFiles = [...xpiPayload.keys()].sort();
  const missingFiles = expectedFiles.filter((file) => !xpiPayload.has(file));
  const unexpectedFiles = xpiFiles.filter((file) => !expectedPayload.has(file));

  if (missingFiles.length > 0) {
    throw new Error(`Signed extension XPI is missing ${label}s: ${missingFiles.join(", ")}`);
  }
  if (unexpectedFiles.length > 0) {
    throw new Error(`Signed extension XPI contains files outside the expected payload: ${unexpectedFiles.join(", ")}`);
  }

  for (const [file, expected] of expectedPayload) {
    const actual = xpiPayload.get(file);
    if (!actual?.equals(expected)) {
      throw new Error(`Signed extension XPI payload differs from ${label}: ${file}`);
    }
  }
}

export async function readDevelopmentExtensionPayload(packageRoot: string): Promise<ReadonlyMap<string, Buffer>> {
  const extensionRoot = resolve(packageRoot, "extension/development");
  return readExtensionPayload(extensionRoot, "development extension payload");
}

async function readExtensionPayload(extensionRoot: string, label: string): Promise<ReadonlyMap<string, Buffer>> {
  const packageOnlyFiles = new Set(["README.md", `firefox-cli-${rootPackage.version}.zip`]);
  const files = (await listRegularFilesUnder(extensionRoot, label)).filter((file) => !packageOnlyFiles.has(file.relativePath));
  const payload = await Promise.all(
    files.map(async (file) => [file.relativePath, await readRegularFileUnder(extensionRoot, file.relativePath, label)] as const),
  );
  return new Map(payload);
}
