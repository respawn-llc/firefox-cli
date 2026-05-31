import { describe, expect, it } from "vitest";
import {
  commandLineUsesProfileDir,
  isFirefoxExecutableCommand,
  parseDisposableFirefoxProcessIds,
} from "../e2e-firefox-cleanup.js";
import {
  createFirefoxProcessAdapterWithScanner,
  parseWindowsFirefoxProcesses,
} from "../firefox-process-adapter.js";

describe("disposable Firefox process cleanup parsing", () => {
  it("keeps only Firefox processes for the disposable profile", () => {
    const pids = parseDisposableFirefoxProcessIds(
      [
        "101 /Applications/Firefox.app/Contents/MacOS/firefox /Applications/Firefox.app/Contents/MacOS/firefox --profile /tmp/fc-profile",
        "102 /usr/bin/firefox-bin /usr/bin/firefox-bin -profile /tmp/fc-profile",
        "103 /usr/bin/python /usr/bin/python --profile /tmp/fc-profile",
        "104 /usr/bin/firefox /usr/bin/firefox --profile /tmp/other-profile",
        "105 /usr/bin/firefox-esr /usr/bin/firefox-esr --profile /tmp/fc-profile",
        "106 /tmp/firefox-helper /tmp/firefox-helper --profile /tmp/fc-profile",
        "107 /usr/bin/firefox /usr/bin/firefox --firefox-profile /tmp/fc-profile",
        "108 /usr/bin/firefox /usr/bin/firefox --profile '/tmp/fc profile'",
        '109 /usr/bin/firefox /usr/bin/firefox --profile="/tmp/fc profile"',
      ].join("\n"),
      { profileDir: "/tmp/fc-profile", currentPid: 105 },
    );

    expect(pids).toEqual([101, 102]);
  });

  it("matches only Firefox executable command names", () => {
    expect(isFirefoxExecutableCommand("/usr/bin/firefox --profile x")).toBe(true);
    expect(isFirefoxExecutableCommand("/usr/bin/firefox-bin --profile x")).toBe(true);
    expect(isFirefoxExecutableCommand("/usr/bin/firefox-esr --profile x")).toBe(true);
    expect(isFirefoxExecutableCommand("/usr/bin/not-firefox --profile x")).toBe(false);
    expect(isFirefoxExecutableCommand("/usr/bin/firefox-helper --profile x")).toBe(false);
  });

  it("matches quoted profile arguments without matching web-ext profile flags", () => {
    expect(commandLineUsesProfileDir('/usr/bin/firefox --profile "/tmp/fc profile"', "/tmp/fc profile")).toBe(
      true,
    );
    expect(commandLineUsesProfileDir("/usr/bin/firefox --profile='/tmp/fc profile'", "/tmp/fc profile")).toBe(
      true,
    );
    expect(commandLineUsesProfileDir("/usr/bin/firefox -profile=/tmp/fc-profile", "/tmp/fc-profile")).toBe(
      true,
    );
    expect(
      commandLineUsesProfileDir("/usr/bin/firefox --firefox-profile /tmp/fc-profile", "/tmp/fc-profile"),
    ).toBe(false);
  });

  it("parses Windows Firefox process scanner output", () => {
    const processes = parseWindowsFirefoxProcesses(
      {
        stdout: JSON.stringify([
          {
            ProcessId: 201,
            Name: "firefox.exe",
            CommandLine: 'firefox.exe --profile "C:\\Temp\\fc profile"',
          },
          {
            ProcessId: 202,
            Name: "powershell.exe",
            CommandLine: 'powershell.exe --profile "C:\\Temp\\fc profile"',
          },
        ]),
      },
      "C:\\Temp\\fc profile",
    );

    expect(processes.map((process) => process.pid)).toEqual([201]);
  });

  it("stops only scanner-confirmed profile processes", async () => {
    const stopped: number[] = [];
    const scans = [
      [{ pid: 301, command: "/usr/bin/firefox", args: "/usr/bin/firefox --profile /tmp/fc" }],
      [],
    ];
    const adapter = createFirefoxProcessAdapterWithScanner(async () => scans.shift() ?? [], {
      pollIntervalMs: 1,
      stop: async (pid) => {
        stopped.push(pid);
      },
      stopTimeoutMs: 50,
    });

    await adapter.stopProfile("/tmp/fc");

    expect(stopped).toEqual([301]);
  });
});
