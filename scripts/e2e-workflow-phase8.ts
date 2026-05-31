import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import type { CliJsonRunner } from "./e2e-disposable-workflow.js";

interface ActionPayload {
  readonly action?: string;
  readonly ok?: boolean;
  readonly valueLength?: number;
}

interface GetPayload {
  readonly value?: unknown;
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

interface FindPayload {
  readonly elements?: readonly unknown[];
}

interface FramePayload {
  readonly frames?: readonly unknown[];
}

interface DownloadPayload {
  readonly id?: number;
}

interface ClipboardPayload {
  readonly ok?: boolean;
  readonly text?: string;
}

interface CookiePayload {
  readonly ok?: boolean;
  readonly cookie?: unknown;
}

interface StoragePayload {
  readonly ok?: boolean;
  readonly value?: string | null;
}

interface NetworkPayload {
  readonly ok?: boolean;
  readonly requests?: readonly { readonly url?: string }[];
}

interface DiffPayload {
  readonly matches?: boolean;
}

interface ViewportPayload {
  readonly window?: {
    readonly width?: number;
    readonly height?: number;
  };
}

interface CapabilitiesPayload {
  readonly capabilities?: readonly {
    readonly command?: string;
    readonly status?: string;
  }[];
}

export async function expectPhase8Commands(runCliJson: CliJsonRunner, target: string, fixtureUrl: string): Promise<void> {
  await expectCapabilities(runCliJson, ["drag", "download", "network", "set.viewport"]);
  await expectNetworkClear(runCliJson);
  await expectAction(runCliJson, ["drag", "#drag-source", "#drop-target", "--tab", target, "--json"], {
    action: "drag",
  });
  await expectEvalValue(runCliJson, target, "document.body.dataset.dropped", "true");

  const uploadDir = await createTempDir("firefox-cli-e2e-upload");
  const uploadPath = join(uploadDir, "fixture-upload.txt");
  await writeFile(uploadPath, "upload fixture\n");
  await expectAction(runCliJson, ["upload", "#upload", uploadPath, "--tab", target, "--json"], {
    action: "upload",
    valueLength: 1,
  });
  await expectGetValue(runCliJson, ["get", "text", "#upload-status", "--tab", target, "--json"], "fixture-upload.txt");

  await expectPointerAndKeyboard(runCliJson, target);
  await expectFindAndFrame(runCliJson, target);
  await expectJpegScreenshot(runCliJson, target);
  await expectDownload(runCliJson, fixtureUrl);
  await expectClipboard(runCliJson);
  await expectCookies(runCliJson, fixtureUrl);
  await expectStorage(runCliJson, target);
  await expectNetworkCapture(runCliJson, target, fixtureUrl);
  await expectHighlight(runCliJson, target);
  await expectDiff(runCliJson, target, fixtureUrl);
  await expectViewport(runCliJson, target);
}

async function expectPointerAndKeyboard(runCliJson: CliJsonRunner, target: string): Promise<void> {
  await expectAction(runCliJson, ["mouse", "down", "#mouse-target", "--tab", target, "--json"], {
    action: "mouse",
  });
  await expectAction(runCliJson, ["mouse", "wheel", "#mouse-target", "--delta-y", "120", "--tab", target, "--json"], {
    action: "mouse",
  });
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
}

async function expectFindAndFrame(runCliJson: CliJsonRunner, target: string): Promise<void> {
  const find = await runCliJson<FindPayload>(["find", "testid", "highlight-target", "--first", "--tab", target, "--json"]);
  if (find.elements?.length !== 1) {
    throw new Error(`Expected find to return one element, got ${JSON.stringify(find)}`);
  }
  const frame = await runCliJson<FramePayload>(["frame", "--tab", target, "--json"]);
  if (frame.frames?.length !== 1) {
    throw new Error(`Expected frame to list one iframe, got ${JSON.stringify(frame)}`);
  }
}

async function expectJpegScreenshot(runCliJson: CliJsonRunner, target: string): Promise<void> {
  const jpegDir = await createTempDir("firefox-cli-e2e-jpeg");
  const jpegPath = join(jpegDir, "page.jpg");
  const jpeg = await runCliJson<ScreenshotPayload>(["screenshot", jpegPath, "--format", "jpeg", "--screenshot-quality", "80", "--tab", target, "--json"]);
  const jpegFile = await readFile(jpegPath);
  if (jpeg.path !== jpegPath || jpeg.bytes !== jpegFile.length || !isJpeg(jpegFile)) {
    throw new Error(`Unexpected JPEG screenshot result: ${JSON.stringify(jpeg)}`);
  }
}

async function expectDownload(runCliJson: CliJsonRunner, fixtureUrl: string): Promise<void> {
  const download = await runCliJson<DownloadPayload>(["download", `${fixtureUrl}download.txt`, "--json"]);
  if (typeof download.id !== "number") {
    throw new Error(`Expected download id, got ${JSON.stringify(download)}`);
  }
  await expectWait(runCliJson, ["wait", "--download", String(download.id), "--timeout", "5000", "--json"]);
}

async function expectClipboard(runCliJson: CliJsonRunner): Promise<void> {
  const clipboardWrite = await runCliJson<ClipboardPayload>(["clipboard", "write", "clipboard-e2e", "--json"]);
  const clipboardRead = await runCliJson<ClipboardPayload>(["clipboard", "read", "--json"]);
  if (clipboardWrite.ok !== true || clipboardRead.text !== "clipboard-e2e") {
    throw new Error(`Unexpected clipboard roundtrip: write=${JSON.stringify(clipboardWrite)} read=${JSON.stringify(clipboardRead)}`);
  }
}

async function expectCookies(runCliJson: CliJsonRunner, fixtureUrl: string): Promise<void> {
  const cookieSet = await runCliJson<CookiePayload>(["cookies", "set", fixtureUrl, "phase8", "yes", "--json"]);
  const cookieGet = await runCliJson<CookiePayload>(["cookies", "get", fixtureUrl, "phase8", "--json"]);
  if (cookieSet.ok !== true || cookieGet.cookie === null || cookieGet.cookie === undefined) {
    throw new Error(`Unexpected cookie roundtrip: set=${JSON.stringify(cookieSet)} get=${JSON.stringify(cookieGet)}`);
  }
}

async function expectStorage(runCliJson: CliJsonRunner, target: string): Promise<void> {
  const storageSet = await runCliJson<StoragePayload>(["storage", "local", "set", "phase8", "yes", "--tab", target, "--json"]);
  const storageGet = await runCliJson<StoragePayload>(["storage", "local", "get", "phase8", "--tab", target, "--json"]);
  if (storageSet.ok !== true || storageGet.value !== "yes") {
    throw new Error(`Unexpected storage roundtrip: set=${JSON.stringify(storageSet)} get=${JSON.stringify(storageGet)}`);
  }
}

async function expectNetworkCapture(runCliJson: CliJsonRunner, target: string, fixtureUrl: string): Promise<void> {
  await expectNetworkClear(runCliJson);
  await runCliJson<EvalPayload>(["eval", `fetch(${JSON.stringify(`${fixtureUrl}api/ping`)}).then((response) => response.json())`, "--tab", target, "--json"]);
  await expectWait(runCliJson, ["wait", "--load", "networkidle", "--tab", target, "--timeout", "5000", "--json"]);
  const network = await runCliJson<NetworkPayload>(["network", "list", "--url", `${fixtureUrl}api/ping`, "--json"]);
  if (network.requests?.some((request) => request.url?.includes("/api/ping")) !== true) {
    throw new Error(`Expected network log to contain api/ping, got ${JSON.stringify(network)}`);
  }
}

async function expectHighlight(runCliJson: CliJsonRunner, target: string): Promise<void> {
  await runCliJson(["console", "clear", "--tab", target, "--json"]);
  await runCliJson(["errors", "clear", "--tab", target, "--json"]);
  const highlight = await runCliJson<{ readonly ok?: boolean }>(["highlight", "#highlight-target", "--tab", target, "--json"]);
  if (highlight.ok !== true) {
    throw new Error(`Unexpected highlight result: ${JSON.stringify(highlight)}`);
  }
  await expectEvalValue(runCliJson, target, `document.querySelector("#highlight-target").dataset.firefoxCliHighlight`, "true");
}

async function expectDiff(runCliJson: CliJsonRunner, target: string, fixtureUrl: string): Promise<void> {
  const urlDiff = await runCliJson<DiffPayload>(["diff", "url", fixtureUrl, "--tab", target, "--json"]);
  const titleDiff = await runCliJson<DiffPayload>(["diff", "title", "firefox-cli disposable E2E", "--tab", target, "--json"]);
  if (urlDiff.matches !== true || titleDiff.matches !== true) {
    throw new Error(`Unexpected diff results: url=${JSON.stringify(urlDiff)} title=${JSON.stringify(titleDiff)}`);
  }
}

async function expectViewport(runCliJson: CliJsonRunner, target: string): Promise<void> {
  const viewport = await runCliJson<ViewportPayload>(["set", "viewport", "1000", "700", "--tab", target, "--json"]);
  if (typeof viewport.window?.width !== "number" || typeof viewport.window.height !== "number") {
    throw new Error(`Unexpected viewport result: ${JSON.stringify(viewport)}`);
  }
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

async function expectGetValue(runCliJson: CliJsonRunner, args: readonly string[], expected: unknown): Promise<void> {
  const payload = await runCliJson<GetPayload>(args);
  if (payload.value !== expected) {
    throw new Error(`Expected get value ${String(expected)}, got ${JSON.stringify(payload)}`);
  }
}

async function expectWait(runCliJson: CliJsonRunner, args: readonly string[]): Promise<void> {
  const payload = await runCliJson<WaitPayload>(args);
  if (payload.matched !== true) {
    throw new Error(`Expected wait match, got ${JSON.stringify(payload)}`);
  }
}

async function expectEvalValue(runCliJson: CliJsonRunner, target: string, expression: string, expected: unknown): Promise<void> {
  const payload = await runCliJson<EvalPayload>(["eval", expression, "--tab", target, "--json"]);
  const value = payload.value?.value;
  if (payload.value?.type !== "json" || !deepEqual(value, expected)) {
    throw new Error(`Expected eval ${expression} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(payload)}`);
  }
}

async function expectCapabilities(runCliJson: CliJsonRunner, commands: readonly string[]): Promise<void> {
  const payload = await runCliJson<CapabilitiesPayload>(["capabilities", "--json"]);
  const capabilities = new Map(payload.capabilities?.map((capability) => [capability.command, capability.status]) ?? []);
  const missing = commands.filter((command) => capabilities.get(command) !== "mvp");
  if (missing.length > 0) {
    throw new Error(`Disposable Firefox capabilities were missing Phase 8 commands ${missing.join(", ")}: ${JSON.stringify(payload)}`);
  }
}

async function expectNetworkClear(runCliJson: CliJsonRunner): Promise<void> {
  const payload = await runCliJson<NetworkPayload>(["network", "clear", "--json"]);
  if (payload.ok !== true) {
    throw new Error(`Expected network clear success, got ${JSON.stringify(payload)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}
