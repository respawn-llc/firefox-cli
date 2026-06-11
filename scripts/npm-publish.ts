import { resolve } from "node:path";
import { supportedBinaryTargets } from "./platform-targets.js";
import { runProcess } from "./process-runner.js";

const npmRoot = resolve("dist/npm");

export interface NpmPublishPlan {
  readonly buildAll: boolean;
  readonly dryRun: boolean;
  readonly provenance: boolean;
  readonly requireSignedXpi: boolean;
  readonly registry: string;
  readonly publishArgs: readonly string[];
  readonly packageRoots: readonly string[];
}

export function resolveNpmPublishPlan(args: readonly string[] = process.argv.slice(2)): NpmPublishPlan {
  const separatorIndex = args.indexOf("--");
  const scriptArgs = separatorIndex === -1 ? args : args.slice(0, separatorIndex);
  const extraNpmArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1);
  const dryRun = scriptArgs.includes("--dry-run");
  const buildAll = scriptArgs.includes("--build-all");
  const provenance = scriptArgs.includes("--provenance");
  const requireSignedXpi = scriptArgs.includes("--require-signed-xpi");
  const registry = readOption(scriptArgs, "--registry") ?? "https://registry.npmjs.org";
  const otp = readOption(scriptArgs, "--otp");
  const publishArgs = [
    "publish",
    "--access",
    "public",
    "--registry",
    registry,
    ...(provenance ? ["--provenance"] : []),
    ...(dryRun ? ["--dry-run"] : []),
    ...(otp === undefined ? [] : [`--otp=${otp}`]),
    ...extraNpmArgs,
  ];
  const packageRoots = [...supportedBinaryTargets.map((target) => resolve(npmRoot, target.npmPackageName)), resolve(npmRoot, "firefox-cli")];
  return {
    buildAll,
    dryRun,
    provenance,
    requireSignedXpi,
    registry,
    publishArgs,
    packageRoots,
  };
}

export async function publishNpmPackage(plan: NpmPublishPlan = resolveNpmPublishPlan()): Promise<void> {
  await runProcess("bun", ["run", "version:check"], { stdout: "inherit", stderr: "inherit" });
  await runProcess("bun", ["run", "deps:policy"], { stdout: "inherit", stderr: "inherit" });
  await runProcess("bun", ["run", "ts:policy"], { stdout: "inherit", stderr: "inherit" });
  await runProcess("bun", ["run", "build:packages"], { stdout: "inherit", stderr: "inherit" });

  if (plan.buildAll) {
    await runProcess("bun", ["scripts/build-all-binaries.ts"], { stdout: "inherit", stderr: "inherit" });
  }

  await runProcess("bun", ["run", "extension:build"], { stdout: "inherit", stderr: "inherit" });
  await runProcess("bun", ["scripts/npm-package.ts"], { stdout: "inherit", stderr: "inherit" });
  await runProcess("bun", ["scripts/npm-package-check.ts"], { stdout: "inherit", stderr: "inherit" });

  if (plan.requireSignedXpi) {
    await runProcess("bun", ["scripts/package.ts"], { stdout: "inherit", stderr: "inherit" });
    await runProcess("bun", ["scripts/release-check.ts", "--require-signed-xpi"], { stdout: "inherit", stderr: "inherit" });
  }

  for (const publishRoot of plan.packageRoots) {
    await runProcess("npm", plan.publishArgs, {
      cwd: publishRoot,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      label: `npm publish ${publishRoot}`,
    });
  }
}

function readOption(args: readonly string[], name: string): string | undefined {
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed !== undefined) {
    return prefixed.slice(name.length + 1);
  }
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Expected value after ${name}`);
  }
  return value;
}

if (import.meta.main) {
  publishNpmPackage().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
