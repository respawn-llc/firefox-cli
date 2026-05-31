import { z } from "zod";
import { parseDisposableFirefoxProcesses, type DisposableFirefoxProcess } from "./e2e-firefox-cleanup.js";
import { pollUntil } from "./script-timing.js";
import { runProcess, stopProcessTree, type ProcessResult, type StopProcessOptions } from "./process-runner.js";

export interface FirefoxProcessAdapter {
  readonly findProfileProcesses: (profileDir: string) => Promise<readonly DisposableFirefoxProcess[]>;
  readonly stopProfile: (profileDir: string) => Promise<void>;
}

export interface FirefoxProcessAdapterOptions {
  readonly platform?: NodeJS.Platform;
  readonly run?: typeof runProcess;
  readonly stop?: (pid: number, options?: StopProcessOptions) => Promise<void>;
  readonly stopOptions?: StopProcessOptions;
  readonly scanTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

type Scanner = (profileDir: string) => Promise<readonly DisposableFirefoxProcess[]>;

const DEFAULT_SCAN_TIMEOUT_MS = 5_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

const windowsProcessSchema = z
  .object({
    ProcessId: z.number().int().positive(),
    Name: z.string().min(1),
    CommandLine: z.string().nullable().optional(),
  })
  .loose();

export function createFirefoxProcessAdapter(options: FirefoxProcessAdapterOptions = {}): FirefoxProcessAdapter {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runProcess;
  const stop = options.stop ?? stopProcessTree;
  const scan =
    platform === "win32"
      ? async (profileDir: string) => findWindowsFirefoxProcesses(profileDir, run)
      : async (profileDir: string) => findPosixFirefoxProcesses(profileDir, run);

  return createFirefoxProcessAdapterWithScanner(scan, {
    stop,
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.stopOptions === undefined ? {} : { stopOptions: options.stopOptions }),
    ...(options.stopTimeoutMs === undefined ? {} : { stopTimeoutMs: options.stopTimeoutMs }),
  });
}

export function createFirefoxProcessAdapterWithScanner(
  scan: Scanner,
  options: Pick<FirefoxProcessAdapterOptions, "pollIntervalMs" | "stop" | "stopOptions" | "stopTimeoutMs"> = {},
): FirefoxProcessAdapter {
  const stop = options.stop ?? stopProcessTree;
  const stopOptions = options.stopOptions ?? {};
  return {
    findProfileProcesses: scan,
    stopProfile: async (profileDir) => {
      await stopFirefoxProcesses(await scan(profileDir), stop, stopOptions);
      await pollUntil(async () => (await scan(profileDir)).length === 0, {
        timeoutMs: options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
        intervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
        timeoutMessage: () => `Disposable Firefox did not exit for profile ${profileDir}.`,
      });
    },
  };
}

async function findPosixFirefoxProcesses(profileDir: string, run: typeof runProcess): Promise<readonly DisposableFirefoxProcess[]> {
  const result = await run("ps", ["-axo", "pid=,comm=,args="], {
    timeoutMs: DEFAULT_SCAN_TIMEOUT_MS,
    maxOutputBytes: 512 * 1024,
    label: "profile-scoped Firefox process scan",
  });
  return parseDisposableFirefoxProcesses(result.stdout, { profileDir });
}

async function findWindowsFirefoxProcesses(profileDir: string, run: typeof runProcess): Promise<readonly DisposableFirefoxProcess[]> {
  const result = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "$ErrorActionPreference = 'Stop';",
        "Get-CimInstance Win32_Process |",
        "Where-Object { $_.Name -match '^firefox(-bin|-esr)?\\.exe$' } |",
        "Select-Object ProcessId,Name,CommandLine |",
        "ConvertTo-Json -Compress",
      ].join(" "),
    ],
    {
      timeoutMs: DEFAULT_SCAN_TIMEOUT_MS,
      maxOutputBytes: 512 * 1024,
      label: "profile-scoped Firefox process scan",
    },
  );
  return parseWindowsFirefoxProcesses(result, profileDir);
}

export function parseWindowsFirefoxProcesses(result: Pick<ProcessResult, "stdout">, profileDir: string): readonly DisposableFirefoxProcess[] {
  const output = result.stdout.trim();
  if (output.length === 0) {
    return [];
  }
  const parsed: unknown = JSON.parse(output);
  const rows = z.union([windowsProcessSchema, z.array(windowsProcessSchema), z.null()]).parse(parsed);
  const processes = rows === null ? [] : Array.isArray(rows) ? rows : [rows];
  return parseDisposableFirefoxProcesses(
    processes.map((process) => [String(process.ProcessId), process.Name, process.CommandLine ?? ""].join(" ")).join("\n"),
    { profileDir },
  );
}

async function stopFirefoxProcesses(
  processes: readonly DisposableFirefoxProcess[],
  stop: (pid: number, options?: StopProcessOptions) => Promise<void>,
  options: StopProcessOptions,
): Promise<void> {
  await Promise.all(processes.map(async (process) => stop(process.pid, options)));
}
