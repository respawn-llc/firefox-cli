import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  getBinaryName,
  getPlatformKey,
  planNativeMessagingManifest,
  writeNativeMessagingManifest,
} from "@firefox-cli/native-host";
import { createTempDir } from "@firefox-cli/test-support";
import { runAgentWorkflowE2e, startWorkflowFixtureServer } from "./e2e-disposable-workflow.js";
import {
  approveExtensionWithMarionette,
  type MarionetteApprovalResult,
} from "./marionette-client.js";

type CliRun = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

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
const webExtOutput: string[] = [];
let webExt: ChildProcess | undefined;
let lastDoctorStatus = "<not run>";
let approvalResult: MarionetteApprovalResult | undefined;
let failed = false;

try {
  await writeNativeMessagingManifest(
    planNativeMessagingManifest({
      binaryPath,
      platform: process.platform,
      homeDir,
    }),
  );

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
  webExt = spawn(webExtBinary, launchArgs, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  collectProcessOutput(webExt, webExtOutput);
  webExt.on("exit", (code, signal) => {
    webExtOutput.push(`web-ext exited code=${String(code)} signal=${String(signal)}`);
  });

  await waitForDoctorStatus({ env, status: "not-approved", timeoutMs: 20_000 });
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
  await waitForDoctorStatus({
    env,
    status: "connected",
    timeoutMs: approvalMode === "manual" ? manualApprovalTimeoutMs : 20_000,
  });
  await waitForStableCliConnection({
    env,
    timeoutMs: approvalMode === "manual" ? manualApprovalTimeoutMs : 20_000,
  });
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
  await stopProcess(webExt);
  await stopFirefoxProcessesForProfile(profileDir);
  await new Promise<void>((resolveClose) => fixture.server.close(() => resolveClose()));
  const output = webExtOutput.join("").trim();
  if (output.length > 0 && (failed || process.env.FIREFOX_CLI_E2E_DEBUG === "1")) {
    console.error(tail(output, 12_000));
  }
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
      let payload: { readonly extensionConnection?: { readonly status?: string } };
      try {
        payload = JSON.parse(result.stdout) as typeof payload;
      } catch (error) {
        throw new Error(
          `doctor --json returned invalid JSON while waiting for ${options.status}: ${
            error instanceof Error ? error.message : String(error)
          }\nstdout=${result.stdout}\nstderr=${result.stderr}`,
        );
      }
      return payload.extensionConnection?.status === options.status;
    },
    {
      timeoutMs: options.timeoutMs,
      intervalMs: 250,
      timeoutMessage: () =>
        `Timed out waiting for disposable Firefox ${options.status} status.\nLast doctor: ${lastDoctor}\n${webExtOutput
          .join("")
          .trim()}`,
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
        `Timed out waiting for stable disposable Firefox CLI connectivity.\nLast probe: ${lastProbe}\n${webExtOutput
          .join("")
          .trim()}`,
    },
  );
}

function doctorReportsConnected(result: CliRun): boolean {
  if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
    return false;
  }
  try {
    const payload = JSON.parse(result.stdout) as {
      readonly extensionConnection?: { readonly status?: string };
    };
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
    const payload = JSON.parse(result.stdout) as {
      readonly capabilities?: readonly unknown[];
    };
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
  return JSON.parse(result.stdout) as T;
}

async function runCli(args: readonly string[], env: NodeJS.ProcessEnv): Promise<CliRun> {
  const child = spawn(binaryPath, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    collectOutput(child.stdout),
    collectOutput(child.stderr),
    waitForExit(child),
  ]);
  return { exitCode, stdout, stderr };
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

function collectProcessOutput(child: ChildProcess, target: string[]): void {
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => target.push(chunk));
  child.stderr?.on("data", (chunk: string) => target.push(chunk));
}

function collectOutput(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolveOutput) => {
    let output = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      output += chunk;
    });
    stream.on("end", () => {
      resolveOutput(output);
    });
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolveExit) => child.on("exit", resolveExit));
}

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null) {
    return;
  }

  child.kill("SIGINT");
  try {
    await withTimeout(waitForExit(child), 5000, "web-ext did not exit after SIGINT.");
    return;
  } catch {
    // Fall through to stronger signals for the disposable web-ext process.
  }

  child.kill("SIGTERM");
  try {
    await withTimeout(waitForExit(child), 3000, "web-ext did not exit after SIGTERM.");
  } catch {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
}

async function stopFirefoxProcessesForProfile(profileDir: string): Promise<void> {
  const pids = await findDisposableFirefoxProcessIds(profileDir);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }

  await pollUntil(async () => (await findDisposableFirefoxProcessIds(profileDir)).length === 0, {
    timeoutMs: 5000,
    intervalMs: 100,
    timeoutMessage: () => `Disposable Firefox did not exit for profile ${profileDir}.`,
  }).catch(async () => {
    for (const pid of await findDisposableFirefoxProcessIds(profileDir)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already exited.
      }
    }
  });
}

async function findDisposableFirefoxProcessIds(profileDir: string): Promise<number[]> {
  const child = spawn("ps", ["-axo", "pid=,command="], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout] = await Promise.all([collectOutput(child.stdout), waitForExit(child)]);
  return stdout
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/u))
    .filter((match): match is RegExpMatchArray => match !== null)
    .filter((match) => {
      const command = match[2] ?? "";
      return command.includes(profileDir) && isFirefoxExecutableCommand(command);
    })
    .map((match) => Number(match[1]))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function isFirefoxExecutableCommand(command: string): boolean {
  return /(?:^|\/)(?:firefox|firefox-bin|firefox-esr)(?:\s|$)/iu.test(command);
}

async function pollUntil<T>(
  check: () => Promise<T | false>,
  options: {
    readonly timeoutMs: number;
    readonly intervalMs: number;
    readonly timeoutMessage: () => string;
  },
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    const value = await check();
    if (value !== false) {
      return value;
    }
    await sleep(options.intervalMs);
  }

  throw new Error(options.timeoutMessage());
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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
