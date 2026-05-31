import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export interface SafeRegularFile {
  readonly relativePath: string;
  readonly absolutePath: string;
}

export async function listRegularFilesUnder(root: string, label: string): Promise<readonly SafeRegularFile[]> {
  const rootState = await resolveSafeDirectory(root, label);
  const files = await listRegularFilesInDirectory(rootState, "", label);
  return [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function readRegularFile(path: string, label: string): Promise<Buffer> {
  await resolveSafeFile(path, label);
  return readFile(path);
}

export async function readOptionalRegularFileUnder(root: string, relativePath: string, label: string): Promise<Buffer | undefined> {
  try {
    return await readRegularFileUnder(root, relativePath, label);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

export async function readRegularFileUnder(root: string, relativePath: string, label: string): Promise<Buffer> {
  const rootState = await resolveSafeDirectory(root, `${label} root`);
  const absolutePath = resolve(rootState.absolutePath, relativePath);
  rejectUnsafeRelativePath(relativePath, label);
  await resolveSafeFile(absolutePath, label, rootState.realPath);
  return readFile(absolutePath);
}

async function listRegularFilesInDirectory(
  root: { readonly absolutePath: string; readonly realPath: string },
  prefix: string,
  label: string,
): Promise<readonly SafeRegularFile[]> {
  const directory = resolve(root.absolutePath, prefix);
  const entries = await readdir(directory);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = prefix.length === 0 ? entry : `${prefix}/${entry}`;
      const absolutePath = resolve(directory, entry);
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) {
        throw new Error(`Refusing to traverse symlink in ${label}: ${relativePath}`);
      }

      const realPath = await realpath(absolutePath);
      assertInsideRoot(root.realPath, realPath, `${label}: ${relativePath}`);
      if (info.isDirectory()) {
        return listRegularFilesInDirectory(root, relativePath, label);
      }
      if (!info.isFile()) {
        throw new Error(`Refusing unsupported file type in ${label}: ${relativePath}`);
      }
      return [{ relativePath, absolutePath }];
    }),
  );
  return nested.flat();
}

async function resolveSafeDirectory(path: string, label: string): Promise<{ readonly absolutePath: string; readonly realPath: string }> {
  const absolutePath = resolve(path);
  const info = await lstat(absolutePath);
  if (info.isSymbolicLink()) {
    throw new Error(`Refusing symlink directory for ${label}: ${absolutePath}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`Expected directory for ${label}: ${absolutePath}`);
  }
  return { absolutePath, realPath: await realpath(absolutePath) };
}

async function resolveSafeFile(path: string, label: string, realRoot?: string): Promise<{ readonly absolutePath: string; readonly realPath: string }> {
  const absolutePath = resolve(path);
  const info = await lstat(absolutePath);
  if (info.isSymbolicLink()) {
    throw new Error(`Refusing to read symlink for ${label}: ${absolutePath}`);
  }
  if (!info.isFile()) {
    throw new Error(`Expected regular file for ${label}: ${absolutePath}`);
  }

  const realPath = await realpath(absolutePath);
  if (realRoot !== undefined) {
    assertInsideRoot(realRoot, realPath, label);
  }
  return { absolutePath, realPath };
}

function rejectUnsafeRelativePath(relativePath: string, label: string): void {
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/u).includes("..")) {
    throw new Error(`Unsafe relative path for ${label}: ${relativePath}`);
  }
}

function assertInsideRoot(realRoot: string, realPath: string, label: string): void {
  const relativePath = relative(realRoot, realPath);
  if (relativePath.length === 0 || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return;
  }
  throw new Error(`Path escapes ${label} root: ${realPath}`);
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
