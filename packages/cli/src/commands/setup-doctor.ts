import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  isPersistedJsonFileError,
  parseNativeMessagingManifestJson,
  planNativeMessagingManifest,
  writeNativeMessagingManifest,
} from "@firefox-cli/native-host";
import { optionalAppDataDir } from "../default-dependencies.js";
import { ok } from "../result.js";
import { createNoopRequest, sendOrUnavailable } from "../transport.js";
import type { CliDependencies, CliResult } from "../types.js";

export async function setup(
  args: readonly string[],
  dependencies: CliDependencies,
  renderHelp: () => string,
): Promise<CliResult> {
  if (args[0] === "native-host") {
    return setupNativeHost(args, dependencies);
  }

  if (args.length === 0 || args.includes("--json")) {
    const plan = await createManifestPlan(dependencies);
    const extensionPath = await resolveExtensionInstallPath(dependencies);
    if (args.includes("--json")) {
      return ok(
        `${JSON.stringify(
          {
            extensionPath,
            nativeHostManifestPath: plan.manifestPath,
          },
          null,
          2,
        )}\n`,
      );
    }

    return ok(
      [
        "firefox-cli setup",
        formatExtensionSetupInstruction(extensionPath),
        "Native host: run `firefox-cli setup native-host`.",
        "",
      ].join("\n"),
    );
  }

  if (args[0] !== "native-host") {
    return { exitCode: 1, stdout: renderHelp(), stderr: "" };
  }

  return setupNativeHost(args, dependencies);
}

async function setupNativeHost(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const dryRun = args.includes("--dry-run");
  const json = args.includes("--json");
  const plan = await createManifestPlan(dependencies);

  if (!dryRun) {
    await writeNativeMessagingManifest(plan);
  }

  if (json) {
    return ok(`${JSON.stringify({ ...plan, dryRun }, null, 2)}\n`);
  }

  return ok(
    [
      `Native host manifest ${dryRun ? "planned" : "installed"}: ${plan.manifestPath}`,
      plan.registration.kind === "windows-registry"
        ? `Registry key to set: ${plan.registration.hive}\\${plan.registration.key}`
        : "Firefox will discover this per-user manifest automatically.",
      "",
    ].join("\n"),
  );
}

export async function doctor(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const fix = args.includes("--fix");
  const json = args.includes("--json");
  const plan = await createManifestPlan(dependencies);
  let manifestStatus = await readNativeHostManifestStatus(plan);
  if (manifestStatus.status !== "installed" && fix) {
    await writeNativeMessagingManifest(plan);
    manifestStatus = { status: "installed", path: plan.manifestPath };
  }

  const connection = await checkExtensionConnection(dependencies);
  const payload = {
    nativeHostManifest: manifestStatus,
    extensionConnection: connection,
  };
  const setupHealthy = manifestStatus.status === "installed";

  if (json) {
    return {
      exitCode: setupHealthy && connection.status === "connected" ? 0 : 1,
      stdout: `${JSON.stringify(payload, null, 2)}\n`,
      stderr: "",
    };
  }

  return {
    exitCode: setupHealthy && connection.status === "connected" ? 0 : 1,
    stdout: [
      "firefox-cli doctor",
      `Native host manifest: ${payload.nativeHostManifest.status}`,
      `Path: ${plan.manifestPath}`,
      payload.nativeHostManifest.status === "stale"
        ? `Installed path: ${payload.nativeHostManifest.installedPath}`
        : undefined,
      payload.nativeHostManifest.status === "invalid"
        ? `Validation error: ${payload.nativeHostManifest.reason}`
        : undefined,
      `Extension connection: ${connection.status}`,
      "nextAction" in payload.nativeHostManifest
        ? `Next action: ${payload.nativeHostManifest.nextAction}`
        : undefined,
      connection.nextAction === undefined
        ? undefined
        : `Connection next action: ${connection.nextAction}`,
      "",
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
    stderr: "",
  };
}

async function createManifestPlan(dependencies: CliDependencies) {
  if (dependencies.binaryPath !== undefined) {
    return planNativeMessagingManifest({
      binaryPath: dependencies.binaryPath,
      platform: dependencies.platform,
      homeDir: dependencies.homeDir,
      ...optionalAppDataDir(dependencies.appDataDir),
    });
  }

  return planNativeMessagingManifest({
    packageRoot: dependencies.packageRoot,
    platform: dependencies.platform,
    arch: dependencies.arch,
    homeDir: dependencies.homeDir,
    ...optionalAppDataDir(dependencies.appDataDir),
  });
}

async function resolveExtensionInstallPath(dependencies: CliDependencies): Promise<string> {
  if (dependencies.extensionPath !== undefined) {
    return dependencies.extensionPath;
  }

  const signedXpiPath = resolve(dependencies.packageRoot, "extension/firefox-cli.xpi");
  try {
    await access(signedXpiPath);
    return signedXpiPath;
  } catch {
    return resolve(dependencies.packageRoot, "extension/development");
  }
}

function formatExtensionSetupInstruction(extensionPath: string): string {
  return extensionPath.endsWith(".xpi")
    ? `Extension: install ${extensionPath} in Firefox.`
    : `Extension: load ${extensionPath} in Firefox about:debugging.`;
}

async function readNativeHostManifestStatus(
  plan: Awaited<ReturnType<typeof createManifestPlan>>,
): Promise<
  | {
      readonly status: "installed";
      readonly path: string;
    }
  | {
      readonly status: "missing";
      readonly path: string;
      readonly nextAction: string;
    }
  | {
      readonly status: "stale";
      readonly path: string;
      readonly installedPath: string;
      readonly expectedPath: string;
      readonly nextAction: string;
    }
  | {
      readonly status: "invalid";
      readonly path: string;
      readonly reason: string;
      readonly nextAction: string;
    }
> {
  let content: string;
  try {
    content = await readFile(plan.manifestPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        status: "missing",
        path: plan.manifestPath,
        nextAction: "Run `firefox-cli setup native-host`.",
      };
    }
    throw error;
  }

  let installed: typeof plan.manifest;
  try {
    installed = parseNativeMessagingManifestJson(content, plan.manifestPath);
  } catch (error) {
    if (isPersistedJsonFileError(error)) {
      return {
        status: "invalid",
        path: plan.manifestPath,
        reason: error.message,
        nextAction: "Run `firefox-cli doctor --fix`.",
      };
    }
    throw error;
  }

  if (!isNativeMessagingManifestCanonical(installed, plan.manifest)) {
    return {
      status: "stale",
      path: plan.manifestPath,
      installedPath: installed.path,
      expectedPath: plan.manifest.path,
      nextAction: "Run `firefox-cli doctor --fix`.",
    };
  }

  return {
    status: "installed",
    path: plan.manifestPath,
  };
}

function isNativeMessagingManifestCanonical(
  installed: Awaited<ReturnType<typeof createManifestPlan>>["manifest"],
  expected: Awaited<ReturnType<typeof createManifestPlan>>["manifest"],
): boolean {
  return (
    installed.name === expected.name &&
    installed.description === expected.description &&
    installed.path === expected.path &&
    installed.type === expected.type &&
    installed.allowed_extensions.length === expected.allowed_extensions.length &&
    installed.allowed_extensions.every(
      (value, index) => value === expected.allowed_extensions[index],
    )
  );
}

async function checkExtensionConnection(dependencies: CliDependencies): Promise<{
  readonly status:
    | "connected"
    | "not-approved"
    | "version-mismatch"
    | "pairing-mismatch"
    | "disconnected";
  readonly nextAction?: string;
}> {
  const response = await sendOrUnavailable(dependencies, createNoopRequest());
  if (response.ok) {
    return { status: "connected" };
  }

  if (response.error.code === "NOT_APPROVED") {
    return {
      status: "not-approved",
      nextAction: "Open the firefox-cli extension popup and approve this native host.",
    };
  }

  if (response.error.code === "VERSION_MISMATCH") {
    return {
      status: "version-mismatch",
      nextAction:
        "Upgrade/rebuild firefox-cli, the native host, and the extension so their protocol versions match.",
    };
  }

  if (response.error.code === "PAIRING_MISMATCH") {
    return {
      status: "pairing-mismatch",
      nextAction: response.error.message,
    };
  }

  return {
    status: "disconnected",
    nextAction: "Load the extension in Firefox and keep Firefox running.",
  };
}
