import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { pollUntil } from "./script-timing.js";
export { startWorkflowFixtureServer } from "./e2e-workflow-fixture.js";
import { expectPhase8Commands } from "./e2e-workflow-phase8.js";

export type CliJsonRunner = <T>(args: readonly string[]) => Promise<T>;

interface TabListPayload {
  readonly tabs?: readonly {
    readonly id?: number;
    readonly url?: string;
  }[];
}

interface TabNewPayload {
  readonly target?: {
    readonly tabId?: number;
  };
}

interface SnapshotPayload {
  readonly generationId?: string;
  readonly text?: string;
}

interface ActionPayload {
  readonly action?: string;
  readonly ok?: boolean;
  readonly valueLength?: number;
  readonly selectedValues?: readonly string[];
}

interface GetPayload {
  readonly value?: unknown;
}

interface IsPayload {
  readonly value?: boolean;
}

interface WaitPayload {
  readonly matched?: boolean;
}

interface EvalPayload {
  readonly value?: {
    readonly type?: string;
    readonly value?: unknown;
  };
}

interface ScreenshotPayload {
  readonly path?: string;
  readonly bytes?: number;
}

interface BatchPayload {
  readonly ok?: boolean;
  readonly steps?: readonly {
    readonly ok?: boolean;
    readonly command?: string;
  }[];
}

export async function runAgentWorkflowE2e(runCliJson: CliJsonRunner, fixtureUrl: string): Promise<void> {
  const beforeTabs = await runCliJson<TabListPayload>(["tab", "--json"]).catch(() => ({
    tabs: [],
  }));
  const previousTabIds = new Set(beforeTabs.tabs?.map((candidate) => candidate.id).filter((id): id is number => typeof id === "number") ?? []);
  const created = await runCliJson<TabNewPayload>(["window", "new", fixtureUrl, "--json"]);
  const tab = created.target?.tabId === undefined ? await waitForFixtureTab(runCliJson, fixtureUrl, previousTabIds) : { id: created.target.tabId };
  const target = `id:${String(tab.id)}`;
  await runCliJson(["reload", "--tab", target, "--json"]);
  await expectWait(runCliJson, ["wait", "--load", "complete", "--tab", target, "--timeout", "5000", "--json"]);

  const snapshot = await runCliJson<SnapshotPayload>(["snapshot", "--tab", target, "-i", "--json"]);
  if (snapshot.generationId === undefined || snapshot.text === undefined) {
    throw new Error(`Snapshot response was missing generation/text: ${JSON.stringify(snapshot)}`);
  }
  const ref = refForSnapshotText(snapshot.text, "Submit E2E");
  if (ref === undefined) {
    throw new Error(`Snapshot did not contain a Submit E2E ref: ${snapshot.text}`);
  }

  await expectGetValue(runCliJson, ["get", "text", ref, "--generation", snapshot.generationId, "--tab", target, "--json"], "Submit E2E");

  await expectAction(runCliJson, ["fill", "#email", "user@example.test", "--tab", target, "--json"], {
    action: "fill",
    valueLength: 17,
  });
  await expectAction(runCliJson, ["type", "#name", "Nikita", "--tab", target, "--json"], {
    action: "type",
    valueLength: 6,
  });
  await expectAction(runCliJson, ["focus", "#notes", "--tab", target, "--json"], {
    action: "focus",
  });
  await expectAction(runCliJson, ["keyboard", "type", "Ship it", "--tab", target, "--json"], {
    action: "keyboard.type",
    valueLength: 7,
  });
  await expectAction(runCliJson, ["check", "#agree", "--tab", target, "--json"], {
    action: "check",
  });
  const select = await expectAction(runCliJson, ["select", "--tab", target, "--json", "#plan", "pro"], {
    action: "select",
  });
  if (select.selectedValues?.join(",") !== "pro") {
    throw new Error(`Expected select to choose pro, got ${JSON.stringify(select)}`);
  }
  await expectBoolean(runCliJson, ["is", "checked", "#agree", "--tab", target, "--json"], true);
  await expectAction(runCliJson, ["scroll", "down", "120", "#feed", "--tab", target, "--json"], {
    action: "scroll",
  });
  await expectAction(runCliJson, ["click", "#submit", "--tab", target, "--json"], {
    action: "click",
  });
  await expectWait(runCliJson, ["wait", "--text", "Submitted user@example.test", "--tab", target, "--timeout", "5000", "--json"]);
  await expectGetValue(runCliJson, ["get", "text", "#status", "--tab", target, "--json"], "Submitted user@example.test Nikita Ship it agreed pro");

  await expectEvalState(runCliJson, target);
  await expectScreenshot(runCliJson, target);
  await expectPhase8Commands(runCliJson, target, fixtureUrl);
  await expectBatch(runCliJson, target);
}

async function expectAction(
  runCliJson: CliJsonRunner,
  args: readonly string[],
  expected: { readonly action: string; readonly valueLength?: number },
): Promise<ActionPayload> {
  const payload = await runCliJson<ActionPayload>(args);
  if (payload.ok !== true || payload.action !== expected.action) {
    throw new Error(`Expected ${expected.action} action success, got ${JSON.stringify(payload)}`);
  }
  if (expected.valueLength !== undefined && payload.valueLength !== expected.valueLength) {
    throw new Error(`Expected ${expected.action} valueLength=${String(expected.valueLength)}, got ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForFixtureTab(runCliJson: CliJsonRunner, fixtureUrl: string, excludedTabIds: ReadonlySet<number>): Promise<{ readonly id: number }> {
  return pollUntil(
    async () => {
      const payload = await runCliJson<TabListPayload>(["tab", "--json"]);
      const tab = payload.tabs?.find(
        (candidate) => typeof candidate.id === "number" && !excludedTabIds.has(candidate.id) && candidate.url?.startsWith(fixtureUrl),
      );
      return tab?.id === undefined ? false : { id: tab.id };
    },
    {
      timeoutMs: 15_000,
      intervalMs: 250,
      timeoutMessage: () => "Timed out waiting for new fixture tab in disposable Firefox.",
    },
  );
}

function refForSnapshotText(text: string, label: string): string | undefined {
  return text
    .split("\n")
    .find((line) => line.includes(label))
    ?.match(/@e\d+/u)?.[0];
}

async function expectGetValue(runCliJson: CliJsonRunner, args: readonly string[], expected: unknown): Promise<void> {
  const payload = await runCliJson<GetPayload>(args);
  if (payload.value !== expected) {
    throw new Error(`Expected get value ${String(expected)}, got ${JSON.stringify(payload)}`);
  }
}

async function expectBoolean(runCliJson: CliJsonRunner, args: readonly string[], expected: boolean): Promise<void> {
  const payload = await runCliJson<IsPayload>(args);
  if (payload.value !== expected) {
    throw new Error(`Expected boolean ${String(expected)}, got ${JSON.stringify(payload)}`);
  }
}

async function expectWait(runCliJson: CliJsonRunner, args: readonly string[]): Promise<void> {
  const payload = await runCliJson<WaitPayload>(args);
  if (payload.matched !== true) {
    throw new Error(`Expected wait match, got ${JSON.stringify(payload)}`);
  }
}

async function expectEvalState(runCliJson: CliJsonRunner, target: string): Promise<void> {
  const payload = await runCliJson<EvalPayload>([
    "eval",
    `({
      email: document.querySelector("#email").value,
      name: document.querySelector("#name").value,
      notes: document.querySelector("#notes").value,
      agreed: document.querySelector("#agree").checked,
      plan: document.querySelector("#plan").value,
      submits: Number(document.body.dataset.submits || "0")
    })`,
    "--tab",
    target,
    "--json",
  ]);
  const value = payload.value?.value;
  if (
    payload.value?.type !== "json" ||
    !isRecord(value) ||
    value.email !== "user@example.test" ||
    value.name !== "Nikita" ||
    value.notes !== "Ship it" ||
    value.agreed !== true ||
    value.plan !== "pro" ||
    value.submits !== 1
  ) {
    throw new Error(`Unexpected eval state: ${JSON.stringify(payload)}`);
  }
}

async function expectScreenshot(runCliJson: CliJsonRunner, target: string): Promise<void> {
  const screenshotDir = await createTempDir("firefox-cli-e2e-screenshot");
  const screenshotPath = join(screenshotDir, "page.png");
  const payload = await runCliJson<ScreenshotPayload>(["screenshot", screenshotPath, "--tab", target, "--json"]);
  const file = await stat(screenshotPath);
  if (payload.path !== screenshotPath || payload.bytes !== file.size || file.size <= 0) {
    throw new Error(`Unexpected screenshot result: ${JSON.stringify(payload)} size=${String(file.size)}`);
  }
  const header = await readFile(screenshotPath);
  if (!isPng(header)) {
    throw new Error(`Screenshot file is not a PNG: ${screenshotPath}`);
  }
}

async function expectBatch(runCliJson: CliJsonRunner, target: string): Promise<void> {
  const payload = await runCliJson<BatchPayload>([
    "batch",
    JSON.stringify([
      ["fill", "#email", "batch@example.test"],
      ["click", "#submit"],
      ["wait", "--text", "Submitted batch@example.test", "--timeout", "5000"],
      ["get", "text", "#status"],
    ]),
    "--tab",
    target,
    "--json",
  ]);
  if (payload.ok !== true || payload.steps?.length !== 4 || payload.steps.some((step) => step.ok !== true)) {
    throw new Error(`Unexpected batch result: ${JSON.stringify(payload)}`);
  }
  await expectGetValue(runCliJson, ["get", "text", "#status", "--tab", target, "--json"], "Submitted batch@example.test Nikita Ship it agreed pro");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}
