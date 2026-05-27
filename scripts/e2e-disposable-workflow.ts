import { createServer as createHttpServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";

type CliJsonRunner = <T>(args: readonly string[]) => Promise<T>;

type TabListPayload = {
  readonly tabs?: readonly {
    readonly id?: number;
    readonly url?: string;
  }[];
};

type SnapshotPayload = {
  readonly generationId?: string;
  readonly text?: string;
};

type ActionPayload = {
  readonly action?: string;
  readonly ok?: boolean;
  readonly valueLength?: number;
  readonly selectedValues?: readonly string[];
};

type GetPayload = {
  readonly value?: unknown;
};

type IsPayload = {
  readonly value?: boolean;
};

type WaitPayload = {
  readonly matched?: boolean;
};

type EvalPayload = {
  readonly value?: {
    readonly type?: string;
    readonly value?: unknown;
  };
};

type ScreenshotPayload = {
  readonly path?: string;
  readonly bytes?: number;
};

type BatchPayload = {
  readonly ok?: boolean;
  readonly steps?: readonly {
    readonly ok?: boolean;
    readonly command?: string;
  }[];
};

export async function startWorkflowFixtureServer(): Promise<{
  readonly server: Server;
  readonly url: string;
}> {
  const server = createHttpServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html>
        <head>
          <title>firefox-cli disposable E2E</title>
          <style>
            #feed { height: 80px; overflow: auto; border: 1px solid #999; }
            #feed-inner { height: 400px; padding-top: 260px; }
          </style>
        </head>
        <body>
          <main>
            <h1>Disposable Firefox E2E</h1>
            <label>Email <input id="email" type="email" autocomplete="off"></label>
            <label>Name <input id="name" autocomplete="off"></label>
            <label>Notes <textarea id="notes"></textarea></label>
            <label><input id="agree" type="checkbox"> Accept terms</label>
            <label>Plan
              <select id="plan">
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="team">Team</option>
              </select>
            </label>
            <button id="submit" type="button">Submit E2E</button>
            <div id="status" role="status">Idle</div>
            <div id="feed" role="region" aria-label="Activity feed">
              <div id="feed-inner"><button id="feed-bottom">Feed bottom</button></div>
            </div>
          </main>
          <script>
            const submit = () => {
              document.body.dataset.submits = String(Number(document.body.dataset.submits || "0") + 1);
              document.querySelector("#status").textContent = [
                "Submitted",
                document.querySelector("#email").value,
                document.querySelector("#name").value,
                document.querySelector("#notes").value,
                document.querySelector("#agree").checked ? "agreed" : "not-agreed",
                document.querySelector("#plan").value
              ].join(" ");
            };
            document.querySelector("#submit").addEventListener("click", submit);
          </script>
        </body>
      </html>`);
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port.");
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/`,
  };
}

export async function runAgentWorkflowE2e(
  runCliJson: CliJsonRunner,
  fixtureUrl: string,
): Promise<void> {
  await runCliJson(["window", "new", fixtureUrl, "--json"]);
  const tab = await waitForFixtureTab(runCliJson, fixtureUrl);
  const target = `id:${tab.id}`;

  const snapshot = await runCliJson<SnapshotPayload>(["snapshot", "--tab", target, "-i", "--json"]);
  if (snapshot.generationId === undefined || snapshot.text === undefined) {
    throw new Error(`Snapshot response was missing generation/text: ${JSON.stringify(snapshot)}`);
  }
  const ref = refForSnapshotText(snapshot.text, "Submit E2E");
  if (ref === undefined) {
    throw new Error(`Snapshot did not contain a Submit E2E ref: ${snapshot.text}`);
  }

  await expectGetValue(
    runCliJson,
    ["get", "text", ref, "--generation", snapshot.generationId, "--tab", target, "--json"],
    "Submit E2E",
  );

  await expectAction(
    runCliJson,
    ["fill", "#email", "user@example.test", "--tab", target, "--json"],
    {
      action: "fill",
      valueLength: 17,
    },
  );
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
  const select = await expectAction(
    runCliJson,
    ["select", "--tab", target, "--json", "#plan", "pro"],
    { action: "select" },
  );
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
  await expectWait(runCliJson, [
    "wait",
    "--text",
    "Submitted user@example.test",
    "--tab",
    target,
    "--timeout",
    "5000",
    "--json",
  ]);
  await expectGetValue(
    runCliJson,
    ["get", "text", "#status", "--tab", target, "--json"],
    "Submitted user@example.test Nikita Ship it agreed pro",
  );

  await expectEvalState(runCliJson, target);
  await expectScreenshot(runCliJson, target);
  await expectBatch(runCliJson, target);
}

async function waitForFixtureTab(
  runCliJson: CliJsonRunner,
  fixtureUrl: string,
): Promise<{ readonly id: number }> {
  return pollUntil(
    async () => {
      const payload = await runCliJson<TabListPayload>(["tab", "--json"]);
      const tab = payload.tabs?.find(
        (candidate) => typeof candidate.id === "number" && candidate.url?.startsWith(fixtureUrl),
      );
      return tab?.id === undefined ? false : { id: tab.id };
    },
    {
      timeoutMs: 15_000,
      intervalMs: 250,
      timeoutMessage: () => "Timed out waiting for fixture tab in disposable Firefox.",
    },
  );
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
    throw new Error(
      `Expected ${expected.action} valueLength=${expected.valueLength}, got ${JSON.stringify(
        payload,
      )}`,
    );
  }
  return payload;
}

function refForSnapshotText(text: string, label: string): string | undefined {
  return text
    .split("\n")
    .find((line) => line.includes(label))
    ?.match(/@e\d+/u)?.[0];
}

async function expectGetValue(
  runCliJson: CliJsonRunner,
  args: readonly string[],
  expected: unknown,
): Promise<void> {
  const payload = await runCliJson<GetPayload>(args);
  if (payload.value !== expected) {
    throw new Error(`Expected get value ${String(expected)}, got ${JSON.stringify(payload)}`);
  }
}

async function expectBoolean(
  runCliJson: CliJsonRunner,
  args: readonly string[],
  expected: boolean,
): Promise<void> {
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
  const payload = await runCliJson<ScreenshotPayload>([
    "screenshot",
    screenshotPath,
    "--tab",
    target,
    "--json",
  ]);
  const file = await stat(screenshotPath);
  if (payload.path !== screenshotPath || payload.bytes !== file.size || file.size <= 0) {
    throw new Error(`Unexpected screenshot result: ${JSON.stringify(payload)} size=${file.size}`);
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
  if (
    payload.ok !== true ||
    payload.steps?.length !== 4 ||
    payload.steps.some((step) => step.ok !== true)
  ) {
    throw new Error(`Unexpected batch result: ${JSON.stringify(payload)}`);
  }
  await expectGetValue(
    runCliJson,
    ["get", "text", "#status", "--tab", target, "--json"],
    "Submitted batch@example.test Nikita Ship it agreed pro",
  );
}

async function pollUntil<T>(
  check: () => Promise<T | false>,
  options: {
    readonly timeoutMs: number;
    readonly intervalMs: number;
    readonly timeoutMessage: () => string;
  },
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    const value = await check();
    if (value !== false) {
      return value;
    }
    await sleep(options.intervalMs);
  }

  throw new Error(options.timeoutMessage());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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
