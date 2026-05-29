import { describe, expect, it } from "vitest";
import {
  ProcessRunnerError,
  raceWithProcessFailure,
  renderCommand,
  runProcess,
  startManagedProcess,
} from "./process-runner.js";

const node = process.execPath;

describe("process runner", () => {
  it("captures successful stdout and stderr after process close", async () => {
    const result = await runProcess(node, [
      "-e",
      "process.stdout.write('out'); process.stderr.write('err');",
    ]);

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
    await expect(runProcess("__firefox_cli_missing_process__")).rejects.toBeInstanceOf(
      ProcessRunnerError,
    );

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
    await expect(
      runProcess(node, ["-e", "process.exit(2);"], { expectedExitCodes: [2] }),
    ).resolves.toMatchObject({ exitCode: 2 });

    await expect(runProcess(node, ["-e", "process.exit(2);"])).rejects.toBeInstanceOf(
      ProcessRunnerError,
    );
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
    const pid = (failure as ProcessRunnerError).pid;
    expect(pid).toBeTypeOf("number");
    await eventually(() => expectProcessGone(pid));
  });

  it("stops managed children with signal escalation", async () => {
    const managed = startManagedProcess(node, ["-e", "setInterval(() => undefined, 1000);"]);
    const pid = managed.pid;

    const stopped = await managed.stop({ interruptGraceMs: 50, terminateGraceMs: 50 });

    expect(stopped.signal ?? stopped.exitCode).not.toBeNull();
    expect(pid).toBeTypeOf("number");
    await eventually(() => expectProcessGone(pid));
  });

  it("races readiness against child exit and spawn failure", async () => {
    const exited = startManagedProcess(node, ["-e", "process.exit(3);"]);
    await expect(raceWithProcessFailure(exited, sleep(1000), "early-exit")).rejects.toBeInstanceOf(
      ProcessRunnerError,
    );

    const missing = startManagedProcess("__firefox_cli_missing_process__");
    await expect(raceWithProcessFailure(missing, sleep(1000), "spawn-fail")).rejects.toBeInstanceOf(
      ProcessRunnerError,
    );
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
    expect((failure as Error).message).not.toContain("super-secret");
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

function expectProcessGone(pid: number | undefined): void {
  if (pid === undefined) {
    throw new Error("pid was not captured");
  }
  expect(() => process.kill(pid, 0)).toThrow();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
