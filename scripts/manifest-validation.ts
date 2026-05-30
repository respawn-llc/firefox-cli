import { readFile } from "node:fs/promises";
import { z } from "zod";

export const packageManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    bin: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
export type PackageManifest = z.infer<typeof packageManifestSchema>;

export const extensionManifestSchema = z
  .object({
    manifest_version: z.literal(3),
    name: z.string().min(1),
    version: z.string().min(1),
    background: z
      .object({
        scripts: z.array(z.string().min(1)).min(1),
      })
      .passthrough(),
    permissions: z.array(z.string().min(1)),
    host_permissions: z.array(z.string().min(1)).optional(),
    action: z
      .object({
        default_popup: z.string().min(1).optional(),
        default_title: z.string().min(1).optional(),
      })
      .passthrough(),
    browser_specific_settings: z
      .object({
        gecko: z
          .object({
            id: z.string().min(1),
            strict_min_version: z.string().min(1).optional(),
            data_collection_permissions: z
              .object({
                required: z.array(z.string().min(1)),
                optional: z.array(z.string().min(1)).optional(),
              })
              .optional(),
          })
          .passthrough(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

export function parseJsonWithSchema<T>(
  content: string,
  label: string,
  location: string,
  schema: z.ZodType<T>,
): T {
  let raw: unknown;
  try {
    raw = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid ${label} JSON at ${location}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid ${label} at ${location}: ${parsed.error.issues.map(formatIssue).join("; ")}`,
    );
  }

  return parsed.data;
}

export async function runCliJson<T>(
  run: () => Promise<{ readonly stdout: string }>,
  label: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const result = await run();
  return parseJsonWithSchema(result.stdout, label, `${label} stdout`, schema);
}

export function parseJsonManifestContent<T>(
  content: string,
  label: string,
  location: string,
  schema: z.ZodType<T>,
): T {
  return parseJsonWithSchema(content, label, location, schema);
}

export async function readJsonManifestFile<T>(
  filePath: string,
  label: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const content = await readFile(filePath, "utf8");
  return parseJsonManifestContent(content, label, filePath, schema);
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
  return `${path}: ${issue.message}`;
}
