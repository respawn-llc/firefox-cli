import { homedir } from "node:os";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  getBinaryName,
  getPlatformKey,
  type NativeMessagingManifestPlan,
  planNativeMessagingManifest,
  writeNativeMessagingManifest,
} from "@firefox-cli/native-host";
import { createTempDir } from "@firefox-cli/test-support";
import { runAgentWorkflowE2e, startWorkflowFixtureServer } from "./e2e-disposable-workflow.js";
import {
  approveExtensionWithMarionette,
  type MarionetteApprovalResult,
} from "./marionette-client.js";
import { createFirefoxProcessAdapter } from "./firefox-process-adapter.js";
import {
  raceWithProcessFailure,
  runProcess,
  startManagedProcess,
  type ManagedProcess,
} from "./process-runner.js";
import { parseJsonWithSchema } from "./manifest-validation.js";
import { pollUntil } from "./script-timing.js";

type CliRun = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

const doctorStatusSchema = z
  .object({
    extensionConnection: z
      .object({
        status: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const capabilitiesOutputSchema = z
  .object({
    capabilities: z.array(z.unknown()).optional(),
  })
  .passthrough();

if (process.env.FIREFOX_CLI_E2E_DISPOSABLE !== "1") {
  console.log("Disposable Firefox E2E skipped. Set FIREFOX_CLI_E2E_DISPOSABLE=1 to run it.");
  process.exit(0);
}

const approvalMode = process.env.FIREFOX_CLI_E2E_APPROVAL ?? "marionette";
if (approvalMode !== "manual" && approvalMode !== "marionette") {
  throw new Error(
    `Unsupported FIREFOX_CLI_E2E_APPROVAL=${approvalMode}. Supported values: marionette, manual.`,
  );
}
const manualApprovalTimeoutMs = parsePositiveIntegerEnv(
  "FIREFOX_CLI_E2E_MANUAL_APPROVAL_TIMEOUT_MS",
  300_000,
);

const binaryPath = resolve("dist/bin", getPlatformKey(), getBinaryName());
const extensionDir = resolve("dist/extension");
const webExtBinary = resolve(
  "node_modules/.bin",
  process.platform === "win32" ? "web-ext.cmd" : "web-ext",
);
await access(binaryPath);
await access(extensionDir);
await access(webExtBinary);

if (process.platform === "win32") {
  console.log(
    "Disposable Firefox E2E skipped: Windows native-host registration requires registry.",
  );
  process.exit(0);
}

const firefoxBinary = await findFirefoxBinary();
const homeDir = await createTempDir("firefox-cli-e2e-firefox-home");
const profileDir = await createTempDir("firefox-cli-e2e-firefox-profile");
const fixture = await startWorkflowFixtureServer();
const env = e2eEnvironment(homeDir);
const firefoxProcessAdapter = createFirefoxProcessAdapter();
let webExt: ManagedProcess | undefined;
let lastDoctorStatus = "<not run>";
let approvalResult: MarionetteApprovalResult | undefined;
let failed = false;
let restoreFirefoxVisibleManifest: (() => Promise<void>) | undefined;

try {
  const manifestPlan = planNativeMessagingManifest({
    binaryPath,
    platform: process.platform,
    homeDir,
  });
  await writeNativeMessagingManifest(manifestPlan);
  restoreFirefoxVisibleManifest = await installFirefoxVisibleManifest(manifestPlan, homeDir);

  const launchArgs = [
    "run",
    "--source-dir",
    extensionDir,
    "--firefox",
    firefoxBinary,
    "--firefox-profile",
    profileDir,
    "--profile-create-if-missing",
    "--keep-profile-changes",
    "--no-reload",
    "--no-input",
    "--start-url",
    fixture.url,
    "--pref",
    "browser.shell.checkDefaultBrowser=false",
    "--pref",
    "browser.aboutwelcome.enabled=false",
    "--pref",
    "browser.startup.homepage_override.mstone=ignore",
    "--pref",
    "browser.startup.homepage_override.buildID=ignore",
    "--pref",
    "startup.homepage_welcome_url=about:blank",
    "--pref",
    "startup.homepage_welcome_url.additional=",
    "--pref",
    "trailhead.firstrun.didSeeAboutWelcome=true",
    "--pref",
    "datareporting.policy.firstRunURL=",
    "--pref",
    "datareporting.policy.dataSubmissionPolicyBypassNotification=true",
    "--pref",
    "datareporting.healthreport.uploadEnabled=false",
    ...(approvalMode === "marionette"
      ? ["--arg=--marionette", "--arg=--remote-allow-system-access", "--arg=--headless"]
      : []),
  ];
  webExt = startManagedProcess(webExtBinary, launchArgs, {
    env,
    label: "web-ext disposable Firefox",
  });

  await raceWithProcessFailure(
    webExt,
    waitForDoctorStatus({ env, status: "not-approved", timeoutMs: 20_000 }),
    "web-ext disposable Firefox",
  );
  if (approvalMode === "marionette") {
    approvalResult = await approveExtensionWithMarionette(profileDir);
  } else {
    console.error(
      [
        "Disposable Firefox E2E is waiting for manual approval.",
        `Profile: ${profileDir}`,
        `Launch: ${webExtBinary} ${launchArgs.map(shellQuote).join(" ")}`,
        `Current doctor --json: ${lastDoctorStatus}`,
        "Open the firefox-cli extension popup in the disposable Firefox window and click Approve.",
        "Do not approve anything in your normal Firefox window.",
        `Timeout: ${manualApprovalTimeoutMs}ms`,
      ].join("\n"),
    );
  }
  await raceWithProcessFailure(
    webExt,
    waitForDoctorStatus({
      env,
      status: "connected",
      timeoutMs: approvalMode === "manual" ? manualApprovalTimeoutMs : 20_000,
    }),
    "web-ext disposable Firefox",
  );
  await raceWithProcessFailure(
    webExt,
    waitForStableCliConnection({
      env,
      timeoutMs: approvalMode === "manual" ? manualApprovalTimeoutMs : 20_000,
    }),
    "web-ext disposable Firefox",
  );
  console.error(`Disposable Firefox approval confirmed by doctor --json: ${lastDoctorStatus}`);
  if (approvalResult?.captureVisibleTabAvailableBeforeApproval === false) {
    console.error(
      "Disposable Firefox approval exercised the extension-reload path for tabs.captureVisibleTab.",
    );
  }
  await runAgentWorkflowE2e((args) => runCliJson(args, env), fixture.url);

  console.log("Disposable Firefox E2E passed.");
} catch (error) {
  failed = true;
  throw error;
} finally {
  await webExt?.stop();
  await firefoxProcessAdapter.stopProfile(profileDir);
  await restoreFirefoxVisibleManifest?.();
  await new Promise<void>((resolveClose) => fixture.server.close(() => resolveClose()));
  const output = webExtOutput().trim();
  if (output.length > 0 && (failed || process.env.FIREFOX_CLI_E2E_DEBUG === "1")) {
    console.error(tail(output, 12_000));
  }
}

async function installFirefoxVisibleManifest(
  plan: NativeMessagingManifestPlan,
  disposableHomeDir: string,
): Promise<() => Promise<void>> {
  if (process.platform !== "darwin") {
    return async () => undefined;
  }

  const firefoxHomeDir = homedir();
  if (firefoxHomeDir === disposableHomeDir) {
    return async () => undefined;
  }

  const firefoxPlan = planNativeMessagingManifest({
    binaryPath: plan.manifest.path,
    platform: process.platform,
    homeDir: firefoxHomeDir,
  });
  if (firefoxPlan.manifestPath === plan.manifestPath) {
    return async () => undefined;
  }

  const original = await readOptionalFile(firefoxPlan.manifestPath);
  const temporary = `${JSON.stringify(firefoxPlan.manifest, null, 2)}\n`;
  await mkdir(dirname(firefoxPlan.manifestPath), { recursive: true });
  await writeFile(firefoxPlan.manifestPath, temporary);

  return async () => {
    const current = await readOptionalFile(firefoxPlan.manifestPath);
    if (current !== temporary) {
      console.error(
        `Disposable Firefox E2E left ${firefoxPlan.manifestPath} unchanged because it was modified during the run.`,
      );
      return;
    }
    if (original === null) {
      await unlink(firefoxPlan.manifestPath).catch((error: unknown) => {
        if (!isNodeErrorCode(error, "ENOENT")) {
          throw error;
        }
      });
      return;
    }
    await writeFile(firefoxPlan.manifestPath, original);
  };
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function waitForDoctorStatus(options: {
  readonly env: NodeJS.ProcessEnv;
  readonly status: "connected" | "not-approved";
  readonly timeoutMs: number;
}): Promise<void> {
  let lastDoctor = "<not run>";
  await pollUntil(
    async () => {
      const result = await runCli(["doctor", "--json"], options.env);
      lastDoctor = `exit=${String(result.exitCode)} stdout=${result.stdout.trim()} stderr=${result.stderr.trim()}`;
      lastDoctorStatus = lastDoctor;
      if (result.exitCode !== 0 && result.stdout.trim().length === 0) {
        return false;
      }
      const payload = parseJsonWithSchema(
        result.stdout,
        "doctor --json output",
        "disposable Firefox doctor stdout",
        doctorStatusSchema,
      );
      return payload.extensionConnection?.status === options.status;
    },
    {
      timeoutMs: options.timeoutMs,
      intervalMs: 250,
      timeoutMessage: () =>
        `Timed out waiting for disposable Firefox ${options.status} status.\nLast doctor: ${lastDoctor}\n${webExtOutput()}`,
    },
  );
}

async function waitForStableCliConnection(options: {
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}): Promise<void> {
  let consecutive = 0;
  let lastProbe = "<not run>";
  await pollUntil(
    async () => {
      const doctor = await runCli(["doctor", "--json"], options.env);
      lastProbe = `doctor exit=${String(doctor.exitCode)} stdout=${doctor.stdout.trim()} stderr=${doctor.stderr.trim()}`;
      lastDoctorStatus = lastProbe;
      if (!doctorReportsConnected(doctor)) {
        consecutive = 0;
        return false;
      }

      const capabilities = await runCli(["capabilities", "--json"], options.env);
      lastProbe += `\ncapabilities exit=${String(capabilities.exitCode)} stdout=${capabilities.stdout.trim()} stderr=${capabilities.stderr.trim()}`;
      if (!capabilitiesReportsReady(capabilities)) {
        consecutive = 0;
        return false;
      }

      consecutive += 1;
      return consecutive >= 3;
    },
    {
      timeoutMs: options.timeoutMs,
      intervalMs: 250,
      timeoutMessage: () =>
        `Timed out waiting for stable disposable Firefox CLI connectivity.\nLast probe: ${lastProbe}\n${webExtOutput()}`,
    },
  );
}

function doctorReportsConnected(result: CliRun): boolean {
  if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
    return false;
  }
  try {
    const payload = parseJsonWithSchema(
      result.stdout,
      "doctor --json output",
      "disposable Firefox doctor stdout",
      doctorStatusSchema,
    );
    return payload.extensionConnection?.status === "connected";
  } catch {
    return false;
  }
}

function capabilitiesReportsReady(result: CliRun): boolean {
  if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
    return false;
  }
  try {
    const payload = parseJsonWithSchema(
      result.stdout,
      "capabilities --json output",
      "disposable Firefox capabilities stdout",
      capabilitiesOutputSchema,
    );
    return Array.isArray(payload.capabilities);
  } catch {
    return false;
  }
}

async function runCliJson<T>(args: readonly string[], env: NodeJS.ProcessEnv): Promise<T> {
  const result = await runCli(args, env);
  if (result.exitCode !== 0) {
    throw new Error(`firefox-cli ${args.join(" ")} failed:\n${result.stderr}\n${result.stdout}`);
  }
  return parseJsonWithSchema(
    result.stdout,
    `firefox-cli ${args.join(" ")} output`,
    `firefox-cli ${args.join(" ")} stdout`,
    z.unknown(),
  ) as T;
}

async function runCli(args: readonly string[], env: NodeJS.ProcessEnv): Promise<CliRun> {
  const result = await runProcess(binaryPath, args, {
    env,
    expectedExitCodes: [0, 1],
    timeoutMs: 30_000,
    label: `firefox-cli ${args.join(" ")}`,
  });
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

function e2eEnvironment(homeDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: join(homeDir, "AppData", "Roaming"),
  };
}

async function findFirefoxBinary(): Promise<string> {
  const candidates =
    process.platform === "darwin"
      ? [
          process.env.FIREFOX_BINARY,
          "/Applications/Firefox.app/Contents/MacOS/firefox",
          "/opt/homebrew/bin/firefox",
          "/usr/local/bin/firefox",
        ]
      : [process.env.FIREFOX_BINARY, "firefox"];

  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }
    if (candidate === "firefox") {
      return candidate;
    }
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Firefox binary was not found. Set FIREFOX_BINARY to run disposable E2E.");
}

function webExtOutput(): string {
  return webExt?.output() ?? "";
}

function tail(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(value.length - maxChars);
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}.`);
  }
  return parsed;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/u.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
