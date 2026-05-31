import type { z } from "zod";

export type PersistedJsonErrorKind = "invalid-json" | "invalid-shape";

export class PersistedJsonFileError extends Error {
  readonly kind: PersistedJsonErrorKind;
  readonly filePath: string;
  readonly label: string;
  readonly reason: string;

  constructor(options: {
    readonly kind: PersistedJsonErrorKind;
    readonly filePath: string;
    readonly label: string;
    readonly reason: string;
  }) {
    super(`${options.label} ${options.kind === "invalid-json" ? "is not valid JSON" : "has invalid shape"}: ${options.reason}`);
    this.name = "PersistedJsonFileError";
    this.kind = options.kind;
    this.filePath = options.filePath;
    this.label = options.label;
    this.reason = options.reason;
  }
}

export function isPersistedJsonFileError(error: unknown): error is PersistedJsonFileError {
  return error instanceof PersistedJsonFileError;
}

export function parsePersistedJson<T>(
  content: string,
  schema: z.ZodType<T>,
  options: {
    readonly filePath: string;
    readonly label: string;
  },
): T {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new PersistedJsonFileError({
      kind: "invalid-json",
      filePath: options.filePath,
      label: options.label,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new PersistedJsonFileError({
      kind: "invalid-shape",
      filePath: options.filePath,
      label: options.label,
      reason: parsed.error.issues.map(formatIssue).join("; "),
    });
  }

  return parsed.data;
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
  return `${path}: ${issue.message}`;
}
