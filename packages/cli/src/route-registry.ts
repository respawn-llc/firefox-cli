import { type CliRouteMetadata, type CommandId, gatedCapabilities, getCliRouteEntries } from "@firefox-cli/protocol";
import { parseCliRouteArgv as parseArgvWithRouteContract, routeParserSpecs } from "./argv-contracts.js";
import {
  buildDragRequest,
  buildElementActionRequest,
  buildKeyboardRequest,
  buildKeyEventRequest,
  buildMouseRequest,
  buildPressRequest,
  buildScrollRequest,
  buildSelectRequest,
  buildTextActionRequest,
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
  buildNotifyRequest,
  buildRefRequest,
  buildSnapshotRequest,
  buildStorageRequest,
} from "./commands/content.js";
import { buildEvalRequest } from "./commands/eval.js";
import { buildCapabilitiesRequest, buildNavigationRequest, buildOpenRequest } from "./commands/navigation.js";
import { buildPdfRequest, buildSetViewportRequest } from "./commands/phase8.js";
import { buildScreenshotRequest } from "./commands/screenshot.js";
import { buildTabsRequest, buildWindowsRequest } from "./commands/tabs-windows.js";
import { buildWaitRequest } from "./commands/wait.js";
import { cliResponseFormatters } from "./format.js";
import { getPositionals } from "./parse.js";
import type { CliRequestBuilder, CliResponseFormatter, CliResponseFormatterKind, CliRouteBinding, CliRouteParserSpec } from "./types.js";

const protocolCliRouteEntries = getCliRouteEntries();
const protocolCliRouteEntriesById = new Map(protocolCliRouteEntries.map((entry) => [entry.route.id, entry]));
const routeParserSpecsById = new Map<string, CliRouteParserSpec>(Object.entries(routeParserSpecs));

export const unsupportedCliCommands = new Map(
  gatedCapabilities.flatMap((capability) => (capability.cliCommands ?? []).map((command) => [command, capability] as const)),
);

interface CliRouteFormatterSpec<C extends CommandId> {
  readonly command: C;
  readonly kind: CliResponseFormatterKind;
  readonly formatter: CliResponseFormatter<C>;
}

const routeFormatterSpecs = {
  capabilities: routeFormatter("capabilities", "capabilities", cliResponseFormatters.capabilities),
  "tab.list": routeFormatter("tabs.list", "tab-list", cliResponseFormatters["tab-list"]),
  "tab.new": routeFormatter("tab.new", "tab-target", cliResponseFormatters["tab-target"]),
  "tab.select": routeFormatter("tab.select", "tab-target", cliResponseFormatters["tab-target"]),
  "tab.close": routeFormatter("tab.close", "tab-close", cliResponseFormatters["tab-close"]),
  "window.list": routeFormatter("windows.list", "window-list", cliResponseFormatters["window-list"]),
  "window.new": routeFormatter("window.new", "window-target", cliResponseFormatters["window-target"]),
  "window.select": routeFormatter("window.select", "window-target", cliResponseFormatters["window-target"]),
  "window.close": routeFormatter("window.close", "window-close", cliResponseFormatters["window-close"]),
  open: routeFormatter("open", "tab-target", cliResponseFormatters["tab-target"]),
  back: routeFormatter("back", "tab-target", cliResponseFormatters["tab-target"]),
  forward: routeFormatter("forward", "tab-target", cliResponseFormatters["tab-target"]),
  reload: routeFormatter("reload", "tab-target", cliResponseFormatters["tab-target"]),
  snapshot: routeFormatter("snapshot", "snapshot", cliResponseFormatters.snapshot),
  ref: routeFormatter("ref.resolve", "ref", cliResponseFormatters.ref),
  get: routeFormatter("get", "get", cliResponseFormatters.get),
  is: routeFormatter("is", "is", cliResponseFormatters.is),
  wait: routeFormatter("wait", "wait", cliResponseFormatters.wait),
  eval: routeFormatter("eval", "eval", cliResponseFormatters.eval),
  screenshot: routeFormatter("screenshot", "screenshot", cliResponseFormatters.screenshot),
  drag: routeFormatter("drag", "action", cliResponseFormatters.action),
  upload: routeFormatter("upload", "action", cliResponseFormatters.action),
  mouse: routeFormatter("mouse", "action", cliResponseFormatters.action),
  keydown: routeFormatter("keydown", "action", cliResponseFormatters.action),
  keyup: routeFormatter("keyup", "action", cliResponseFormatters.action),
  find: routeFormatter("find", "find", cliResponseFormatters.find),
  frame: routeFormatter("frame", "frame", cliResponseFormatters.frame),
  download: routeFormatter("download", "json-object", cliResponseFormatters["json-object"]),
  dialog: routeFormatter("dialog", "json-object", cliResponseFormatters["json-object"]),
  clipboard: routeFormatter("clipboard", "json-object", cliResponseFormatters["json-object"]),
  cookies: routeFormatter("cookies", "json-object", cliResponseFormatters["json-object"]),
  storage: routeFormatter("storage", "json-object", cliResponseFormatters["json-object"]),
  network: routeFormatter("network", "json-object", cliResponseFormatters["json-object"]),
  console: routeFormatter("console", "json-object", cliResponseFormatters["json-object"]),
  errors: routeFormatter("errors", "json-object", cliResponseFormatters["json-object"]),
  highlight: routeFormatter("highlight", "json-object", cliResponseFormatters["json-object"]),
  notify: routeFormatter("notify", "json-object", cliResponseFormatters["json-object"]),
  pdf: routeFormatter("pdf", "json-object", cliResponseFormatters["json-object"]),
  "set.viewport": routeFormatter("set.viewport", "json-object", cliResponseFormatters["json-object"]),
  diff: routeFormatter("diff", "json-object", cliResponseFormatters["json-object"]),
  batch: routeFormatter("batch", "batch", cliResponseFormatters.batch),
  click: routeFormatter("click", "action", cliResponseFormatters.action),
  dblclick: routeFormatter("dblclick", "action", cliResponseFormatters.action),
  focus: routeFormatter("focus", "action", cliResponseFormatters.action),
  hover: routeFormatter("hover", "action", cliResponseFormatters.action),
  fill: routeFormatter("fill", "action", cliResponseFormatters.action),
  type: routeFormatter("type", "action", cliResponseFormatters.action),
  press: routeFormatter("press", "action", cliResponseFormatters.action),
  "keyboard.type": routeFormatter("keyboard.type", "action", cliResponseFormatters.action),
  "keyboard.inserttext": routeFormatter("keyboard.inserttext", "action", cliResponseFormatters.action),
  check: routeFormatter("check", "action", cliResponseFormatters.action),
  uncheck: routeFormatter("uncheck", "action", cliResponseFormatters.action),
  select: routeFormatter("select", "action", cliResponseFormatters.action),
  scroll: routeFormatter("scroll", "action", cliResponseFormatters.action),
  scrollintoview: routeFormatter("scrollintoview", "action", cliResponseFormatters.action),
  swipe: routeFormatter("swipe", "action", cliResponseFormatters.action),
} as const;

type RouteFormatterSpecById = typeof routeFormatterSpecs;

function routeFormatter<C extends CommandId>(command: C, kind: CliResponseFormatterKind, formatter: CliResponseFormatter<C>): CliRouteFormatterSpec<C> {
  return { command, kind, formatter };
}

function bindCliRoute<RouteId extends keyof RouteFormatterSpecById>(
  routeId: RouteId,
  help: string,
  buildRequest: CliRequestBuilder,
): CliRouteBinding<RouteFormatterSpecById[RouteId]["command"]> {
  const routeEntry = protocolCliRouteEntriesById.get(routeId);
  if (routeEntry === undefined) {
    throw new Error(`CLI binding references unknown protocol route: ${routeId}`);
  }
  const parser = routeParserSpecsById.get(routeId);
  if (parser === undefined) {
    throw new Error(`CLI binding is missing parser or formatter metadata: ${routeId}`);
  }
  const formatter = routeFormatterSpecs[routeId];
  if (routeEntry.command !== formatter.command) {
    throw new Error(`CLI binding formatter command mismatch for ${routeId}: expected ${routeEntry.command}, received ${formatter.command}`);
  }

  return {
    route: routeEntry.route,
    command: formatter.command,
    help,
    parser,
    formatterKind: formatter.kind,
    formatter: formatter.formatter,
    buildRequest,
  };
}

export const cliRouteBindings = {
  capabilities: bindCliRoute("capabilities", "firefox-cli capabilities [--json]", buildCapabilitiesRequest),
  "tab.list": bindCliRoute("tab.list", "firefox-cli tab [--json]", buildTabsRequest),
  "tab.new": bindCliRoute("tab.new", "firefox-cli tab new [url] [--json]", buildTabsRequest),
  "tab.select": bindCliRoute("tab.select", "firefox-cli tab select [target-or-url] [--json]", buildTabsRequest),
  "tab.close": bindCliRoute("tab.close", "firefox-cli tab close [target-or-url] [--json]", buildTabsRequest),
  "window.list": bindCliRoute("window.list", "firefox-cli window [--json]", buildWindowsRequest),
  "window.new": bindCliRoute("window.new", "firefox-cli window new [url] [--json]", buildWindowsRequest),
  "window.select": bindCliRoute("window.select", "firefox-cli window select [target-or-url] [--json]", buildWindowsRequest),
  "window.close": bindCliRoute("window.close", "firefox-cli window close [target-or-url] [--json]", buildWindowsRequest),
  open: bindCliRoute("open", "firefox-cli open [--new-tab] <url> [--json]", buildOpenRequest),
  back: bindCliRoute("back", "firefox-cli back [--json]", buildNavigationRequest),
  forward: bindCliRoute("forward", "firefox-cli forward [--json]", buildNavigationRequest),
  reload: bindCliRoute("reload", "firefox-cli reload [--json]", buildNavigationRequest),
  snapshot: bindCliRoute("snapshot", "firefox-cli snapshot [-i] [-c] [-d depth] [-s selector] [--json]", buildSnapshotRequest),
  ref: bindCliRoute("ref", "firefox-cli ref <@ref> [--json]", buildRefRequest),
  get: bindCliRoute("get", "firefox-cli get <kind> [selector|@ref] [--json]", buildGetRequest),
  is: bindCliRoute("is", "firefox-cli is <kind> <selector|@ref> [--json]", buildIsRequest),
  wait: bindCliRoute("wait", "firefox-cli wait <condition> [--json]", buildWaitRequest),
  eval: bindCliRoute("eval", "firefox-cli eval <js> | --stdin | -b base64 [--json]", buildEvalRequest),
  screenshot: bindCliRoute("screenshot", "firefox-cli screenshot [path] [--json]", buildScreenshotRequest),
  drag: bindCliRoute("drag", "firefox-cli drag <source> <target> [--json]", buildDragRequest),
  upload: bindCliRoute("upload", "firefox-cli upload <selector|@ref> <file...> [--json]", buildUploadRequest),
  mouse: bindCliRoute("mouse", "firefox-cli mouse move|down|up|wheel [selector|@ref] [--json]", buildMouseRequest),
  keydown: bindCliRoute("keydown", "firefox-cli keydown <key> [selector|@ref] [--json]", buildKeyEventRequest),
  keyup: bindCliRoute("keyup", "firefox-cli keyup <key> [selector|@ref] [--json]", buildKeyEventRequest),
  find: bindCliRoute("find", "firefox-cli find <kind> <value> [--json]", buildFindRequest),
  frame: bindCliRoute("frame", "firefox-cli frame [--json]", buildFrameRequest),
  download: bindCliRoute("download", "firefox-cli download <url> [filename] [--json]", buildDownloadRequest),
  dialog: bindCliRoute("dialog", "firefox-cli dialog status|accept|dismiss [--json]", buildDialogRequest),
  clipboard: bindCliRoute("clipboard", "firefox-cli clipboard read|write|copy|paste [text-or-selector] [--json]", buildClipboardRequest),
  cookies: bindCliRoute("cookies", "firefox-cli cookies list|get|set|remove <url> [name] [value] [--json]", buildCookiesRequest),
  storage: bindCliRoute("storage", "firefox-cli storage local|session get|set|remove|clear [key] [value] [--json]", buildStorageRequest),
  network: bindCliRoute("network", "firefox-cli network list|clear [--window target] [--tab target] [--json]", buildNetworkRequest),
  console: bindCliRoute("console", "firefox-cli console list|clear [--json]", buildLogRequest),
  errors: bindCliRoute("errors", "firefox-cli errors list|clear [--json]", buildLogRequest),
  highlight: bindCliRoute("highlight", "firefox-cli highlight <selector|@ref> [--json]", buildHighlightRequest),
  notify: bindCliRoute("notify", "firefox-cli notify [--id id] <title> [message...] [--json]", buildNotifyRequest),
  pdf: bindCliRoute("pdf", "firefox-cli pdf <path> [--json]", buildPdfRequest),
  "set.viewport": bindCliRoute("set.viewport", "firefox-cli set viewport <width> <height> [--json]", buildSetViewportRequest),
  diff: bindCliRoute("diff", "firefox-cli diff url|title|snapshot <expected> [--json]", buildDiffRequest),
  batch: bindCliRoute("batch", "firefox-cli batch <json> | --stdin [--bail] [--json]", buildBatchRequest),
  click: bindCliRoute("click", "firefox-cli click <selector|@ref> [--json]", buildElementActionRequest),
  dblclick: bindCliRoute("dblclick", "firefox-cli dblclick <selector|@ref> [--json]", buildElementActionRequest),
  focus: bindCliRoute("focus", "firefox-cli focus <selector|@ref> [--json]", buildElementActionRequest),
  hover: bindCliRoute("hover", "firefox-cli hover <selector|@ref> [--json]", buildElementActionRequest),
  fill: bindCliRoute("fill", "firefox-cli fill <selector|@ref> <text> [--json]", buildTextActionRequest),
  type: bindCliRoute("type", "firefox-cli type <selector|@ref> <text> [--json]", buildTextActionRequest),
  press: bindCliRoute("press", "firefox-cli press <key> [--json]", buildPressRequest),
  "keyboard.type": bindCliRoute("keyboard.type", "firefox-cli keyboard type <text> [--json]", buildKeyboardRequest),
  "keyboard.inserttext": bindCliRoute("keyboard.inserttext", "firefox-cli keyboard inserttext <text> [--json]", buildKeyboardRequest),
  check: bindCliRoute("check", "firefox-cli check <selector|@ref> [--json]", buildElementActionRequest),
  uncheck: bindCliRoute("uncheck", "firefox-cli uncheck <selector|@ref> [--json]", buildElementActionRequest),
  select: bindCliRoute("select", "firefox-cli select <selector|@ref> <value...> [--json]", buildSelectRequest),
  scroll: bindCliRoute("scroll", "firefox-cli scroll up|down|left|right [px] [selector|@ref] [--json]", buildScrollRequest),
  scrollintoview: bindCliRoute("scrollintoview", "firefox-cli scrollintoview <selector|@ref> [--json]", buildElementActionRequest),
  swipe: bindCliRoute("swipe", "firefox-cli swipe up|down|left|right [px] [selector|@ref] [--json]", buildScrollRequest),
} as const satisfies Record<string, CliRouteBinding>;

const cliRouteBindingsForMatching = Object.values(cliRouteBindings).sort((left, right) => right.route.path.length - left.route.path.length);

export function findCliRouteBindingForArgv(argv: readonly string[]): CliRouteBinding | undefined {
  const root = argv[0];
  if (root === undefined) {
    return undefined;
  }

  const positionals = getPositionals(argv);
  return (
    cliRouteBindingsForMatching.find((binding) => routePathMatchesPositionals(binding.route.path, positionals)) ??
    Object.values(cliRouteBindings).find((binding) => binding.route.path[0] === root)
  );
}

export function validateCliRouteArgv(binding: CliRouteBinding, argv: readonly string[]): void {
  parseCliRouteArgv(binding, argv);
}

export function cliRouteWantsJsonOutput(binding: CliRouteBinding, argv: readonly string[]): boolean {
  return parseCliRouteArgv(binding, argv).json;
}

function parseCliRouteArgv(binding: CliRouteBinding, argv: readonly string[]): { readonly json: boolean } {
  return parseArgvWithRouteContract(binding.parser, binding.route.id, argv);
}

function routePathMatchesPositionals(routePath: CliRouteMetadata["path"], positionals: readonly string[]): boolean {
  return positionals.length >= routePath.length && routePath.every((segment, index) => positionals[index] === segment);
}
