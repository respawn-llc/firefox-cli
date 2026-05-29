import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export type ProcessOutputMode = "pipe" | "ignore" | "inherit";

export type ProcessResult = {
  readonly command: string;
  readonly args: readonly string[];
  readonly renderedCommand: string;
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
};

export type ProcessRunnerOptions = {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: ProcessOutputMode;
  readonly stdout?: ProcessOutputMode;
  readonly stderr?: ProcessOutputMode;
  readonly maxOutputBytes?: number;
  readonly expectedExitCodes?: readonly number[];
  readonly timeoutMs?: number;
  readonly label?: string;
  readonly redactArgValues?: readonly string[];
};

export type StopProcessOptions = {
  readonly interruptGraceMs?: number;
  readonly terminateGraceMs?: number;
};

export class ProcessRunnerError extends Error {
  readonly result: ProcessResult | undefined;
  readonly pid: number | undefined;

  constructor(
    message: string,
    options: {
      readonly result?: ProcessResult | undefined;
      readonly pid?: number | undefined;
    } = {},
  ) {
    super(message);
    this.name = "ProcessRunnerError";
    this.result = options.result;
    this.pid = options.pid;
  }
}

export type ManagedProcess = {
  readonly child: ChildProcess;
  readonly pid?: number;
  stdout(): string;
  stderr(): string;
  output(): string;
  wait(): Promise<ProcessResult>;
  stop(options?: StopProcessOptions): Promise<ProcessResult>;
};

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_INTERRUPT_GRACE_MS = 5000;
const DEFAULT_TERMINATE_GRACE_MS = 3000;

export async function runProcess(
  command: string,
  args: readonly string[] = [],
  options: ProcessRunnerOptions = {},
): Promise<ProcessResult> {
  const managed = startManagedProcess(command, args, options);
  const wait =
    options.timeoutMs === undefined
      ? managed.wait()
      : withTimeout(managed.wait(), options.timeoutMs, async () => {
          await managed.stop();
          throw new ProcessRunnerError(
            `${processLabel(command, options)} timed out after ${options.timeoutMs}ms.\n${managed.output()}`,
            errorDetails({ pid: managed.pid }),
          );
        });
  const result = await wait;
  const expectedExitCodes = options.expectedExitCodes ?? [0];
  if (result.exitCode === null || !expectedExitCodes.includes(result.exitCode)) {
    throw new ProcessRunnerError(
      `${processLabel(command, options)} exited with ${exitDescription(result)}.\n${result.stderr || result.stdout}`,
      errorDetails({ result, pid: result.pid }),
    );
  }
  return result;
}

export function startManagedProcess(
  command: string,
  args: readonly string[] = [],
  options: ProcessRunnerOptions = {},
): ManagedProcess {
  const stdout = new BoundedOutput(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
  const stderr = new BoundedOutput(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
  const renderedCommand = renderCommand(command, args, options.redactArgValues ?? []);
  const child = spawn(command, [...args], spawnOptions(options));

  child.stdout?.on("data", (chunk: Buffer | string) => stdout.append(chunk));
  child.stderr?.on("data", (chunk: Buffer | string) => stderr.append(chunk));

  const waitPromise = new Promise<ProcessResult>((resolve, reject) => {
    child.once("error", (error) => {
      reject(
        new ProcessRunnerError(
          `${processLabel(command, options)} failed to spawn: ${error.message}`,
          {
            ...errorDetails({ pid: child.pid }),
          },
        ),
      );
    });
    child.once("close", (exitCode, signal) => {
      resolve({
        command,
        args: [...args],
        renderedCommand,
        ...(child.pid === undefined ? {} : { pid: child.pid }),
        exitCode,
        signal,
        stdout: stdout.value(),
        stderr: stderr.value(),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      });
    });
  });
  void waitPromise.catch(() => undefined);

  return {
    child,
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    stdout: () => stdout.value(),
    stderr: () => stderr.value(),
    output: () => [stdout.value(), stderr.value()].filter((value) => value.length > 0).join("\n"),
    wait: () => waitPromise,
    stop: (stopOptions = {}) => stopManagedProcess(child, waitPromise, stopOptions),
  };
}

export async function raceWithProcessFailure<T>(
  managed: ManagedProcess,
  readiness: Promise<T>,
  label: string,
): Promise<T> {
  return Promise.race([
    readiness,
    managed.wait().then(
      (result) => {
        throw new ProcessRunnerError(
          `${label} process exited before readiness with ${exitDescription(result)}.\n${result.stderr || result.stdout}`,
          errorDetails({ result, pid: result.pid }),
        );
      },
      (error: unknown) => {
        throw error instanceof Error
          ? error
          : new ProcessRunnerError(`${label} process failed before readiness: ${String(error)}`, {
              ...errorDetails({ pid: managed.pid }),
            });
      },
    ),
  ]);
}

export function renderCommand(
  command: string,
  args: readonly string[],
  redactArgValues: readonly string[] = [],
): string {
  const secrets = new Set(redactArgValues.filter((value) => value.length > 0));
  return [command, ...args]
    .map((part) => (secrets.has(part) ? "[redacted]" : shellQuote(part)))
    .join(" ");
}

function errorDetails(options: {
  readonly result?: ProcessResult | undefined;
  readonly pid?: number | undefined;
}): { readonly result?: ProcessResult; readonly pid?: number } {
  return {
    ...(options.result === undefined ? {} : { result: options.result }),
    ...(options.pid === undefined ? {} : { pid: options.pid }),
  };
}

async function stopManagedProcess(
  child: ChildProcess,
  waitPromise: Promise<ProcessResult>,
  options: StopProcessOptions,
): Promise<ProcessResult> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return waitPromise;
  }

  child.kill("SIGINT");
  try {
    return await waitForStop(waitPromise, options.interruptGraceMs ?? DEFAULT_INTERRUPT_GRACE_MS);
  } catch {
    child.kill("SIGTERM");
  }

  try {
    return await waitForStop(waitPromise, options.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS);
  } catch {
    child.kill("SIGKILL");
    return waitPromise;
  }
}

function spawnOptions(options: ProcessRunnerOptions): SpawnOptions {
  return {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.stdin ?? "ignore", options.stdout ?? "pipe", options.stderr ?? "pipe"],
  };
}

function processLabel(command: string, options: ProcessRunnerOptions): string {
  return options.label ?? command;
}

function exitDescription(result: ProcessResult): string {
  return result.signal === null
    ? `exit code ${String(result.exitCode)}`
    : `signal ${result.signal}`;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Promise<never>,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          onTimeout().then(_resolve, reject);
        }, ms);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function waitForStop<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("process did not stop")), ms);
    }),
  ]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/u.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

class BoundedOutput {
  readonly #maxBytes: number;
  readonly #chunks: Buffer[] = [];
  #bytes = 0;
  #truncated = false;

  constructor(maxBytes: number) {
    this.#maxBytes = maxBytes;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  append(chunk: Buffer | string): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.#chunks.push(buffer);
    this.#bytes += buffer.byteLength;
    this.#trim();
  }

  value(): string {
    return Buffer.concat(this.#chunks).toString("utf8");
  }

  #trim(): void {
    while (this.#bytes > this.#maxBytes && this.#chunks.length > 0) {
      const overflow = this.#bytes - this.#maxBytes;
      const first = this.#chunks[0];
      if (first === undefined) {
        return;
      }
      this.#truncated = true;
      if (first.byteLength <= overflow) {
        this.#chunks.shift();
        this.#bytes -= first.byteLength;
        continue;
      }
      this.#chunks[0] = first.subarray(overflow);
      this.#bytes -= overflow;
    }
  }
}
