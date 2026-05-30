import { createServer as createHttpServer, type Server } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { pollUntil } from "./script-timing.js";

type CliJsonRunner = <T>(args: readonly string[]) => Promise<T>;

type TabListPayload = {
  readonly tabs?: readonly {
    readonly id?: number;
    readonly url?: string;
  }[];
};

type TabNewPayload = {
  readonly target?: {
    readonly tabId?: number;
  };
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

type FindPayload = {
  readonly elements?: readonly unknown[];
};

type FramePayload = {
  readonly frames?: readonly unknown[];
};

type DownloadPayload = {
  readonly id?: number;
};

type ClipboardPayload = {
  readonly ok?: boolean;
  readonly text?: string;
};

type CookiePayload = {
  readonly ok?: boolean;
  readonly cookie?: unknown;
  readonly cookies?: readonly unknown[];
};

type StoragePayload = {
  readonly ok?: boolean;
  readonly value?: string | null;
  readonly entries?: Record<string, string>;
};

type NetworkPayload = {
  readonly ok?: boolean;
  readonly requests?: readonly { readonly url?: string }[];
};

type DiffPayload = {
  readonly matches?: boolean;
};

type ViewportPayload = {
  readonly window?: {
    readonly width?: number;
    readonly height?: number;
  };
};

type CapabilitiesPayload = {
  readonly capabilities?: readonly {
    readonly command?: string;
    readonly status?: string;
  }[];
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
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/download.txt") {
      response.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": 'attachment; filename="download.txt"',
      });
      response.end("firefox-cli download fixture\n");
      return;
    }
    if (url.pathname === "/api/ping") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/frame") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Child frame</title><p>Frame fixture</p>");
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html>
        <head>
          <title>firefox-cli disposable E2E</title>
          <style>
            #feed { height: 80px; overflow: auto; border: 1px solid #999; }
            #feed-inner { height: 400px; padding-top: 260px; }
            #drop-target, #mouse-target { min-height: 24px; border: 1px solid #999; margin: 8px 0; }
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
            <button id="drag-source" type="button">Drag source</button>
            <div id="drop-target" data-testid="drop-zone">Drop target</div>
            <label>Upload <input id="upload" type="file"></label>
            <div id="upload-status">No upload</div>
            <input id="key-target" aria-label="Key target">
            <div id="mouse-target">Mouse target</div>
            <input id="clipboard-target" value="copy-source">
            <button id="highlight-target" type="button" data-testid="highlight-target">Highlight target</button>
            <iframe title="Child frame" src="/frame"></iframe>
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
            document.querySelector("#drop-target").addEventListener("drop", (event) => {
              event.preventDefault();
              document.body.dataset.dropped = "true";
            });
            document.querySelector("#drop-target").addEventListener("dragover", (event) => event.preventDefault());
            document.querySelector("#upload").addEventListener("change", (event) => {
              document.querySelector("#upload-status").textContent = event.target.files[0]?.name || "missing";
            });
            document.querySelector("#mouse-target").addEventListener("mousedown", () => {
              document.body.dataset.mouseDown = "true";
            });
            document.querySelector("#mouse-target").addEventListener("wheel", () => {
              document.body.dataset.mouseWheel = "true";
            });
            document.querySelector("#key-target").addEventListener("keydown", (event) => {
              document.body.dataset.keyDown = event.key;
            });
            document.querySelector("#key-target").addEventListener("keyup", (event) => {
              document.body.dataset.keyUp = event.key;
            });
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
  const beforeTabs = await runCliJson<TabListPayload>(["tab", "--json"]).catch(() => ({
    tabs: [],
  }));
  const previousTabIds = new Set(
    beforeTabs.tabs
      ?.map((candidate) => candidate.id)
      .filter((id): id is number => typeof id === "number") ?? [],
  );
  const created = await runCliJson<TabNewPayload>(["window", "new", fixtureUrl, "--json"]);
  const tab =
    created.target?.tabId === undefined
      ? await waitForFixtureTab(runCliJson, fixtureUrl, previousTabIds)
      : { id: created.target.tabId };
  const target = `id:${tab.id}`;
  await runCliJson(["reload", "--tab", target, "--json"]);
  await expectWait(runCliJson, [
    "wait",
    "--load",
    "complete",
    "--tab",
    target,
    "--timeout",
    "5000",
    "--json",
  ]);

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
    throw new Error(
      `Expected ${expected.action} valueLength=${expected.valueLength}, got ${JSON.stringify(
        payload,
      )}`,
    );
  }
  return payload;
}

async function waitForFixtureTab(
  runCliJson: CliJsonRunner,
  fixtureUrl: string,
  excludedTabIds: ReadonlySet<number>,
): Promise<{ readonly id: number }> {
  return pollUntil(
    async () => {
      const payload = await runCliJson<TabListPayload>(["tab", "--json"]);
      const tab = payload.tabs?.find(
        (candidate) =>
          typeof candidate.id === "number" &&
          !excludedTabIds.has(candidate.id) &&
          candidate.url?.startsWith(fixtureUrl),
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

async function expectEvalValue(
  runCliJson: CliJsonRunner,
  target: string,
  expression: string,
  expected: unknown,
): Promise<void> {
  const payload = await runCliJson<EvalPayload>(["eval", expression, "--tab", target, "--json"]);
  const value = payload.value?.value;
  if (payload.value?.type !== "json" || !deepEqual(value, expected)) {
    throw new Error(
      `Expected eval ${expression} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(
        payload,
      )}`,
    );
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

async function expectPhase8Commands(
  runCliJson: CliJsonRunner,
  target: string,
  fixtureUrl: string,
): Promise<void> {
  await expectCapabilities(runCliJson, ["drag", "download", "network", "set.viewport"]);
  await expectNetworkClear(runCliJson);
  await expectAction(
    runCliJson,
    ["drag", "#drag-source", "#drop-target", "--tab", target, "--json"],
    {
      action: "drag",
    },
  );
  await expectEvalValue(runCliJson, target, "document.body.dataset.dropped", "true");

  const uploadDir = await createTempDir("firefox-cli-e2e-upload");
  const uploadPath = join(uploadDir, "fixture-upload.txt");
  await writeFile(uploadPath, "upload fixture\n");
  await expectAction(runCliJson, ["upload", "#upload", uploadPath, "--tab", target, "--json"], {
    action: "upload",
    valueLength: 1,
  });
  await expectGetValue(
    runCliJson,
    ["get", "text", "#upload-status", "--tab", target, "--json"],
    "fixture-upload.txt",
  );

  await expectAction(runCliJson, ["mouse", "down", "#mouse-target", "--tab", target, "--json"], {
    action: "mouse",
  });
  await expectAction(
    runCliJson,
    ["mouse", "wheel", "#mouse-target", "--delta-y", "120", "--tab", target, "--json"],
    { action: "mouse" },
  );
  await expectAction(runCliJson, ["keydown", "A", "#key-target", "--tab", target, "--json"], {
    action: "keydown",
  });
  await expectAction(runCliJson, ["keyup", "A", "#key-target", "--tab", target, "--json"], {
    action: "keyup",
  });
  await expectEvalValue(
    runCliJson,
    target,
    `({
      mouseDown: document.body.dataset.mouseDown,
      mouseWheel: document.body.dataset.mouseWheel,
      keyDown: document.body.dataset.keyDown,
      keyUp: document.body.dataset.keyUp
    })`,
    { mouseDown: "true", mouseWheel: "true", keyDown: "A", keyUp: "A" },
  );

  const find = await runCliJson<FindPayload>([
    "find",
    "testid",
    "highlight-target",
    "--first",
    "--tab",
    target,
    "--json",
  ]);
  if (find.elements?.length !== 1) {
    throw new Error(`Expected find to return one element, got ${JSON.stringify(find)}`);
  }
  const frame = await runCliJson<FramePayload>(["frame", "--tab", target, "--json"]);
  if (frame.frames?.length !== 1) {
    throw new Error(`Expected frame to list one iframe, got ${JSON.stringify(frame)}`);
  }

  const jpegDir = await createTempDir("firefox-cli-e2e-jpeg");
  const jpegPath = join(jpegDir, "page.jpg");
  const jpeg = await runCliJson<ScreenshotPayload>([
    "screenshot",
    jpegPath,
    "--format",
    "jpeg",
    "--screenshot-quality",
    "80",
    "--tab",
    target,
    "--json",
  ]);
  const jpegFile = await readFile(jpegPath);
  if (jpeg.path !== jpegPath || jpeg.bytes !== jpegFile.length || !isJpeg(jpegFile)) {
    throw new Error(`Unexpected JPEG screenshot result: ${JSON.stringify(jpeg)}`);
  }

  const download = await runCliJson<DownloadPayload>([
    "download",
    `${fixtureUrl}download.txt`,
    "--json",
  ]);
  if (typeof download.id !== "number") {
    throw new Error(`Expected download id, got ${JSON.stringify(download)}`);
  }
  await expectWait(runCliJson, [
    "wait",
    "--download",
    String(download.id),
    "--timeout",
    "5000",
    "--json",
  ]);

  const clipboardWrite = await runCliJson<ClipboardPayload>([
    "clipboard",
    "write",
    "clipboard-e2e",
    "--json",
  ]);
  const clipboardRead = await runCliJson<ClipboardPayload>(["clipboard", "read", "--json"]);
  if (clipboardWrite.ok !== true || clipboardRead.text !== "clipboard-e2e") {
    throw new Error(
      `Unexpected clipboard roundtrip: write=${JSON.stringify(
        clipboardWrite,
      )} read=${JSON.stringify(clipboardRead)}`,
    );
  }

  const cookieSet = await runCliJson<CookiePayload>([
    "cookies",
    "set",
    fixtureUrl,
    "phase8",
    "yes",
    "--json",
  ]);
  const cookieGet = await runCliJson<CookiePayload>([
    "cookies",
    "get",
    fixtureUrl,
    "phase8",
    "--json",
  ]);
  if (cookieSet.ok !== true || cookieGet.cookie === null || cookieGet.cookie === undefined) {
    throw new Error(
      `Unexpected cookie roundtrip: set=${JSON.stringify(cookieSet)} get=${JSON.stringify(cookieGet)}`,
    );
  }

  const storageSet = await runCliJson<StoragePayload>([
    "storage",
    "local",
    "set",
    "phase8",
    "yes",
    "--tab",
    target,
    "--json",
  ]);
  const storageGet = await runCliJson<StoragePayload>([
    "storage",
    "local",
    "get",
    "phase8",
    "--tab",
    target,
    "--json",
  ]);
  if (storageSet.ok !== true || storageGet.value !== "yes") {
    throw new Error(
      `Unexpected storage roundtrip: set=${JSON.stringify(
        storageSet,
      )} get=${JSON.stringify(storageGet)}`,
    );
  }

  await expectNetworkClear(runCliJson);
  await runCliJson<EvalPayload>([
    "eval",
    `fetch(${JSON.stringify(`${fixtureUrl}api/ping`)}).then((response) => response.json())`,
    "--tab",
    target,
    "--json",
  ]);
  await expectWait(runCliJson, [
    "wait",
    "--load",
    "networkidle",
    "--tab",
    target,
    "--timeout",
    "5000",
    "--json",
  ]);
  const network = await runCliJson<NetworkPayload>([
    "network",
    "list",
    "--url",
    `${fixtureUrl}api/ping`,
    "--json",
  ]);
  if (network.requests?.some((request) => request.url?.includes("/api/ping")) !== true) {
    throw new Error(`Expected network log to contain api/ping, got ${JSON.stringify(network)}`);
  }

  await runCliJson(["console", "clear", "--tab", target, "--json"]);
  await runCliJson(["errors", "clear", "--tab", target, "--json"]);
  const highlight = await runCliJson<{ readonly ok?: boolean }>([
    "highlight",
    "#highlight-target",
    "--tab",
    target,
    "--json",
  ]);
  if (highlight.ok !== true) {
    throw new Error(`Unexpected highlight result: ${JSON.stringify(highlight)}`);
  }
  await expectEvalValue(
    runCliJson,
    target,
    `document.querySelector("#highlight-target").dataset.firefoxCliHighlight`,
    "true",
  );

  const urlDiff = await runCliJson<DiffPayload>([
    "diff",
    "url",
    fixtureUrl,
    "--tab",
    target,
    "--json",
  ]);
  const titleDiff = await runCliJson<DiffPayload>([
    "diff",
    "title",
    "firefox-cli disposable E2E",
    "--tab",
    target,
    "--json",
  ]);
  if (urlDiff.matches !== true || titleDiff.matches !== true) {
    throw new Error(
      `Unexpected diff results: url=${JSON.stringify(urlDiff)} title=${JSON.stringify(titleDiff)}`,
    );
  }

  const viewport = await runCliJson<ViewportPayload>([
    "set",
    "viewport",
    "1000",
    "700",
    "--tab",
    target,
    "--json",
  ]);
  if (typeof viewport.window?.width !== "number" || typeof viewport.window.height !== "number") {
    throw new Error(`Unexpected viewport result: ${JSON.stringify(viewport)}`);
  }
}

async function expectCapabilities(
  runCliJson: CliJsonRunner,
  commands: readonly string[],
): Promise<void> {
  const payload = await runCliJson<CapabilitiesPayload>(["capabilities", "--json"]);
  const capabilities = new Map(
    payload.capabilities?.map((capability) => [capability.command, capability.status]) ?? [],
  );
  const missing = commands.filter((command) => capabilities.get(command) !== "mvp");
  if (missing.length > 0) {
    throw new Error(
      `Disposable Firefox capabilities were missing Phase 8 commands ${missing.join(
        ", ",
      )}: ${JSON.stringify(payload)}`,
    );
  }
}

async function expectNetworkClear(runCliJson: CliJsonRunner): Promise<void> {
  const payload = await runCliJson<NetworkPayload>(["network", "clear", "--json"]);
  if (payload.ok !== true) {
    throw new Error(`Expected network clear success, got ${JSON.stringify(payload)}`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
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

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}
