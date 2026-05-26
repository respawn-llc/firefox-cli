import {
  createErrorResponse,
  createOkResponse,
  type CommandId,
  type GetResult,
  type IsResult,
  type RefResolveResult,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ResolvedTarget,
  type SnapshotResult,
  type TabSummary,
  type TargetSelector,
  type WaitResult,
  type WindowSummary,
  parseBoundaryResponse,
} from "@firefox-cli/protocol";

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_INTERVAL_MS = 100;

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
      await delay(command.params.durationMs);
      return createOkResponse(command, {
        kind: command.params.kind,
        matched: true,
        elapsedMs: Math.max(0, Date.now() - startedAt),
      });
    }

    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    if (command.params.kind === "url") {
      const result = await waitForUrl(adapter, resolved.tab.id, command.params);
      return createOkResponse(command, result);
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

  return createErrorResponse(request.id, {
    code: "UNSUPPORTED_CAPABILITY",
    message: `Unsupported browser command: ${request.command}`,
  });
}

async function sendContentCommand<
  C extends Extract<CommandId, "snapshot" | "ref.resolve" | "get" | "is" | "wait">,
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
        kind: params.kind,
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
    | "TIMEOUT";

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
