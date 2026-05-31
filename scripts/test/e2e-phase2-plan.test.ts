import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NATIVE_HOST_NAME, createLocalIpcEndpointScope } from "@firefox-cli/native-host";
import { planPhase2E2e } from "../e2e-phase2-plan.js";

describe("phase 2 E2E planning", () => {
  it("uses macOS state and native manifest paths", () => {
    const plan = planPhase2E2e({
      binaryPath: "/bin/firefox-cli",
      homeDir: "/tmp/fc-home",
      platform: "darwin",
      baseEnv: {},
    });

    expect(plan.stateRoot).toBe("/tmp/fc-home/Library/Application Support/firefox-cli");
    expect(plan.endpoint).toEqual({
      kind: "unix-socket",
      path: join(plan.stateRoot, "ipc", `${NATIVE_HOST_NAME}.sock`),
    });
    expect(plan.manifestPlan.manifestPath).toBe(`/tmp/fc-home/Library/Application Support/Mozilla/NativeMessagingHosts/${NATIVE_HOST_NAME}.json`);
    expect(plan.env).toMatchObject({
      HOME: "/tmp/fc-home",
      USERPROFILE: "/tmp/fc-home",
      APPDATA: "/tmp/fc-home/AppData/Roaming",
    });
  });

  it("uses Linux state and native manifest paths", () => {
    const plan = planPhase2E2e({
      binaryPath: "/bin/firefox-cli",
      homeDir: "/tmp/fc-home",
      platform: "linux",
      baseEnv: {},
    });

    expect(plan.stateRoot).toBe("/tmp/fc-home/.config/firefox-cli");
    expect(plan.endpoint).toEqual({
      kind: "unix-socket",
      path: join(plan.stateRoot, "ipc", `${NATIVE_HOST_NAME}.sock`),
    });
    expect(plan.manifestPlan.manifestPath).toBe(`/tmp/fc-home/.mozilla/native-messaging-hosts/${NATIVE_HOST_NAME}.json`);
  });

  it("uses Windows APPDATA for state and native manifest planning", () => {
    const plan = planPhase2E2e({
      binaryPath: "C:\\\\bin\\\\firefox-cli.exe",
      homeDir: "C:\\\\Users\\\\e2e",
      platform: "win32",
      baseEnv: {},
    });

    expect(plan.stateRoot).toBe("C:\\\\Users\\\\e2e/AppData/Roaming");
    expect(plan.endpoint).toEqual({
      kind: "windows-named-pipe",
      path: `\\\\.\\pipe\\firefox-cli-${NATIVE_HOST_NAME}-${createLocalIpcEndpointScope("phase2-e2e-planning-token")}`,
    });
    expect(plan.manifestPlan.registration).toMatchObject({
      kind: "windows-registry",
      hive: "HKEY_CURRENT_USER",
    });
    expect(plan.env).toMatchObject({
      HOME: "C:\\\\Users\\\\e2e",
      USERPROFILE: "C:\\\\Users\\\\e2e",
      APPDATA: "C:\\\\Users\\\\e2e/AppData/Roaming",
    });
  });
});
