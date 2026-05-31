import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export type SourceFileKind = "production" | "test-support" | "ignored";

export interface SourceSizePolicy {
  readonly productionMaxLines: number;
  readonly testSupportReviewTargetLines: number;
}

export interface SourceFileSize {
  readonly path: string;
  readonly lines: number;
  readonly kind: SourceFileKind;
}

export interface SourceSizeReport {
  readonly checkedFiles: number;
  readonly productionViolations: readonly SourceFileSize[];
  readonly oversizedTestSupport: readonly SourceFileSize[];
}

export interface SourceSizeCheckOptions {
  readonly rootDir?: string;
  readonly files?: readonly SourceFileSize[];
  readonly policy?: SourceSizePolicy;
  readonly write?: (message: string) => void;
}

export const sourceSizePolicy: SourceSizePolicy = {
  productionMaxLines: 800,
  testSupportReviewTargetLines: 2000,
};

const sourceRoots = ["packages", "scripts"] as const;
const ignoredDirectoryNames = new Set(["dist", "node_modules", ".git"]);

export async function runSourceSizeCheck(options: SourceSizeCheckOptions = {}): Promise<SourceSizeReport> {
  const policy = options.policy ?? sourceSizePolicy;
  const write = options.write ?? console.log;
  const files = options.files ?? (await collectSourceFileSizes(resolve(options.rootDir ?? process.cwd())));
  const report = evaluateSourceSizes(files, policy);

  if (report.productionViolations.length > 0) {
    write("Production source files exceed the reviewability threshold:");
    for (const file of report.productionViolations) {
      write(`- ${file.path}: ${String(file.lines)} lines`);
    }
    throw new Error(`Production source size check failed for ${String(report.productionViolations.length)} file(s).`);
  }

  write(
    [
      `Source size check passed: ${String(report.checkedFiles)} source files checked.`,
      `Production limit: ${String(policy.productionMaxLines)} lines.`,
      `Test-support files over the ${String(policy.testSupportReviewTargetLines)}-line review target: ${String(report.oversizedTestSupport.length)}.`,
    ].join(" "),
  );
  return report;
}

export function evaluateSourceSizes(files: readonly SourceFileSize[], policy: SourceSizePolicy = sourceSizePolicy): SourceSizeReport {
  const checkedFiles = files.filter((file) => file.kind !== "ignored");
  return {
    checkedFiles: checkedFiles.length,
    productionViolations: checkedFiles.filter((file) => file.kind === "production" && file.lines > policy.productionMaxLines).sort(compareFiles),
    oversizedTestSupport: checkedFiles.filter((file) => file.kind === "test-support" && file.lines > policy.testSupportReviewTargetLines).sort(compareFiles),
  };
}

export function classifySourceFile(path: string): SourceFileKind {
  const normalized = normalizePath(path);
  if (!normalized.endsWith(".ts") || normalized.endsWith(".d.ts")) {
    return "ignored";
  }
  if (!normalized.startsWith("packages/") && !normalized.startsWith("scripts/")) {
    return "ignored";
  }
  if (normalized.includes("/dist/") || normalized.includes("/node_modules/") || normalized.includes("/.git/")) {
    return "ignored";
  }
  if (
    normalized.endsWith(".test.ts") ||
    normalized.includes("/test/") ||
    normalized.startsWith("packages/test-support/") ||
    normalized.startsWith("scripts/e2e-")
  ) {
    return "test-support";
  }
  return "production";
}

async function collectSourceFileSizes(rootDir: string): Promise<readonly SourceFileSize[]> {
  const files = await Promise.all(sourceRoots.map(async (sourceRoot) => collectSourceRoot(rootDir, sourceRoot)));
  return files.flat();
}

async function collectSourceRoot(rootDir: string, sourceRoot: string): Promise<readonly SourceFileSize[]> {
  const root = resolve(rootDir, sourceRoot);
  return collectDirectory(rootDir, root);
}

async function collectDirectory(rootDir: string, directory: string): Promise<readonly SourceFileSize[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isSymbolicLink()) {
        return [];
      }
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return ignoredDirectoryNames.has(entry.name) ? [] : collectDirectory(rootDir, path);
      }
      if (!entry.isFile()) {
        return [];
      }
      const relativePath = normalizePath(relative(rootDir, path));
      const kind = classifySourceFile(relativePath);
      if (kind === "ignored") {
        return [];
      }
      const contents = await readFile(path, "utf8");
      return [{ path: relativePath, kind, lines: countLines(contents) }];
    }),
  );
  return files.flat();
}

function countLines(contents: string): number {
  if (contents.length === 0) {
    return 0;
  }
  return contents.endsWith("\n") ? contents.split("\n").length - 1 : contents.split("\n").length;
}

function compareFiles(left: SourceFileSize, right: SourceFileSize): number {
  return right.lines - left.lines || left.path.localeCompare(right.path);
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function isMain(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === moduleUrl;
}

if (isMain(import.meta.url, process.argv[1])) {
  await runSourceSizeCheck();
}
