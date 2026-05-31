import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { parseJsonWithSchema } from "./manifest-validation.js";
import {
  listRegularFilesUnder,
  readRegularFile,
  readRegularFileUnder,
} from "./safe-extension-files.js";

export const packagedSignedExtensionProvenanceFile = "firefox-cli.xpi.provenance.json";

export const signedExtensionProvenanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    packageVersion: z.string().min(1),
    channel: z.enum(["listed", "unlisted"]),
    sourceDir: z.string().min(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    xpiFile: z.string().min(1),
    xpiSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: z.string().min(1),
  })
  .strict();
export type SignedExtensionProvenance = z.infer<typeof signedExtensionProvenanceSchema>;

export function signedExtensionProvenanceArtifactName(version: string): string {
  return `firefox-cli-${version}.xpi.provenance.json`;
}

export async function writeSignedExtensionProvenance(input: {
  readonly outputPath: string;
  readonly packageVersion: string;
  readonly channel: "listed" | "unlisted";
  readonly sourceDir: string;
  readonly xpiPath: string;
  readonly createdAt?: string;
}): Promise<SignedExtensionProvenance> {
  const provenance: SignedExtensionProvenance = {
    schemaVersion: 1,
    packageVersion: input.packageVersion,
    channel: input.channel,
    sourceDir: resolve(input.sourceDir),
    sourceSha256: await hashDirectoryPayload(input.sourceDir),
    xpiFile: basename(input.xpiPath),
    xpiSha256: await hashFile(input.xpiPath),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  await writeFile(input.outputPath, `${JSON.stringify(provenance, null, 2)}\n`);
  return provenance;
}

export async function readSignedExtensionProvenance(
  path: string,
): Promise<SignedExtensionProvenance> {
  return parseSignedExtensionProvenance(
    (await readRegularFile(path, "signed extension provenance")).toString("utf8"),
    path,
  );
}

export function parseSignedExtensionProvenance(
  content: string,
  location: string,
): SignedExtensionProvenance {
  return parseJsonWithSchema(
    content,
    "signed extension provenance",
    location,
    signedExtensionProvenanceSchema,
  );
}

export async function hashFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readRegularFile(path, "extension artifact"))
    .digest("hex");
}

export async function hashDirectoryPayload(root: string): Promise<string> {
  const files = await listRegularFilesUnder(root, "extension source payload");
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(await readRegularFileUnder(root, file.relativePath, "extension source payload"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function hashPayloadMap(payload: ReadonlyMap<string, Buffer>): string {
  const hash = createHash("sha256");
  for (const [file, data] of [...payload.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    hash.update(file);
    hash.update("\0");
    hash.update(data);
    hash.update("\0");
  }
  return hash.digest("hex");
}
