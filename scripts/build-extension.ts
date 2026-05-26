import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const extensionRoot = resolve(root, "packages/extension");
const outDir = resolve(root, "dist/extension");

const entries = [
  { name: "background", path: resolve(extensionRoot, "src/background.ts") },
  { name: "content", path: resolve(extensionRoot, "src/content.ts") },
  { name: "popup", path: resolve(extensionRoot, "src/popup.ts") },
] as const;

for (const [index, entry] of entries.entries()) {
  await build({
    configFile: false,
    build: {
      emptyOutDir: index === 0,
      outDir,
      rollupOptions: {
        input: entry.path,
        output: {
          entryFileNames: `${entry.name}.js`,
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
  });
}
