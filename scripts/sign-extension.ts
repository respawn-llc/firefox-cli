import { cp, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runProcess } from "./process-runner.js";
import rootPackage from "../package.json" with { type: "json" };
import { signedExtensionProvenanceArtifactName, writeSignedExtensionProvenance } from "./extension-artifact-provenance.js";

const apiKey = process.env.WEB_EXT_API_KEY ?? process.env.AMO_JWT_ISSUER;
const apiSecret = process.env.WEB_EXT_API_SECRET ?? process.env.AMO_JWT_SECRET;
const channel = process.env.FIREFOX_CLI_AMO_CHANNEL ?? "unlisted";

if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("Missing WEB_EXT_API_KEY or AMO_JWT_ISSUER for extension signing.");
}
if (apiSecret === undefined || apiSecret.length === 0) {
  throw new Error("Missing WEB_EXT_API_SECRET or AMO_JWT_SECRET for extension signing.");
}
if (channel !== "listed" && channel !== "unlisted") {
  throw new Error("FIREFOX_CLI_AMO_CHANNEL must be listed or unlisted.");
}

const sourceDir = resolve("dist/extension");
const artifactDir = resolve("dist/extension-artifacts");
const signingDir = await mkdtemp(join(tmpdir(), "firefox-cli-sign-extension-"));
const webExtBinary = resolve("node_modules/.bin", process.platform === "win32" ? "web-ext.cmd" : "web-ext");

await mkdir(artifactDir, { recursive: true });

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
    apiKey ?? "",
    "--api-secret",
    apiSecret ?? "",
    "--no-input",
  ];

  await runProcess(webExtBinary, args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    timeoutMs: 10 * 60_000,
    label: "web-ext sign",
    redactArgValues: [apiKey ?? "", apiSecret ?? ""],
  });
}
