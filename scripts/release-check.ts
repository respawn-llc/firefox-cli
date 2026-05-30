import { cp, mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  FIREFOX_CLI_EXTENSION_ID,
  NATIVE_HOST_NAME,
  resolvePackagedBinary,
} from "@firefox-cli/native-host";
import { parseJsonWithSchema, runCliJson } from "./manifest-validation.js";
import { verifyPackageLayout } from "./package-check.js";
import { runProcess } from "./process-runner.js";
import { resolveReleaseSignedXpiPolicy } from "./release-policy.js";
import rootPackage from "../package.json" with { type: "json" };

const packageRoot = resolve("dist/package");
const errors: string[] = [];
const releasePolicy = resolveReleaseSignedXpiPolicy(process.argv, process.env);

const doctorOutputSchema = z
  .object({
    nativeHostManifest: z.unknown(),
    extensionConnection: z.unknown(),
  })
  .passthrough();

const nativeManifestOutputSchema = z
  .object({
    name: z.string().min(1),
    path: z.string().min(1),
    type: z.string().min(1),
    allowed_extensions: z.array(z.string().min(1)),
  })
  .passthrough();

const setupNativeHostOutputSchema = z
  .object({
    manifestPath: z.string().min(1),
    manifest: nativeManifestOutputSchema,
  })
  .passthrough();

const staleDoctorOutputSchema = z
  .object({
    nativeHostManifest: z
      .object({
        status: z.string().min(1),
        installedPath: z.string().min(1).optional(),
      })
      .passthrough(),
  })
  .passthrough();

await runCheck("package layout", () =>
  verifyPackageLayout({ packageRoot, requireSignedXpi: releasePolicy.requireSignedXpi }),
);
await runCheck("temp install --version", async () => {
  const installRoot = await createTempInstall(packageRoot);
  const result = await runNodeLauncher(installRoot, ["--version"]);
  if (result.stdout.trim() !== rootPackage.version) {
    throw new Error(`expected version ${rootPackage.version}, received ${result.stdout.trim()}`);
  }
});
await runCheck("temp install doctor", async () => {
  const installRoot = await createTempInstall(packageRoot);
  const env = await createTempUserEnv();
  const parsed = await runCliJson(
    () =>
      runNodeLauncher(installRoot, ["doctor", "--json"], {
        env,
        expectedExitCodes: [0, 1],
      }),
    "doctor --json output",
    doctorOutputSchema,
  );
  if (parsed.nativeHostManifest === undefined || parsed.extensionConnection === undefined) {
    throw new Error("doctor --json did not report setup state");
  }
});
await runCheck("real executable resolution", async () => {
  await resolvePackagedBinary(packageRoot);
});
if (releasePolicy.phase0Mode) {
  console.log("Phase 0 release check: signed XPI and native manifest verification are deferred.");
} else {
  await runCheck("native manifest temp-path verification", () =>
    verifyNativeManifestTempPath({ packageRoot }),
  );
  await runCheck("stale native manifest repair", () =>
    verifyStaleNativeManifestRepair({ packageRoot }),
  );
  if (releasePolicy.allowUnsignedLocal) {
    console.log("Release check completed with explicit non-release local unsigned override.");
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log("Release package check passed.");

async function runCheck(name: string, check: () => Promise<unknown>): Promise<void> {
  try {
    await check();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${name}: ${message}`);
  }
}

async function createTempInstall(sourcePackageRoot: string): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), "firefox-cli-release-check-"));
  const installRoot = join(tempRoot, "node_modules/firefox-cli");
  await cp(sourcePackageRoot, installRoot, { recursive: true });
  return installRoot;
}

async function verifyStaleNativeManifestRepair(options: { readonly packageRoot: string }) {
  const oldInstallRoot = await createTempInstall(options.packageRoot);
  const newInstallRoot = await createTempInstall(options.packageRoot);
  const env = await createTempUserEnv();
  const setup = await runNodeLauncher(oldInstallRoot, ["setup", "native-host", "--json"], { env });
  const setupPayload = parseJsonWithSchema(
    setup.stdout,
    "setup native-host --json output",
    "setup native-host stdout",
    setupNativeHostOutputSchema,
  );
  const oldBinaryPath = await realpath(setupPayload.manifest.path);

  const beforeFix = await runNodeLauncher(newInstallRoot, ["doctor", "--json"], {
    env,
    expectedExitCodes: [1],
  });
  const beforePayload = parseJsonWithSchema(
    beforeFix.stdout,
    "doctor --json output",
    "stale doctor stdout",
    staleDoctorOutputSchema,
  );
  if (beforePayload.nativeHostManifest.status !== "stale") {
    throw new Error("doctor did not report stale native manifest before repair");
  }
  if ((await realpath(beforePayload.nativeHostManifest.installedPath ?? "")) !== oldBinaryPath) {
    throw new Error("doctor did not report the old native manifest executable path");
  }

  await runNodeLauncher(newInstallRoot, ["doctor", "--fix", "--json"], {
    env,
    expectedExitCodes: [1],
  });
  const repaired = parseJsonWithSchema(
    await readFile(setupPayload.manifestPath, "utf8"),
    "native manifest",
    setupPayload.manifestPath,
    nativeManifestOutputSchema,
  );
  const newBinaryPath = await realpath(await resolvePackagedBinary(newInstallRoot));
  if ((await realpath(repaired.path)) !== newBinaryPath) {
    throw new Error("doctor --fix did not repair the native manifest executable path");
  }
}

async function verifyNativeManifestTempPath(options: { readonly packageRoot: string }) {
  const installRoot = await createTempInstall(options.packageRoot);
  const env = await createTempUserEnv();
  const tempHome = env.HOME ?? ".";
  const result = await runNodeLauncher(installRoot, ["setup", "native-host", "--json"], {
    env,
  });
  const parsed = parseJsonWithSchema(
    result.stdout,
    "setup native-host --json output",
    "setup native-host stdout",
    setupNativeHostOutputSchema,
  );
  const manifestPath = resolve(parsed.manifestPath);
  if (!manifestPath.startsWith(resolve(tempHome))) {
    throw new Error(`native manifest escaped temp home: ${manifestPath}`);
  }

  const manifest = parseJsonWithSchema(
    await readFile(manifestPath, "utf8"),
    "native manifest",
    manifestPath,
    nativeManifestOutputSchema,
  );
  const binaryPath = await resolvePackagedBinary(installRoot);
  const expectedBinaryPath = await realpath(binaryPath);
  const manifestBinaryPath = await realpath(manifest.path);
  const parsedManifestBinaryPath = await realpath(parsed.manifest.path);
  if (manifest.name !== NATIVE_HOST_NAME) {
    throw new Error(`unexpected native manifest name: ${manifest.name}`);
  }
  if (manifest.type !== "stdio") {
    throw new Error(`unexpected native manifest type: ${manifest.type}`);
  }
  if (
    manifestBinaryPath !== expectedBinaryPath ||
    parsedManifestBinaryPath !== expectedBinaryPath
  ) {
    throw new Error("native manifest does not point at the packaged executable");
  }
  if (
    manifest.allowed_extensions.length !== 1 ||
    manifest.allowed_extensions[0] !== FIREFOX_CLI_EXTENSION_ID
  ) {
    throw new Error("native manifest allowed_extensions does not contain the stable extension ID");
  }
}

async function createTempUserEnv(): Promise<NodeJS.ProcessEnv> {
  const tempHome = await mkdtemp(join(tmpdir(), "firefox-cli-release-home-"));
  return {
    ...process.env,
    HOME: tempHome,
    USERPROFILE: tempHome,
    APPDATA: join(tempHome, "AppData", "Roaming"),
  };
}

type LauncherResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

async function runNodeLauncher(
  packageRoot: string,
  args: readonly string[],
  options: {
    readonly expectedExitCodes?: readonly number[];
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): Promise<LauncherResult> {
  const launcherPath = join(packageRoot, "bin/firefox-cli.js");
  const result = await runProcess(process.execPath, [launcherPath, ...args], {
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.expectedExitCodes === undefined
      ? {}
      : { expectedExitCodes: options.expectedExitCodes }),
    timeoutMs: 30_000,
    label: "node launcher",
  });

  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
