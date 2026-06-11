import { describe, expect, it, vi } from "vitest";
import { baseDependencies } from "./cli-test-support.js";
import { runCli } from "./index.js";

describe("CLI help", () => {
  it("renders workflow-oriented root help without popup approval warnings", async () => {
    const output = await runCli(["-h"], baseDependencies());

    expect(output.exitCode).toBe(0);
    expect(output.stderr).toBe("");
    expect(output.stdout).toContain("AI-agent control for the user's normal Firefox session.");
    expect(output.stdout).toContain("Read a page:");
    expect(output.stdout).toContain("Act on elements:");
    expect(output.stdout).toContain("firefox-cli snapshot -i");
    expect(output.stdout).toContain("firefox-cli <command> -h");
    expect(output.stdout).not.toContain("extension popup");
    expect(output.stdout).toContain("firefox-cli connect");
  });

  it("renders grouped contextual help for command families", async () => {
    const output = await runCli(["tab", "-h"], baseDependencies());

    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain("Tabs, windows, and navigation");
    expect(output.stdout).toContain("firefox-cli tab [--json]");
    expect(output.stdout).toContain("List tabs with indexes");
    expect(output.stdout).toContain("firefox-cli open [--new-tab] <url> [--json]");
  });

  it("renders command-specific contextual help", async () => {
    const output = await runCli(["snapshot", "--help"], baseDependencies());

    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain("firefox-cli snapshot [-i] [-c] [-d depth] [-s selector] [--json]");
    expect(output.stdout).toContain("Read the target page as a compact text/JSON structure");
    expect(output.stdout).toContain("`-i` includes stable element refs");
    expect(output.stdout).toContain("firefox-cli snapshot -i");
  });

  it("renders wait examples accepted by the wait parser", async () => {
    const output = await runCli(["wait", "--help"], baseDependencies());

    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain("Wait for a duration, element, text, URL, function predicate, load state, or download.");
    expect(output.stdout).toContain("firefox-cli wait '#ready'");
    expect(output.stdout).not.toContain("title");
    expect(output.stdout).not.toContain("dialog");
    expect(output.stdout).not.toContain("firefox-cli wait --selector");
  });

  it("renders command help without sending a browser request", async () => {
    const sendRequest = vi.fn(async () => {
      throw new Error("help must not call transport");
    });
    const output = await runCli(["snapshot", "-h"], {
      ...baseDependencies(),
      sendRequest,
    });

    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain("firefox-cli snapshot [-i] [-c] [-d depth] [-s selector] [--json]");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("keeps setup guidance contextual", async () => {
    const output = await runCli(["setup", "-h"], baseDependencies());

    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain("firefox-cli setup [native-host] [--dry-run] [--json]");
    expect(output.stdout).toContain("Print extension installation guidance");
    expect(output.stdout).toContain("firefox-cli setup native-host");
  });
});
