import { cp, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import { signedExtensionProvenanceArtifactName, writeSignedExtensionProvenance } from "./extension-artifact-provenance.js";
import { verifyExpectedExtensionManifest } from "./extension-manifest-check.js";
import { extensionManifestSchema, readJsonManifestFile } from "./manifest-validation.js";
import { runProcess } from "./process-runner.js";

const jwtIssuer = requireEnv("WEB_EXT_JWT_ISSUER");
const jwtSecret = requireEnv("WEB_EXT_JWT_SECRET");
const channel = process.env.FIREFOX_CLI_AMO_CHANNEL ?? "unlisted";

if (channel !== "listed" && channel !== "unlisted") {
  throw new Error("FIREFOX_CLI_AMO_CHANNEL must be listed or unlisted.");
}

const sourceDir = resolve("dist/extension");
const artifactDir = resolve("dist/extension-artifacts");
const signingDir = await mkdtemp(join(tmpdir(), "firefox-cli-sign-extension-"));
const webExtBinary = resolve("node_modules/.bin", process.platform === "win32" ? "web-ext.cmd" : "web-ext");

await mkdir(artifactDir, { recursive: true });
await verifyBuiltExtensionManifest();

await runWebExtSign();

const signedArtifacts = (await readdir(signingDir)).filter((file) => file.endsWith(".xpi")).sort();

if (signedArtifacts.length === 0) {
  throw new Error("web-ext sign completed without producing an XPI artifact.");
}

const signedArtifact = signedArtifacts[signedArtifacts.length - 1];
if (signedArtifact === undefined) {
  throw new Error("web-ext sign produced an invalid artifact list.");
}

const outputPath = resolve(artifactDir, `firefox-cli-${rootPackage.version}.xpi`);
await cp(resolve(signingDir, signedArtifact), outputPath);
await writeSignedExtensionProvenance({
  outputPath: resolve(artifactDir, signedExtensionProvenanceArtifactName(rootPackage.version)),
  packageVersion: rootPackage.version,
  channel,
  sourceDir,
  xpiPath: outputPath,
});

console.log(`Signed extension XPI: ${outputPath}`);

function requireEnv(name: "WEB_EXT_JWT_ISSUER" | "WEB_EXT_JWT_SECRET"): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${name} for extension signing.`);
  }
  return value;
}

async function runWebExtSign(): Promise<void> {
  const args = [
    "sign",
    "--source-dir",
    sourceDir,
    "--artifacts-dir",
    signingDir,
    "--channel",
    channel,
    "--api-key",
    jwtIssuer,
    "--api-secret",
    jwtSecret,
    "--no-input",
  ];

  await runProcess(webExtBinary, args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    timeoutMs: 10 * 60_000,
    label: "web-ext sign",
    redactArgValues: [jwtIssuer, jwtSecret],
  });
}

async function verifyBuiltExtensionManifest(): Promise<void> {
  const manifestPath = resolve(sourceDir, "manifest.json");
  verifyExpectedExtensionManifest(await readJsonManifestFile(manifestPath, "built extension manifest", extensionManifestSchema));
}
