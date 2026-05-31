import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const rootDefault = fileURLToPath(new URL("..", import.meta.url));
const typeScriptExtensions = new Set([".cts", ".mts", ".ts", ".tsx"]);
const ignoredDirectories = new Set([".builder", ".git", "coverage", "dist", "gen", "node_modules", "target"]);

export async function checkTypeScriptPolicy(root = rootDefault) {
  const errors = [];
  for (const file of await typeScriptFiles(root)) {
    const text = await readFile(file, "utf8");
    if (hasExplicitAny(text, file)) errors.push(`${relative(root, file)} uses explicit any.`);
  }
  return errors;
}
function hasExplicitAny(text, file) {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let found = false;
  visit(sourceFile);
  return found;
  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(node, visit);
  }
}
async function typeScriptFiles(root) {
  const output = [];
  await visit(root);
  return output.sort();
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(path);
      } else if (entry.isFile() && typeScriptExtensions.has(extname(entry.name))) {
        output.push(path);
      }
    }
  }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = await checkTypeScriptPolicy();
  if (errors.length > 0) {
    console.error("TypeScript policy failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
}
