#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolvePackagedBinary } from "../lib/platform-binary.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let binaryPath;

try {
  binaryPath = await resolvePackagedBinary(root);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`firefox-cli binary resolution failed: ${message}`);
  process.exit(1);
}

if (!existsSync(binaryPath)) {
  console.error(`firefox-cli binary not found: ${binaryPath}`);
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
