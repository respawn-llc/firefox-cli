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
          })
          .passthrough(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

export async function readJsonManifestFile<T>(
  filePath: string,
  label: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const content = await readFile(filePath, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid ${label} JSON at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid ${label} at ${filePath}: ${parsed.error.issues.map(formatIssue).join("; ")}`,
    );
  }

  return parsed.data;
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
  return `${path}: ${issue.message}`;
}
