import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { ProcessRunnerError, raceWithProcessFailure, renderCommand, runProcess, startManagedProcess } from "../process-runner.js";

const node = process.execPath;

describe("process runner", () => {
  it("captures successful stdout and stderr after process close", async () => {
    const result = await runProcess(node, ["-e", "process.stdout.write('out'); process.stderr.write('err');"]);

    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      stdout: "out",
      stderr: "err",
      stdoutTruncated: false,
      stderrTruncated: false,
    });
  });

  it("rejects spawn errors for one-shot and managed processes", async () => {
    await expect(runProcess("__firefox_cli_missing_process__")).rejects.toBeInstanceOf(ProcessRunnerError);

    const managed = startManagedProcess("__firefox_cli_missing_process__");
    await expect(managed.wait()).rejects.toBeInstanceOf(ProcessRunnerError);
  });

  it("retains newest bounded output and marks truncation", async () => {
    const result = await runProcess(node, ["-e", "process.stdout.write('0123456789abcdef');"], {
      maxOutputBytes: 6,
    });

    expect(result.stdout).toBe("abcdef");
    expect(result.stdoutTruncated).toBe(true);
  });

  it("supports expected nonzero exits and rejects unexpected exits", async () => {
    await expect(runProcess(node, ["-e", "process.exit(2);"], { expectedExitCodes: [2] })).resolves.toMatchObject({ exitCode: 2 });

    await expect(runProcess(node, ["-e", "process.exit(2);"])).rejects.toBeInstanceOf(ProcessRunnerError);
  });

  it("terminates timed-out processes and exposes the child pid", async () => {
    let failure: unknown;
    try {
      await runProcess(node, ["-e", "setInterval(() => undefined, 1000);"], {
        timeoutMs: 50,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ProcessRunnerError);
    if (!(failure instanceof ProcessRunnerError)) {
      throw new Error("Expected ProcessRunnerError.");
    }
    const pid = failure.pid;
    expect(pid).toBeTypeOf("number");
    await eventually(() => {
      expectProcessGone(pid);
    });
  });

  it("terminates timed-out process trees", async () => {
    const tempDir = await createTempDir("firefox-cli-process-tree");
    const grandchildPidFile = join(tempDir, "grandchild.pid");
    let failure: unknown;
    let grandchildPid: number | undefined;
    try {
      try {
        await runProcess(node, processTreeArgs(grandchildPidFile), {
          timeoutMs: 1000,
        });
      } catch (error) {
        failure = error;
        grandchildPid = Number(await readFile(grandchildPidFile, "utf8"));
      }

      expect(failure).toBeInstanceOf(ProcessRunnerError);
      expect(grandchildPid).toBeTypeOf("number");
      await eventually(() => {
        expectProcessGone(grandchildPid);
      });
    } finally {
      cleanupProcess(grandchildPid);
    }
  });

  it("stops managed children with signal escalation", async () => {
    const managed = startManagedProcess(node, ["-e", "setInterval(() => undefined, 1000);"]);
    const pid = managed.pid;

    const stopped = await managed.stop({ interruptGraceMs: 50, terminateGraceMs: 50 });

    expect(stopped.signal ?? stopped.exitCode).not.toBeNull();
    expect(pid).toBeTypeOf("number");
    await eventually(() => {
      expectProcessGone(pid);
    });
  });

  it("stops managed process trees with signal escalation", async () => {
    const tempDir = await createTempDir("firefox-cli-process-tree");
    const grandchildPidFile = join(tempDir, "grandchild.pid");
    const managed = startManagedProcess(node, processTreeArgs(grandchildPidFile));
    const pid = managed.pid;
    let grandchildPid: number | undefined;

    try {
      grandchildPid = await eventuallyValue(async () => {
        const value = Number(await readFile(grandchildPidFile, "utf8"));
        return Number.isInteger(value) && value > 0 ? value : false;
      });
      const stopped = await managed.stop({
        interruptGraceMs: 50,
        terminateGraceMs: 50,
        forceGraceMs: 500,
      });

      expect(stopped.signal ?? stopped.exitCode).not.toBeNull();
      expect(pid).toBeTypeOf("number");
      await eventually(() => {
        expectProcessGone(pid);
      });
      await eventually(() => {
        expectProcessGone(grandchildPid);
      });
    } finally {
      cleanupProcessTree(pid);
      cleanupProcess(grandchildPid);
    }
  });

  it("races readiness against child exit and spawn failure", async () => {
    const exited = startManagedProcess(node, ["-e", "process.exit(3);"]);
    await expect(raceWithProcessFailure(exited, sleep(1000), "early-exit")).rejects.toBeInstanceOf(ProcessRunnerError);

    const missing = startManagedProcess("__firefox_cli_missing_process__");
    await expect(raceWithProcessFailure(missing, sleep(1000), "spawn-fail")).rejects.toBeInstanceOf(ProcessRunnerError);
  });

  it("redacts configured command argument values", async () => {
    const rendered = renderCommand("web-ext", ["--api-secret", "super-secret"], ["super-secret"]);
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("super-secret");

    let failure: unknown;
    try {
      await runProcess(node, ["-e", "process.exit(2);", "super-secret"], {
        redactArgValues: ["super-secret"],
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ProcessRunnerError);
    if (!(failure instanceof Error)) {
      throw new Error("Expected Error.");
    }
    expect(failure.message).not.toContain("super-secret");
  });
});

async function eventually(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 1000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await sleep(25);
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
}

async function eventuallyValue<T>(read: () => Promise<T | false>): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 1000) {
    try {
      const value = await read();
      if (value !== false) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(25);
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Timed out waiting for value.");
}

function expectProcessGone(pid: number | undefined): void {
  if (pid === undefined) {
    throw new Error("pid was not captured");
  }
  expect(() => process.kill(pid, 0)).toThrow();
}

function processTreeArgs(grandchildPidFile: string): readonly string[] {
  const grandchildScript = "setInterval(() => undefined, 1000);";
  const parentScript = [
    'const { spawn } = require("node:child_process");',
    'const { writeFileSync } = require("node:fs");',
    `const child = spawn(process.execPath, ["-e", ${JSON.stringify(grandchildScript)}], { stdio: "ignore" });`,
    "writeFileSync(process.argv[1], String(child.pid));",
    "setInterval(() => undefined, 1000);",
  ].join("\n");
  return ["-e", parentScript, grandchildPidFile];
}

function cleanupProcessTree(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}

function cleanupProcess(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
