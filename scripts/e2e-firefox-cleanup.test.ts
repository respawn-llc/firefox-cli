import { describe, expect, it } from "vitest";
import {
  isFirefoxExecutableCommand,
  parseDisposableFirefoxProcessIds,
} from "./e2e-firefox-cleanup.js";

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
});
