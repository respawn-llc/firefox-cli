import {
  MAX_BATCH_RESULT_BYTES,
  MAX_SCREENSHOT_BYTES,
  MAX_EVAL_RESULT_BYTES,
  createErrorResponse,
  createOkResponse,
  type BatchResult,
  type BatchStepResult,
  type ClipboardResult,
  type ConsoleResult,
  type CookieResult,
  type DialogResult,
  type DiffResult,
  type DownloadResult,
  type ErrorsResult,
  type FindResult,
  type FrameResult,
  type HighlightResult,
  type ActionResult,
  type ActionKind,
  type CommandId,
  type EvalResult,
  type GetResult,
  type IsResult,
  type RefResolveResult,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ResolvedTarget,
  type ScreenshotResult,
  type SetViewportResult,
  type StorageResult,
  type NetworkResult,
  type SnapshotResult,
  type TabSummary,
  type TargetSelector,
  type WaitResult,
  type WindowSummary,
  parseBoundaryResponse,
} from "@firefox-cli/protocol";
import { isActionCommand } from "./action-commands.js";
import type { EvalExecutorPayload, EvalExecutorResult } from "./eval-executor.js";

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_INTERVAL_MS = 100;
const DEFAULT_EVAL_TIMEOUT_MS = 30_000;
const DEFAULT_SCREENSHOT_TIMEOUT_MS = 30_000;

export type BrowserWindowSnapshot = {
  readonly id: number;
  readonly focused: boolean;
  readonly private?: boolean;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
  readonly tabs: readonly TabSummary[];
};

export type BackgroundBrowserAdapter = {
  listWindows(): Promise<readonly BrowserWindowSnapshot[]>;
  createTab(options: { readonly url?: string; readonly windowId?: number }): Promise<TabSummary>;
  selectTab(tabId: number): Promise<TabSummary>;
  closeTab(tabId: number): Promise<void>;
  createWindow(options: { readonly url?: string }): Promise<BrowserWindowSnapshot>;
  focusWindow(windowId: number): Promise<BrowserWindowSnapshot>;
  closeWindow(windowId: number): Promise<void>;
  navigateTab(tabId: number, url: string): Promise<TabSummary>;
  goBack(tabId: number): Promise<TabSummary>;
  goForward(tabId: number): Promise<TabSummary>;
  reload(tabId: number): Promise<TabSummary>;
  sendContentRequest(tabId: number, request: RequestEnvelope): Promise<unknown>;
  executeEval(tabId: number, payload: EvalExecutorPayload): Promise<EvalExecutorResult>;
  captureVisibleTab(
    windowId: number,
    options: { readonly format: "png" | "jpeg"; readonly quality?: number },
  ): Promise<string>;
  download(options: {
    readonly url: string;
    readonly filename?: string;
    readonly saveAs?: boolean;
  }): Promise<DownloadResult>;
  waitForDownload(options: {
    readonly downloadId?: number;
    readonly filenameGlob?: string;
    readonly timeoutMs: number;
    readonly intervalMs: number;
  }): Promise<DownloadResult>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  listCookies(options: {
    readonly url: string;
    readonly name?: string;
  }): Promise<CookieResult["cookies"]>;
  setCookie(options: {
    readonly url: string;
    readonly name: string;
    readonly value: string;
    readonly domain?: string;
    readonly path?: string;
  }): Promise<NonNullable<CookieResult["cookie"]>>;
  removeCookie(options: { readonly url: string; readonly name: string }): Promise<void>;
  listNetworkRequests(options: {
    readonly urlGlob?: string;
  }): Promise<NonNullable<NetworkResult["requests"]>>;
  clearNetworkRequests(): Promise<void>;
  waitForNetworkIdle(options: {
    readonly timeoutMs: number;
    readonly idleMs: number;
  }): Promise<void>;
  resizeWindow(
    windowId: number,
    size: { readonly width: number; readonly height: number },
  ): Promise<BrowserWindowSnapshot>;
};

type OrderedWindow = BrowserWindowSnapshot & {
  readonly index: number;
  readonly tabs: readonly TabSummary[];
};

type ResolvedBrowserTarget = {
  readonly window: OrderedWindow;
  readonly tab: TabSummary;
  readonly target: ResolvedTarget;
};

export async function handleBrowserRequest(
  request: RequestEnvelope,
  adapter: BackgroundBrowserAdapter,
): Promise<ResponseEnvelope> {
  try {
    return await handleBrowserRequestOrThrow(request, adapter);
  } catch (error) {
    return createErrorResponse(request.id, {
      code: error instanceof BrowserCommandError ? error.code : "PERMISSION_DENIED",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleBrowserRequestOrThrow(
  request: RequestEnvelope,
  adapter: BackgroundBrowserAdapter,
): Promise<ResponseEnvelope> {
  if (request.command === "tabs.list") {
    const command = request as RequestEnvelope<"tabs.list">;
    const windows = await getOrderedWindows(adapter);
    const resolved = resolveTarget(windows, command.params.target, { allowPrivate: true });
    return createOkResponse(command, {
      target: resolved.target,
      tabs: [...resolved.window.tabs],
    });
  }

  if (request.command === "windows.list") {
    const command = request as RequestEnvelope<"windows.list">;
    const windows = await getOrderedWindows(adapter);
    return createOkResponse(command, {
      windows: windows.map(toWindowSummary),
    });
  }

  if (request.command === "tab.new") {
    const command = request as RequestEnvelope<"tab.new">;
    const windows = await getOrderedWindows(adapter);
    const window = resolveWindow(windows, command.params.target?.window);
    assertMutableWindow(window);
    const tab = await adapter.createTab({
      ...(command.params.url === undefined ? {} : { url: command.params.url }),
      windowId: window.id,
    });
    return createOkResponse(command, {
      target: await resolveFreshTarget(adapter, { tab: { kind: "id", id: tab.id } }),
    });
  }

  if (request.command === "tab.select") {
    const command = request as RequestEnvelope<"tab.select">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    await adapter.selectTab(resolved.tab.id);
    return createOkResponse(command, {
      target: await resolveFreshTarget(adapter, { tab: { kind: "id", id: resolved.tab.id } }),
    });
  }

  if (request.command === "tab.close") {
    const command = request as RequestEnvelope<"tab.close">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    await adapter.closeTab(resolved.tab.id);
    const nextWindow = findWindowById(await getOrderedWindows(adapter), resolved.window.id);
    return createOkResponse(command, {
      closedTabId: resolved.tab.id,
      ...(nextWindow?.tabs.find((tab) => tab.active)?.id === undefined
        ? {}
        : { nextActiveTabId: nextWindow.tabs.find((tab) => tab.active)?.id }),
    });
  }

  if (request.command === "window.new") {
    const command = request as RequestEnvelope<"window.new">;
    const createdWindow = await adapter.createWindow({
      ...(command.params.url === undefined ? {} : { url: command.params.url }),
    });
    const window = toOrderedWindows([createdWindow])[0];
    if (window === undefined) {
      throw new BrowserCommandError("INVALID_TARGET", "Firefox did not return the created window.");
    }
    return createOkResponse(command, {
      window: toWindowSummary(window),
      ...(window.tabs[0] === undefined ? {} : { target: toResolvedTarget(window, window.tabs[0]) }),
    });
  }

  if (request.command === "window.select") {
    const command = request as RequestEnvelope<"window.select">;
    const window = resolveWindow(await getOrderedWindows(adapter), command.params.target.window);
    assertMutableWindow(window);
    await adapter.focusWindow(window.id);
    const focusedWindow = resolveWindow(await getOrderedWindows(adapter), {
      kind: "id",
      id: window.id,
    });
    const activeTab = focusedWindow.tabs.find((tab) => tab.active);
    return createOkResponse(command, {
      window: toWindowSummary(focusedWindow),
      ...(activeTab === undefined ? {} : { target: toResolvedTarget(focusedWindow, activeTab) }),
    });
  }

  if (request.command === "window.close") {
    const command = request as RequestEnvelope<"window.close">;
    const window = resolveWindow(await getOrderedWindows(adapter), command.params.target.window);
    assertMutableWindow(window);
    await adapter.closeWindow(window.id);
    return createOkResponse(command, { closedWindowId: window.id });
  }

  if (request.command === "open") {
    const command = request as RequestEnvelope<"open">;
    if (command.params.newTab) {
      const windows = await getOrderedWindows(adapter);
      const window = resolveWindow(windows, command.params.target?.window);
      assertMutableWindow(window);
      const tab = await adapter.createTab({ url: command.params.url, windowId: window.id });
      return createOkResponse(command, {
        target: await resolveFreshTarget(adapter, { tab: { kind: "id", id: tab.id } }),
        url: tab.url ?? command.params.url,
        loadState: "unknown",
      });
    }

    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const tab = await adapter.navigateTab(resolved.tab.id, command.params.url);
    return createOkResponse(command, {
      target: await resolveFreshTarget(adapter, { tab: { kind: "id", id: tab.id } }),
      url: tab.url ?? command.params.url,
      loadState: "unknown",
    });
  }

  if (request.command === "back" || request.command === "forward" || request.command === "reload") {
    const command = request as RequestEnvelope<"back" | "forward" | "reload">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const tab =
      command.command === "back"
        ? await adapter.goBack(resolved.tab.id)
        : command.command === "forward"
          ? await adapter.goForward(resolved.tab.id)
          : await adapter.reload(resolved.tab.id);
    return createOkResponse(command, {
      target: await resolveFreshTarget(adapter, { tab: { kind: "id", id: tab.id } }),
      ...(tab.url === undefined ? {} : { url: tab.url }),
      loadState: "unknown",
    });
  }

  if (request.command === "snapshot") {
    const command = request as RequestEnvelope<"snapshot">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const snapshotResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!snapshotResponse.ok) {
      return createErrorResponse(command.id, snapshotResponse.error);
    }

    const result: SnapshotResult = {
      ...snapshotResponse.result,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  }

  if (request.command === "ref.resolve") {
    const command = request as RequestEnvelope<"ref.resolve">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const refResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!refResponse.ok) {
      return createErrorResponse(command.id, refResponse.error);
    }

    const result: RefResolveResult = {
      ...refResponse.result,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  }

  if (request.command === "get") {
    const command = request as RequestEnvelope<"get">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    if (command.params.kind === "title" || command.params.kind === "url") {
      return createOkResponse(command, {
        kind: command.params.kind,
        value:
          command.params.kind === "title" ? (resolved.tab.title ?? "") : (resolved.tab.url ?? ""),
        target: resolved.target,
      });
    }

    const getResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!getResponse.ok) {
      return createErrorResponse(command.id, getResponse.error);
    }

    const result: GetResult = {
      ...getResponse.result,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  }

  if (request.command === "is") {
    const command = request as RequestEnvelope<"is">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const isResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!isResponse.ok) {
      return createErrorResponse(command.id, isResponse.error);
    }

    const result: IsResult = {
      ...isResponse.result,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  }

  if (request.command === "wait") {
    const command = request as RequestEnvelope<"wait">;
    if (command.params.kind === "ms") {
      const startedAt = Date.now();
      const durationMs = command.params.durationMs ?? 0;
      const timeoutMs = command.params.timeoutMs;
      await delay(Math.min(durationMs, timeoutMs ?? durationMs));
      if (timeoutMs !== undefined && durationMs > timeoutMs) {
        throw new BrowserCommandError(
          "TIMEOUT",
          `Timed out after ${timeoutMs}ms waiting ${durationMs}ms.`,
        );
      }
      return createOkResponse(command, {
        kind: command.params.kind,
        matched: true,
        elapsedMs: Math.max(0, Date.now() - startedAt),
      });
    }

    if (command.params.kind === "download") {
      const startedAt = Date.now();
      const timeoutMs = command.params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
      const download = await adapter.waitForDownload({
        ...(command.params.downloadId === undefined
          ? {}
          : { downloadId: command.params.downloadId }),
        ...(command.params.filenameGlob === undefined
          ? {}
          : { filenameGlob: command.params.filenameGlob }),
        timeoutMs,
        intervalMs: command.params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS,
      });
      return createOkResponse(command, {
        kind: "download",
        matched: true,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        download,
      });
    }

    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    if (command.params.kind === "url") {
      const result = await waitForUrl(adapter, resolved.tab.id, command.params);
      return createOkResponse(command, result);
    }

    if (command.params.kind === "load-state" && command.params.state === "networkidle") {
      const startedAt = Date.now();
      const timeoutMs = command.params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
      await adapter.waitForNetworkIdle({
        timeoutMs,
        idleMs: command.params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS,
      });
      return createOkResponse(command, {
        kind: "load-state",
        matched: true,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        target: resolved.target,
      });
    }

    const waitResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!waitResponse.ok) {
      return createErrorResponse(command.id, waitResponse.error);
    }

    const result: WaitResult = {
      ...waitResponse.result,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  }

  if (request.command === "eval") {
    const command = request as RequestEnvelope<"eval">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    let evalResponse: EvalExecutorResult;
    try {
      evalResponse = await adapter.executeEval(resolved.tab.id, {
        script: command.params.script,
        timeoutMs: command.params.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS,
        maxResultBytes: command.params.maxResultBytes ?? MAX_EVAL_RESULT_BYTES,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BrowserCommandError(
        "SCRIPT_INJECTION_FAILED",
        `Cannot run eval in this tab. Open a normal web page, reload the extension, or choose a different tab. Firefox reported: ${message}`,
      );
    }

    if (!evalResponse.ok) {
      return createErrorResponse(command.id, evalResponse.error);
    }

    const result: EvalResult = {
      value: evalResponse.value,
      elapsedMs: evalResponse.elapsedMs,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  }

  if (request.command === "screenshot") {
    const command = request as RequestEnvelope<"screenshot">;
    if (command.params.fullPage === true) {
      return createErrorResponse(command.id, {
        code: "UNSUPPORTED_CAPABILITY",
        message:
          "Full-page screenshots are unsupported because Firefox WebExtensions expose visible-tab capture only.",
      });
    }
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const tabActivated = !resolved.tab.active;
    const windowFocused = !resolved.window.focused;
    try {
      if (tabActivated) {
        await adapter.selectTab(resolved.tab.id);
      }
      if (windowFocused) {
        await adapter.focusWindow(resolved.window.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BrowserCommandError(
        "CAPTURE_FAILED",
        `Failed to activate screenshot target: ${message}`,
      );
    }

    const target = await resolveFreshTarget(adapter, { tab: { kind: "id", id: resolved.tab.id } });
    let dataUrl: string;
    try {
      dataUrl = await withTimeout(
        adapter.captureVisibleTab(target.windowId, {
          format: command.params.format,
          ...(command.params.quality === undefined ? {} : { quality: command.params.quality }),
        }),
        command.params.timeoutMs ?? DEFAULT_SCREENSHOT_TIMEOUT_MS,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BrowserCommandError(
        error instanceof BrowserCommandError ? error.code : "CAPTURE_FAILED",
        `Failed to capture visible tab screenshot: ${message}`,
      );
    }

    const image = parseImageDataUrl(
      dataUrl,
      command.params.format,
      command.params.maxImageBytes ?? MAX_SCREENSHOT_BYTES,
    );
    const result: ScreenshotResult = {
      path: command.params.path,
      format: command.params.format,
      bytes: image.bytes,
      ...(image.width === undefined ? {} : { width: image.width }),
      ...(image.height === undefined ? {} : { height: image.height }),
      activation: { tabActivated, windowFocused },
      imageBase64: image.base64,
      target,
    };
    return createOkResponse(command, result);
  }

  if (request.command === "find") {
    const command = request as RequestEnvelope<"find">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const findResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!findResponse.ok) {
      return createErrorResponse(command.id, findResponse.error);
    }
    const result: FindResult = { ...findResponse.result, target: resolved.target };
    return createOkResponse(command, result);
  }

  if (request.command === "frame") {
    const command = request as RequestEnvelope<"frame">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const frameResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!frameResponse.ok) {
      return createErrorResponse(command.id, frameResponse.error);
    }
    const result: FrameResult = { ...frameResponse.result, target: resolved.target };
    return createOkResponse(command, result);
  }

  if (request.command === "download") {
    const command = request as RequestEnvelope<"download">;
    const result = await adapter.download({
      url: command.params.url,
      ...(command.params.filename === undefined ? {} : { filename: command.params.filename }),
      ...(command.params.saveAs === undefined ? {} : { saveAs: command.params.saveAs }),
    });
    return createOkResponse(command, result);
  }

  if (request.command === "dialog") {
    const command = request as RequestEnvelope<"dialog">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const dialogResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!dialogResponse.ok) {
      return createErrorResponse(command.id, dialogResponse.error);
    }
    const result: DialogResult = dialogResponse.result;
    return createOkResponse(command, result);
  }

  if (request.command === "clipboard") {
    const command = request as RequestEnvelope<"clipboard">;
    if (command.params.action === "read") {
      const result: ClipboardResult = {
        action: "read",
        ok: true,
        text: await adapter.readClipboard(),
      };
      return createOkResponse(command, result);
    }
    if (command.params.action === "write") {
      await adapter.writeClipboard(command.params.text ?? "");
      return createOkResponse(command, { action: "write", ok: true });
    }
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const contentCommand: RequestEnvelope<"clipboard"> =
      command.params.action === "paste"
        ? {
            ...command,
            params: { ...command.params, text: await adapter.readClipboard() },
          }
        : command;
    const clipboardResponse = await sendContentCommand(adapter, resolved.tab.id, contentCommand);
    if (!clipboardResponse.ok) {
      return createErrorResponse(command.id, clipboardResponse.error);
    }
    if (command.params.action === "copy" && clipboardResponse.result.text !== undefined) {
      await adapter.writeClipboard(clipboardResponse.result.text);
    }
    return createOkResponse(command, clipboardResponse.result);
  }

  if (request.command === "cookies") {
    const command = request as RequestEnvelope<"cookies">;
    if (command.params.action === "set") {
      if (command.params.name === undefined || command.params.value === undefined) {
        throw new BrowserCommandError("INVALID_TARGET", "Cookie set requires name and value.");
      }
      const cookie = await adapter.setCookie({
        url: command.params.url,
        name: command.params.name,
        value: command.params.value,
        ...(command.params.domain === undefined ? {} : { domain: command.params.domain }),
        ...(command.params.path === undefined ? {} : { path: command.params.path }),
      });
      return createOkResponse(command, { action: "set", ok: true, cookie });
    }
    if (command.params.action === "remove") {
      if (command.params.name === undefined) {
        throw new BrowserCommandError("INVALID_TARGET", "Cookie remove requires name.");
      }
      await adapter.removeCookie({ url: command.params.url, name: command.params.name });
      return createOkResponse(command, { action: "remove", ok: true });
    }
    const cookies = await adapter.listCookies({
      url: command.params.url,
      ...(command.params.name === undefined ? {} : { name: command.params.name }),
    });
    return createOkResponse(command, {
      action: command.params.action,
      ok: true,
      ...(command.params.action === "get" ? { cookie: cookies?.[0] ?? null } : { cookies }),
    });
  }

  if (request.command === "storage") {
    const command = request as RequestEnvelope<"storage">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const storageResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!storageResponse.ok) {
      return createErrorResponse(command.id, storageResponse.error);
    }
    const result: StorageResult = storageResponse.result;
    return createOkResponse(command, result);
  }

  if (request.command === "network") {
    const command = request as RequestEnvelope<"network">;
    if (command.params.action === "clear") {
      await adapter.clearNetworkRequests();
      return createOkResponse(command, { action: "clear", ok: true });
    }
    return createOkResponse(command, {
      action: "list",
      ok: true,
      requests: await adapter.listNetworkRequests({
        ...(command.params.urlGlob === undefined ? {} : { urlGlob: command.params.urlGlob }),
      }),
    });
  }

  if (request.command === "console" || request.command === "errors") {
    const command = request as RequestEnvelope<"console" | "errors">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const logResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!logResponse.ok) {
      return createErrorResponse(command.id, logResponse.error);
    }
    return createOkResponse(command, logResponse.result as ConsoleResult | ErrorsResult);
  }

  if (request.command === "highlight") {
    const command = request as RequestEnvelope<"highlight">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const highlightResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!highlightResponse.ok) {
      return createErrorResponse(command.id, highlightResponse.error);
    }
    const result: HighlightResult = { ...highlightResponse.result, target: resolved.target };
    return createOkResponse(command, result);
  }

  if (request.command === "pdf") {
    const command = request as RequestEnvelope<"pdf">;
    return createErrorResponse(command.id, {
      code: "UNSUPPORTED_CAPABILITY",
      message:
        "PDF export is unsupported because Firefox saves PDFs through a browser dialog instead of writing a requested CLI path.",
    });
  }

  if (request.command === "set.viewport") {
    const command = request as RequestEnvelope<"set.viewport">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const window = await adapter.resizeWindow(resolved.window.id, {
      width: command.params.width,
      height: command.params.height,
    });
    const ordered = toOrderedWindows([window])[0];
    if (ordered === undefined) {
      throw new BrowserCommandError("INVALID_TARGET", "Firefox did not return the resized window.");
    }
    const result: SetViewportResult = { window: toWindowSummary(ordered) };
    return createOkResponse(command, result);
  }

  if (request.command === "diff") {
    const command = request as RequestEnvelope<"diff">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const actual =
      command.params.kind === "url"
        ? (resolved.tab.url ?? "")
        : command.params.kind === "title"
          ? (resolved.tab.title ?? "")
          : await snapshotTextForDiff(adapter, resolved.tab.id, command);
    const result: DiffResult = {
      kind: command.params.kind,
      expected: command.params.expected,
      actual,
      matches: actual === command.params.expected,
    };
    return createOkResponse(command, result);
  }

  if (request.command === "batch") {
    const command = request as RequestEnvelope<"batch">;
    const result = await executeBatch(command, adapter);
    return createOkResponse(command, result);
  }

  if (isActionCommand(request.command)) {
    const command = request as RequestEnvelope<ActionKind>;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const actionResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!actionResponse.ok) {
      return createErrorResponse(command.id, actionResponse.error);
    }

    const result: ActionResult = {
      ...actionResponse.result,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  }

  return createErrorResponse(request.id, {
    code: "UNSUPPORTED_CAPABILITY",
    message: `Unsupported browser command: ${request.command}`,
  });
}

async function sendContentCommand<
  C extends Extract<
    CommandId,
    | "snapshot"
    | "ref.resolve"
    | "get"
    | "is"
    | "wait"
    | "find"
    | "frame"
    | "dialog"
    | "clipboard"
    | "storage"
    | "console"
    | "errors"
    | "highlight"
    | "click"
    | "dblclick"
    | "focus"
    | "hover"
    | "fill"
    | "type"
    | "press"
    | "keyboard.type"
    | "keyboard.inserttext"
    | "check"
    | "uncheck"
    | "select"
    | "scroll"
    | "scrollintoview"
    | "swipe"
    | "drag"
    | "upload"
    | "mouse"
    | "keydown"
    | "keyup"
  >,
>(
  adapter: BackgroundBrowserAdapter,
  tabId: number,
  command: RequestEnvelope<C>,
): Promise<ResponseEnvelope<C>> {
  let rawContentResponse: unknown;
  try {
    rawContentResponse = await adapter.sendContentRequest(tabId, command);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserCommandError(
      "SCRIPT_INJECTION_FAILED",
      `Cannot inject firefox-cli into this tab. Open a normal web page, reload the extension, or choose a different tab. Firefox reported: ${message}`,
    );
  }

  const contentResponse = parseBoundaryResponse(
    "extension-to-content-script",
    command.command,
    rawContentResponse,
  );
  if (!contentResponse.ok) {
    return createErrorResponse(command.id, contentResponse.error) as ResponseEnvelope<C>;
  }

  return contentResponse.value as ResponseEnvelope<C>;
}

async function waitForUrl(
  adapter: BackgroundBrowserAdapter,
  tabId: number,
  params: RequestEnvelope<"wait">["params"],
): Promise<WaitResult> {
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const intervalMs = params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  while (true) {
    const match = findTabById(await getOrderedWindows(adapter), tabId);
    if (match === undefined) {
      throw new BrowserCommandError("INVALID_TARGET", "Requested Firefox tab was not found.");
    }

    const url = match.tab.url ?? "";
    if (matchesGlob(url, params.urlGlob ?? "")) {
      return {
        kind: "url",
        matched: true,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        value: url,
        target: toResolvedTarget(match.window, match.tab),
      };
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new BrowserCommandError(
        "TIMEOUT",
        `Timed out after ${timeoutMs}ms waiting for URL ${JSON.stringify(params.urlGlob ?? "")}.`,
      );
    }

    await delay(Math.max(0, Math.min(intervalMs, timeoutMs - elapsedMs)));
  }
}

async function executeBatch(
  command: RequestEnvelope<"batch">,
  adapter: BackgroundBrowserAdapter,
): Promise<BatchResult> {
  const startedAt = Date.now();
  const timeoutMs = command.params.timeoutMs;
  const maxResultBytes = command.params.maxResultBytes ?? MAX_BATCH_RESULT_BYTES;
  const defaultTarget = resolveTarget(
    await getOrderedWindows(adapter),
    command.params.target,
  ).target;
  const defaultSelector: TargetSelector = {
    window: { kind: "id", id: defaultTarget.windowId },
    tab: { kind: "id", id: defaultTarget.tabId },
  };
  const steps: BatchStepResult[] = [];
  let totalScreenshotBytes = 0;

  for (let index = 0; index < command.params.steps.length; index += 1) {
    const step = command.params.steps[index];
    if (step === undefined) {
      continue;
    }

    const remainingMs = remainingBatchTime(startedAt, timeoutMs);
    if (remainingMs !== undefined && remainingMs <= 0) {
      throw new BrowserCommandError("TIMEOUT", `Timed out after ${timeoutMs}ms.`);
    }

    const stepRequest: RequestEnvelope = {
      protocolVersion: command.protocolVersion,
      id: `${command.id}:${index}`,
      command: step.command as CommandId,
      params: applyBatchStepDefaults(
        step.command,
        step.params,
        defaultSelector,
        remainingMs,
      ) as RequestEnvelope["params"],
    };
    const response = await handleBrowserRequest(stepRequest, adapter);
    const stepResult: BatchStepResult = response.ok
      ? {
          index,
          command: step.command,
          ok: true,
          result: response.result,
        }
      : {
          index,
          command: step.command,
          ok: false,
          error: response.error,
        };
    steps.push(stepResult);

    if (stepResult.ok && stepResult.command === "screenshot") {
      totalScreenshotBytes += (stepResult.result as ScreenshotResult).bytes;
      if (totalScreenshotBytes > MAX_SCREENSHOT_BYTES) {
        throw new BrowserCommandError(
          "OUTPUT_TOO_LARGE",
          `Batch screenshots exceed the ${MAX_SCREENSHOT_BYTES} byte native messaging limit.`,
        );
      }
    }

    assertBatchResultSize(
      {
        ok: steps.every((candidate) => candidate.ok),
        steps,
        ...(firstFailedIndex(steps) === undefined
          ? {}
          : { firstFailedIndex: firstFailedIndex(steps) }),
        elapsedMs: Math.max(0, Date.now() - startedAt),
      },
      maxResultBytes,
    );

    if (!stepResult.ok && command.params.bail === true) {
      break;
    }
  }

  const failedIndex = firstFailedIndex(steps);
  const result: BatchResult = {
    ok: failedIndex === undefined,
    steps,
    ...(failedIndex === undefined ? {} : { firstFailedIndex: failedIndex }),
    elapsedMs: Math.max(0, Date.now() - startedAt),
  };
  assertBatchResultSize(result, maxResultBytes);
  return result;
}

function applyBatchStepDefaults(
  command: string,
  rawParams: unknown,
  defaultTarget: TargetSelector,
  remainingMs: number | undefined,
): unknown {
  if (!isRecord(rawParams)) {
    return rawParams;
  }

  return {
    ...rawParams,
    ...(acceptsBatchDefaultTarget(command) && rawParams.target === undefined
      ? { target: defaultTarget }
      : {}),
    ...timeoutOverride(command, rawParams.timeoutMs, remainingMs),
  };
}

function timeoutOverride(
  command: string,
  existingTimeout: unknown,
  remainingMs: number | undefined,
): { readonly timeoutMs?: number } {
  if (remainingMs === undefined || !acceptsBatchTimeout(command)) {
    return {};
  }

  const boundedTimeout =
    typeof existingTimeout === "number" ? Math.min(existingTimeout, remainingMs) : remainingMs;
  return { timeoutMs: Math.max(1, Math.floor(boundedTimeout)) };
}

function acceptsBatchDefaultTarget(command: string): boolean {
  return (
    command === "tabs.list" ||
    command === "tab.new" ||
    command === "tab.select" ||
    command === "tab.close" ||
    command === "window.select" ||
    command === "window.close" ||
    command === "open" ||
    command === "back" ||
    command === "forward" ||
    command === "reload" ||
    command === "snapshot" ||
    command === "ref.resolve" ||
    command === "get" ||
    command === "is" ||
    command === "wait" ||
    command === "eval" ||
    command === "screenshot" ||
    command === "find" ||
    command === "frame" ||
    command === "dialog" ||
    command === "clipboard" ||
    command === "storage" ||
    command === "console" ||
    command === "errors" ||
    command === "highlight" ||
    command === "set.viewport" ||
    command === "diff" ||
    isActionCommand(command)
  );
}

function acceptsBatchTimeout(command: string): boolean {
  return command === "wait" || command === "eval" || command === "screenshot";
}

function remainingBatchTime(startedAt: number, timeoutMs: number | undefined): number | undefined {
  return timeoutMs === undefined ? undefined : timeoutMs - (Date.now() - startedAt);
}

function assertBatchResultSize(result: BatchResult, maxResultBytes: number): void {
  const publicResult = publicBatchResult(result);
  const bytes = new TextEncoder().encode(JSON.stringify(publicResult)).byteLength;
  if (bytes > maxResultBytes) {
    throw new BrowserCommandError(
      "RESULT_TOO_LARGE",
      `Batch result is ${bytes} bytes, exceeding the ${maxResultBytes} byte limit.`,
    );
  }
}

function publicBatchResult(result: BatchResult): BatchResult {
  return {
    ...result,
    steps: result.steps.map((step) =>
      step.ok && step.command === "screenshot"
        ? {
            ...step,
            result: stripScreenshotImageBytes(step.result as ScreenshotResult),
          }
        : step,
    ),
  };
}

function stripScreenshotImageBytes(
  result: ScreenshotResult,
): Omit<ScreenshotResult, "imageBase64"> {
  const { imageBase64: _imageBase64, ...publicResult } = result;
  return publicResult;
}

async function snapshotTextForDiff(
  adapter: BackgroundBrowserAdapter,
  tabId: number,
  command: RequestEnvelope<"diff">,
): Promise<string> {
  const snapshotRequest: RequestEnvelope<"snapshot"> = {
    protocolVersion: command.protocolVersion,
    id: `${command.id}:snapshot`,
    command: "snapshot",
    params: {
      compact: true,
      ...(command.params.selector === undefined ? {} : { selector: command.params.selector }),
    },
  };
  const snapshotResponse = await sendContentCommand(adapter, tabId, snapshotRequest);
  if (!snapshotResponse.ok) {
    throw new BrowserCommandError(
      snapshotResponse.error.code as BrowserCommandError["code"],
      snapshotResponse.error.message,
    );
  }
  return snapshotResponse.result.text;
}

function firstFailedIndex(steps: readonly BatchStepResult[]): number | undefined {
  return steps.find((step) => !step.ok)?.index;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getOrderedWindows(
  adapter: BackgroundBrowserAdapter,
): Promise<readonly OrderedWindow[]> {
  return toOrderedWindows(await adapter.listWindows());
}

function toOrderedWindows(windows: readonly BrowserWindowSnapshot[]): readonly OrderedWindow[] {
  return [...windows]
    .filter((window) => window.id !== undefined)
    .sort((a, b) => Number(b.focused) - Number(a.focused) || a.id - b.id)
    .map((window, index) => ({
      ...window,
      index,
      tabs: [...window.tabs].sort((a, b) => a.index - b.index),
    }));
}

function resolveTarget(
  windows: readonly OrderedWindow[],
  selector: TargetSelector | undefined,
  options: { readonly allowPrivate?: boolean } = {},
): ResolvedBrowserTarget {
  const tabById =
    selector?.tab?.kind === "id" && selector.window === undefined
      ? findTabById(windows, selector.tab.id)
      : undefined;
  const window = tabById?.window ?? resolveWindow(windows, selector?.window);
  const tab = tabById?.tab ?? resolveTab(window, selector?.tab);

  if (options.allowPrivate !== true && (window.private === true || tab.private === true)) {
    throw new BrowserCommandError(
      "UNSUPPORTED_CAPABILITY",
      "Private window commands require private browsing permission.",
    );
  }

  return {
    window,
    tab,
    target: toResolvedTarget(window, tab),
  };
}

function resolveWindow(
  windows: readonly OrderedWindow[],
  selector: TargetSelector["window"] | undefined,
): OrderedWindow {
  if (windows.length === 0) {
    throw new BrowserCommandError("NO_ACTIVE_TAB", "Firefox has no normal browser windows.");
  }

  if (selector === undefined || selector.kind === "active") {
    const focused = windows.find((window) => window.focused);
    if (focused !== undefined) {
      return focused;
    }

    const first = windows[0];
    if (first === undefined) {
      throw new BrowserCommandError("NO_ACTIVE_TAB", "Firefox has no normal browser windows.");
    }

    return first;
  }

  const window =
    selector.kind === "id"
      ? findWindowById(windows, selector.id)
      : windows.find((candidate) => candidate.index === selector.index);
  if (window === undefined) {
    throw new BrowserCommandError("INVALID_TARGET", "Requested Firefox window was not found.");
  }

  return window;
}

function assertMutableWindow(window: OrderedWindow): void {
  if (window.private === true) {
    throw new BrowserCommandError(
      "UNSUPPORTED_CAPABILITY",
      "Private window commands require private browsing permission.",
    );
  }
}

function resolveTab(
  window: OrderedWindow,
  selector: TargetSelector["tab"] | undefined,
): TabSummary {
  if (window.tabs.length === 0) {
    throw new BrowserCommandError("NO_ACTIVE_TAB", "Firefox window has no tabs.");
  }

  if (selector === undefined || selector.kind === "active") {
    const active = window.tabs.find((tab) => tab.active);
    if (active === undefined) {
      throw new BrowserCommandError("NO_ACTIVE_TAB", "Firefox window has no active tab.");
    }
    return active;
  }

  const tab =
    selector.kind === "id"
      ? window.tabs.find((candidate) => candidate.id === selector.id)
      : window.tabs.find((candidate) => candidate.index === selector.index);
  if (tab === undefined) {
    throw new BrowserCommandError("INVALID_TARGET", "Requested Firefox tab was not found.");
  }

  return tab;
}

async function resolveFreshTarget(
  adapter: BackgroundBrowserAdapter,
  selector: TargetSelector,
): Promise<ResolvedTarget> {
  return resolveTarget(await getOrderedWindows(adapter), selector).target;
}

function findTabById(
  windows: readonly OrderedWindow[],
  tabId: number,
): { readonly window: OrderedWindow; readonly tab: TabSummary } | undefined {
  for (const window of windows) {
    const tab = window.tabs.find((candidate) => candidate.id === tabId);
    if (tab !== undefined) {
      return { window, tab };
    }
  }

  return undefined;
}

function findWindowById(
  windows: readonly OrderedWindow[],
  windowId: number,
): OrderedWindow | undefined {
  return windows.find((candidate) => candidate.id === windowId);
}

function toResolvedTarget(window: OrderedWindow, tab: TabSummary): ResolvedTarget {
  return {
    windowId: window.id,
    windowIndex: window.index,
    tabId: tab.id,
    tabIndex: tab.index,
    ...(tab.title === undefined ? {} : { title: tab.title }),
    ...(tab.url === undefined ? {} : { url: tab.url }),
    ...(tab.private === undefined ? {} : { private: tab.private }),
    ...(tab.cookieStoreId === undefined ? {} : { cookieStoreId: tab.cookieStoreId }),
  };
}

function toWindowSummary(window: OrderedWindow): WindowSummary {
  return {
    id: window.id,
    index: window.index,
    focused: window.focused,
    activeTabId: window.tabs.find((tab) => tab.active)?.id,
    tabCount: window.tabs.length,
    ...(window.private === undefined ? {} : { private: window.private }),
    ...(window.left === undefined ? {} : { left: window.left }),
    ...(window.top === undefined ? {} : { top: window.top }),
    ...(window.width === undefined ? {} : { width: window.width }),
    ...(window.height === undefined ? {} : { height: window.height }),
  };
}

class BrowserCommandError extends Error {
  readonly code:
    | "NO_ACTIVE_TAB"
    | "INVALID_TARGET"
    | "UNSUPPORTED_CAPABILITY"
    | "PERMISSION_DENIED"
    | "NAVIGATION_FAILED"
    | "SCRIPT_INJECTION_FAILED"
    | "TIMEOUT"
    | "CAPTURE_FAILED"
    | "OUTPUT_TOO_LARGE"
    | "RESULT_TOO_LARGE";

  constructor(code: BrowserCommandError["code"], message: string) {
    super(message);
    this.name = "BrowserCommandError";
    this.code = code;
  }
}

function matchesGlob(value: string, glob: string): boolean {
  return new RegExp(
    `^${escapeRegExp(glob).replaceAll("\\*", ".*").replaceAll("\\?", ".")}$`,
    "u",
  ).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.*]/gu, "\\$&");
}

function delay(durationMs: number | undefined): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs ?? 0));
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new BrowserCommandError("TIMEOUT", `Timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function parseImageDataUrl(
  dataUrl: string,
  format: "png" | "jpeg",
  maxImageBytes: number,
): {
  readonly base64: string;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
} {
  const prefix = `data:image/${format};base64,`;
  if (!dataUrl.startsWith(prefix)) {
    throw new BrowserCommandError(
      "CAPTURE_FAILED",
      `Firefox did not return a ${format.toUpperCase()} screenshot.`,
    );
  }

  const base64 = dataUrl.slice(prefix.length);
  const bytes = base64DecodedLength(base64);
  if (bytes <= 0) {
    throw new BrowserCommandError("CAPTURE_FAILED", "Firefox returned an empty screenshot.");
  }
  if (bytes > maxImageBytes) {
    throw new BrowserCommandError(
      "OUTPUT_TOO_LARGE",
      `Screenshot is ${bytes} bytes, exceeding the ${maxImageBytes} byte limit.`,
    );
  }

  return {
    base64,
    bytes,
    ...(format === "png" ? parsePngDimensions(base64) : {}),
  };
}

function base64DecodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function parsePngDimensions(base64: string): { readonly width?: number; readonly height?: number } {
  try {
    const header = atob(base64.slice(0, 32));
    const bytes = Uint8Array.from(header, (character) => character.charCodeAt(0));
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    const isPng = pngSignature.every((byte, index) => bytes[index] === byte);
    if (!isPng || bytes.length < 24) {
      throw new Error("Invalid PNG header.");
    }

    return {
      width: readUint32(bytes, 16),
      height: readUint32(bytes, 20),
    };
  } catch (error) {
    throw new BrowserCommandError(
      "CAPTURE_FAILED",
      `Firefox returned invalid PNG data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}
