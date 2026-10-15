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
    expect(output.stdout).toContain("List tabs for the selected or only Firefox window");
    expect(output.stdout).toContain("firefox-cli open [--new-tab] [--focus] <url> [--json]");
  });

  it("renders command-specific contextual help", async () => {
    const output = await runCli(["snapshot", "--help"], baseDependencies());

    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain("firefox-cli snapshot [-i] [-c] [-d depth] [-s selector] [--json]");
    expect(output.stdout).toContain("Read the target page as a compact text/JSON structure");
    expect(output.stdout).toContain("`-i` includes stable element refs");
    expect(output.stdout).toContain("firefox-cli snapshot -i");
  });

  it.each([
    [["tab", "new"], "firefox-cli tab new [url] [--focus] [--json] [--window <target>]"],
    [["tab", "select"], "firefox-cli tab select [target-or-url] [--focus] [--json] [--window <target>] [--tab <target>]"],
    [["window", "new"], "firefox-cli window new [url] [--focus] [--json]"],
    [["open"], "firefox-cli open [--new-tab] [--focus] <url> [--json] [--window <target>] [--tab <target>]"],
    [["screenshot"], "firefox-cli screenshot [path] [--focus] [--json] [--window <target>] [--tab <target>]"],
  ] as const)("advertises --focus for approved route %s", async (command, usage) => {
    const output = await runCli([...command, "--help"], baseDependencies());

    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain(usage);
  });

  it("explains tab selection and window focus as separate actions", async () => {
    const tabOutput = await runCli(["tab", "select", "--help"], baseDependencies());
    const windowOutput = await runCli(["window", "select", "--help"], baseDependencies());
    const screenshotOutput = await runCli(["screenshot", "--help"], baseDependencies());
    const newWindowOutput = await runCli(["window", "new", "--help"], baseDependencies());

    expect(tabOutput.exitCode).toBe(0);
    expect(tabOutput.stdout).toContain("Select a tab within its window");
    expect(tabOutput.stdout).toContain("Use `--focus` to bring its window forward.");
    expect(tabOutput.stdout).toContain("Pass `--window`/`--tab` explicitly to later target-dependent commands.");
    expect(windowOutput.exitCode).toBe(0);
    expect(windowOutput.stdout).toContain("Bring a window forward to the user");
    expect(windowOutput.stdout).toContain("Pass `--window`/`--tab` explicitly to later target-dependent commands.");
    expect(screenshotOutput.exitCode).toBe(0);
    expect(screenshotOutput.stdout).toContain("focus-dependent rendering");
    expect(newWindowOutput.exitCode).toBe(0);
    expect(newWindowOutput.stdout).toContain("makes no foreground request");
  });

  it("documents omitted-focus behavior for navigation and new windows", async () => {
    const openOutput = await runCli(["open", "--help"], baseDependencies());
    const windowOutput = await runCli(["window", "new", "--help"], baseDependencies());

    expect(openOutput.exitCode).toBe(0);
    expect(openOutput.stdout).toContain("Navigation leaves tab selection unchanged by default");
    expect(openOutput.stdout).toContain("creates an unselected tab unless `--focus` is set");
    expect(windowOutput.exitCode).toBe(0);
    expect(windowOutput.stdout).toContain("makes no foreground request");
  });

  it("does not advertise --focus on unapproved routes", async () => {
    for (const command of [["tab", "close"], ["window", "select"], ["snapshot"]] as const) {
      const output = await runCli([...command, "--help"], baseDependencies());

      expect(output.exitCode, command.join(" ")).toBe(0);
      expect(output.stdout, command.join(" ")).not.toContain("--focus");
    }
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
