import { getCliRoutes, type CliRouteMetadata, type CommandId } from "@firefox-cli/protocol";
import {
  buildElementActionRequest,
  buildKeyboardRequest,
  buildKeyEventRequest,
  buildMouseRequest,
  buildPressRequest,
  buildScrollRequest,
  buildSelectRequest,
  buildTextActionRequest,
  buildDragRequest,
  buildUploadRequest,
} from "./commands/actions.js";
import { buildBatchRequest } from "./commands/batch.js";
import {
  buildClipboardRequest,
  buildCookiesRequest,
  buildDialogRequest,
  buildDiffRequest,
  buildDownloadRequest,
  buildFindRequest,
  buildFrameRequest,
  buildGetRequest,
  buildHighlightRequest,
  buildIsRequest,
  buildLogRequest,
  buildNetworkRequest,
  buildRefRequest,
  buildSnapshotRequest,
  buildStorageRequest,
} from "./commands/content.js";
import { buildEvalRequest } from "./commands/eval.js";
import {
  buildCapabilitiesRequest,
  buildNavigationRequest,
  buildOpenRequest,
} from "./commands/navigation.js";
import { buildPdfRequest, buildSetViewportRequest } from "./commands/phase8.js";
import { buildScreenshotRequest } from "./commands/screenshot.js";
import { buildTabsRequest, buildWindowsRequest } from "./commands/tabs-windows.js";
import { buildWaitRequest } from "./commands/wait.js";
import { getPositionals } from "./parse.js";
import type { CliRequestBuilder, CliRouteBinding } from "./types.js";

const protocolCliRoutes = getCliRoutes();
const protocolCliRoutesById = new Map(protocolCliRoutes.map((route) => [route.id, route]));

function bindCliRoute(
  routeId: string,
  command: CommandId,
  help: string,
  buildRequest: CliRequestBuilder,
): CliRouteBinding {
  const route = protocolCliRoutesById.get(routeId);
  if (route === undefined) {
    throw new Error(`CLI binding references unknown protocol route: ${routeId}`);
  }

  return { route, command, help, buildRequest };
}

export const cliRouteBindings = {
  capabilities: bindCliRoute(
    "capabilities",
    "capabilities",
    "firefox-cli capabilities [--json]",
    buildCapabilitiesRequest,
  ),
  "tab.list": bindCliRoute("tab.list", "tabs.list", "firefox-cli tab [--json]", buildTabsRequest),
  "tab.new": bindCliRoute(
    "tab.new",
    "tab.new",
    "firefox-cli tab new [url] [--json]",
    buildTabsRequest,
  ),
  "tab.select": bindCliRoute(
    "tab.select",
    "tab.select",
    "firefox-cli tab select [target-or-url] [--json]",
    buildTabsRequest,
  ),
  "tab.close": bindCliRoute(
    "tab.close",
    "tab.close",
    "firefox-cli tab close [target-or-url] [--json]",
    buildTabsRequest,
  ),
  "window.list": bindCliRoute(
    "window.list",
    "windows.list",
    "firefox-cli window [--json]",
    buildWindowsRequest,
  ),
  "window.new": bindCliRoute(
    "window.new",
    "window.new",
    "firefox-cli window new [url] [--json]",
    buildWindowsRequest,
  ),
  "window.select": bindCliRoute(
    "window.select",
    "window.select",
    "firefox-cli window select [target-or-url] [--json]",
    buildWindowsRequest,
  ),
  "window.close": bindCliRoute(
    "window.close",
    "window.close",
    "firefox-cli window close [target-or-url] [--json]",
    buildWindowsRequest,
  ),
  open: bindCliRoute(
    "open",
    "open",
    "firefox-cli open [--new-tab] <url> [--json]",
    buildOpenRequest,
  ),
  back: bindCliRoute("back", "back", "firefox-cli back [--json]", buildNavigationRequest),
  forward: bindCliRoute(
    "forward",
    "forward",
    "firefox-cli forward [--json]",
    buildNavigationRequest,
  ),
  reload: bindCliRoute("reload", "reload", "firefox-cli reload [--json]", buildNavigationRequest),
  snapshot: bindCliRoute(
    "snapshot",
    "snapshot",
    "firefox-cli snapshot [-i] [-c] [-d depth] [-s selector] [--json]",
    buildSnapshotRequest,
  ),
  ref: bindCliRoute("ref", "ref.resolve", "firefox-cli ref <@ref> [--json]", buildRefRequest),
  get: bindCliRoute(
    "get",
    "get",
    "firefox-cli get <kind> [selector|@ref] [--json]",
    buildGetRequest,
  ),
  is: bindCliRoute("is", "is", "firefox-cli is <kind> <selector|@ref> [--json]", buildIsRequest),
  wait: bindCliRoute("wait", "wait", "firefox-cli wait <condition> [--json]", buildWaitRequest),
  eval: bindCliRoute(
    "eval",
    "eval",
    "firefox-cli eval <js> | --stdin | -b base64 [--json]",
    buildEvalRequest,
  ),
  screenshot: bindCliRoute(
    "screenshot",
    "screenshot",
    "firefox-cli screenshot [path] [--json]",
    buildScreenshotRequest,
  ),
  drag: bindCliRoute(
    "drag",
    "drag",
    "firefox-cli drag <source> <target> [--json]",
    buildDragRequest,
  ),
  upload: bindCliRoute(
    "upload",
    "upload",
    "firefox-cli upload <selector|@ref> <file...> [--json]",
    buildUploadRequest,
  ),
  mouse: bindCliRoute(
    "mouse",
    "mouse",
    "firefox-cli mouse move|down|up|wheel [selector|@ref] [--json]",
    buildMouseRequest,
  ),
  keydown: bindCliRoute(
    "keydown",
    "keydown",
    "firefox-cli keydown <key> [selector|@ref] [--json]",
    buildKeyEventRequest,
  ),
  keyup: bindCliRoute(
    "keyup",
    "keyup",
    "firefox-cli keyup <key> [selector|@ref] [--json]",
    buildKeyEventRequest,
  ),
  find: bindCliRoute("find", "find", "firefox-cli find <kind> <value> [--json]", buildFindRequest),
  frame: bindCliRoute("frame", "frame", "firefox-cli frame [--json]", buildFrameRequest),
  download: bindCliRoute(
    "download",
    "download",
    "firefox-cli download <url> [filename] [--json]",
    buildDownloadRequest,
  ),
  dialog: bindCliRoute(
    "dialog",
    "dialog",
    "firefox-cli dialog status|accept|dismiss [--json]",
    buildDialogRequest,
  ),
  clipboard: bindCliRoute(
    "clipboard",
    "clipboard",
    "firefox-cli clipboard read|write|copy|paste [text-or-selector] [--json]",
    buildClipboardRequest,
  ),
  cookies: bindCliRoute(
    "cookies",
    "cookies",
    "firefox-cli cookies list|get|set|remove <url> [name] [value] [--json]",
    buildCookiesRequest,
  ),
  storage: bindCliRoute(
    "storage",
    "storage",
    "firefox-cli storage local|session get|set|remove|clear [key] [value] [--json]",
    buildStorageRequest,
  ),
  network: bindCliRoute(
    "network",
    "network",
    "firefox-cli network list|clear [--window target] [--tab target] [--json]",
    buildNetworkRequest,
  ),
  console: bindCliRoute(
    "console",
    "console",
    "firefox-cli console list|clear [--json]",
    buildLogRequest,
  ),
  errors: bindCliRoute(
    "errors",
    "errors",
    "firefox-cli errors list|clear [--json]",
    buildLogRequest,
  ),
  highlight: bindCliRoute(
    "highlight",
    "highlight",
    "firefox-cli highlight <selector|@ref> [--json]",
    buildHighlightRequest,
  ),
  pdf: bindCliRoute("pdf", "pdf", "firefox-cli pdf <path> [--json]", buildPdfRequest),
  "set.viewport": bindCliRoute(
    "set.viewport",
    "set.viewport",
    "firefox-cli set viewport <width> <height> [--json]",
    buildSetViewportRequest,
  ),
  diff: bindCliRoute(
    "diff",
    "diff",
    "firefox-cli diff url|title|snapshot <expected> [--json]",
    buildDiffRequest,
  ),
  batch: bindCliRoute(
    "batch",
    "batch",
    "firefox-cli batch <json> | --stdin [--bail] [--json]",
    buildBatchRequest,
  ),
  click: bindCliRoute(
    "click",
    "click",
    "firefox-cli click <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  dblclick: bindCliRoute(
    "dblclick",
    "dblclick",
    "firefox-cli dblclick <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  focus: bindCliRoute(
    "focus",
    "focus",
    "firefox-cli focus <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  hover: bindCliRoute(
    "hover",
    "hover",
    "firefox-cli hover <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  fill: bindCliRoute(
    "fill",
    "fill",
    "firefox-cli fill <selector|@ref> <text> [--json]",
    buildTextActionRequest,
  ),
  type: bindCliRoute(
    "type",
    "type",
    "firefox-cli type <selector|@ref> <text> [--json]",
    buildTextActionRequest,
  ),
  press: bindCliRoute("press", "press", "firefox-cli press <key> [--json]", buildPressRequest),
  "keyboard.type": bindCliRoute(
    "keyboard.type",
    "keyboard.type",
    "firefox-cli keyboard type <text> [--json]",
    buildKeyboardRequest,
  ),
  "keyboard.inserttext": bindCliRoute(
    "keyboard.inserttext",
    "keyboard.inserttext",
    "firefox-cli keyboard inserttext <text> [--json]",
    buildKeyboardRequest,
  ),
  check: bindCliRoute(
    "check",
    "check",
    "firefox-cli check <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  uncheck: bindCliRoute(
    "uncheck",
    "uncheck",
    "firefox-cli uncheck <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  select: bindCliRoute(
    "select",
    "select",
    "firefox-cli select <selector|@ref> <value...> [--json]",
    buildSelectRequest,
  ),
  scroll: bindCliRoute(
    "scroll",
    "scroll",
    "firefox-cli scroll up|down|left|right [px] [selector|@ref] [--json]",
    buildScrollRequest,
  ),
  scrollintoview: bindCliRoute(
    "scrollintoview",
    "scrollintoview",
    "firefox-cli scrollintoview <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  swipe: bindCliRoute(
    "swipe",
    "swipe",
    "firefox-cli swipe up|down|left|right [px] [selector|@ref] [--json]",
    buildScrollRequest,
  ),
} as const satisfies Record<string, CliRouteBinding>;

const cliRouteBindingsForMatching = Object.values(cliRouteBindings).sort(
  (left, right) => right.route.path.length - left.route.path.length,
);

export function findCliRouteBindingForArgv(argv: readonly string[]): CliRouteBinding | undefined {
  const root = argv[0];
  if (root === undefined) {
    return undefined;
  }

  const positionals = getPositionals(argv);
  return (
    cliRouteBindingsForMatching.find((binding) =>
      routePathMatchesPositionals(binding.route.path, positionals),
    ) ?? Object.values(cliRouteBindings).find((binding) => binding.route.path[0] === root)
  );
}

function routePathMatchesPositionals(
  routePath: CliRouteMetadata["path"],
  positionals: readonly string[],
): boolean {
  return (
    positionals.length >= routePath.length &&
    routePath.every((segment, index) => positionals[index] === segment)
  );
}

export function renderHelp(): string {
  return [
    "firefox-cli",
    "",
    "Usage:",
    "  firefox-cli --version",
    "  firefox-cli setup native-host [--dry-run] [--json]",
    "  firefox-cli doctor [--fix] [--json]",
    "  firefox-cli unpair",
    ...Object.values(cliRouteBindings).map((binding) => `  ${binding.help}`),
    "",
  ].join("\n");
}
