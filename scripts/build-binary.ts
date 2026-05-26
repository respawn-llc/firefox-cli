import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getBinaryName, getPlatformKey } from "@firefox-cli/native-host";

const platformKey = getPlatformKey();
const outputPath = resolve("dist/bin", platformKey, getBinaryName());

await mkdir(dirname(outputPath), { recursive: true });

const build = Bun.spawn(
  ["bun", "build", "packages/cli/src/entrypoint.ts", "--compile", "--outfile", outputPath],
  {
    stderr: "inherit",
    stdout: "inherit",
  },
);

const exitCode = await build.exited;
if (exitCode !== 0) {
  process.exit(exitCode);
}

if (process.platform !== "win32") {
  await chmod(outputPath, 0o755);
}

console.log(`Built ${outputPath}`);
