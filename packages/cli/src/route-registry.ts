import {
  gatedCapabilities,
  getCliRouteEntries,
  type CliRouteMetadata,
} from "@firefox-cli/protocol";
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
import type {
  CliRequestBuilder,
  CliResponseFormatterKind,
  CliRouteBinding,
  CliRouteParserSpec,
} from "./types.js";
import { CliUsageError } from "./types.js";

const protocolCliRouteEntries = getCliRouteEntries();
const protocolCliRouteEntriesById = new Map(
  protocolCliRouteEntries.map((entry) => [entry.route.id, entry]),
);

export const unsupportedCliCommands = new Map(
  gatedCapabilities.flatMap((capability) =>
    (capability.cliCommands ?? []).map((command) => [command, capability] as const),
  ),
);

const targetValueOptions = ["--window", "--tab"] as const;
const jsonFlags = ["--json"] as const;

const routeParserSpecs: Readonly<Record<string, CliRouteParserSpec>> = {
  capabilities: parser("capabilities"),
  "tab.list": parser("tab"),
  "tab.new": parser("tab"),
  "tab.select": parser("tab"),
  "tab.close": parser("tab"),
  "window.list": parser("window"),
  "window.new": parser("window"),
  "window.select": parser("window"),
  "window.close": parser("window"),
  open: parser("open", { flags: ["--new-tab"] }),
  back: parser("back"),
  forward: parser("forward"),
  reload: parser("reload"),
  snapshot: parser("snapshot", {
    flags: ["-i", "--interactive", "-c", "--compact", "--verbose"],
    valueOptions: ["-d", "--depth", "-s", "--selector", "--max-output"],
  }),
  ref: parser("ref", { valueOptions: ["--generation"] }),
  get: parser("get", { valueOptions: ["--generation", "--max-output"] }),
  is: parser("is", { valueOptions: ["--generation"] }),
  wait: parser("wait", {
    valueOptions: [
      "--text",
      "--url",
      "--fn",
      "--load",
      "--state",
      "--generation",
      "--timeout",
      "--interval",
    ],
    optionalValueOptions: ["--download"],
  }),
  eval: parser("eval", {
    flags: ["--stdin"],
    valueOptions: ["-b", "--base64", "--timeout", "--max-output"],
    allowDashDashPayload: true,
  }),
  screenshot: parser("screenshot", {
    flags: ["--full"],
    valueOptions: [
      "--timeout",
      "--max-output",
      "--format",
      "--screenshot-format",
      "--screenshot-quality",
    ],
  }),
  drag: parser("drag"),
  upload: parser("upload", {
    valueOptions: ["--generation"],
    payload: { payloadStartPositionals: 1, minPositionals: 2, variadicAfterMin: true },
  }),
  mouse: parser("mouse", {
    valueOptions: ["--x", "--y", "--button", "--delta-x", "--delta-y", "--generation"],
  }),
  keydown: parser("keydown", { valueOptions: ["--generation"] }),
  keyup: parser("keyup", { valueOptions: ["--generation"] }),
  find: parser("find", {
    flags: ["--first", "--last"],
    valueOptions: ["--nth"],
    payload: { payloadStartPositionals: 1, minPositionals: 2 },
  }),
  frame: parser("frame"),
  download: parser("download", { flags: ["--save-as"] }),
  dialog: parser("dialog", {
    payload: { payloadStartPositionals: 1, minPositionals: 1, variadicAfterMin: true },
  }),
  clipboard: parser("clipboard", {
    valueOptions: ["--generation"],
    payload: { payloadStartPositionals: 1, minPositionals: 1, variadicAfterMin: true },
  }),
  cookies: parser("cookies", {
    payload: { payloadStartPositionals: 2, minPositionals: 2, variadicAfterMin: true },
  }),
  storage: parser("storage", {
    payload: { payloadStartPositionals: 2, minPositionals: 2, variadicAfterMin: true },
  }),
  network: parser("network", { valueOptions: ["--url"] }),
  console: parser("console"),
  errors: parser("errors"),
  highlight: parser("highlight", { valueOptions: ["--generation", "--duration"] }),
  pdf: parser("pdf"),
  "set.viewport": parser("set"),
  diff: parser("diff", {
    valueOptions: ["--selector"],
    payload: { payloadStartPositionals: 1, minPositionals: 2 },
  }),
  batch: parser("batch", {
    flags: ["--bail", "--stdin"],
    valueOptions: ["--timeout", "--max-output"],
  }),
  click: parser("click", { valueOptions: ["--generation"] }),
  dblclick: parser("dblclick", { valueOptions: ["--generation"] }),
  focus: parser("focus", { valueOptions: ["--generation"] }),
  hover: parser("hover", { valueOptions: ["--generation"] }),
  fill: parser("fill", {
    valueOptions: ["--generation"],
    payload: { payloadStartPositionals: 1, minPositionals: 2 },
  }),
  type: parser("type", {
    valueOptions: ["--generation"],
    payload: { payloadStartPositionals: 1, minPositionals: 2 },
  }),
  press: parser("press"),
  "keyboard.type": parser("keyboard", {
    payload: { payloadStartPositionals: 1, minPositionals: 2 },
  }),
  "keyboard.inserttext": parser("keyboard", {
    payload: { payloadStartPositionals: 1, minPositionals: 2 },
  }),
  check: parser("check", { valueOptions: ["--generation"] }),
  uncheck: parser("uncheck", { valueOptions: ["--generation"] }),
  select: parser("select", {
    valueOptions: ["--generation"],
    payload: { payloadStartPositionals: 1, minPositionals: 2, variadicAfterMin: true },
  }),
  scroll: parser("scroll", { valueOptions: ["--generation"] }),
  scrollintoview: parser("scrollintoview", { valueOptions: ["--generation"] }),
  swipe: parser("swipe", { valueOptions: ["--generation"] }),
};

const routeFormatterKinds: Readonly<Record<string, CliResponseFormatterKind>> = {
  capabilities: "capabilities",
  "tab.list": "tab-list",
  "tab.new": "tab-target",
  "tab.select": "tab-target",
  "tab.close": "tab-close",
  "window.list": "window-list",
  "window.new": "window-target",
  "window.select": "window-target",
  "window.close": "window-close",
  open: "tab-target",
  back: "tab-target",
  forward: "tab-target",
  reload: "tab-target",
  snapshot: "snapshot",
  ref: "ref",
  get: "get",
  is: "is",
  wait: "wait",
  eval: "eval",
  screenshot: "screenshot",
  drag: "action",
  upload: "action",
  mouse: "action",
  keydown: "action",
  keyup: "action",
  find: "find",
  frame: "frame",
  download: "json-object",
  dialog: "json-object",
  clipboard: "json-object",
  cookies: "json-object",
  storage: "json-object",
  network: "json-object",
  console: "json-object",
  errors: "json-object",
  highlight: "json-object",
  pdf: "json-object",
  "set.viewport": "json-object",
  diff: "json-object",
  batch: "batch",
  click: "action",
  dblclick: "action",
  focus: "action",
  hover: "action",
  fill: "action",
  type: "action",
  press: "action",
  "keyboard.type": "action",
  "keyboard.inserttext": "action",
  check: "action",
  uncheck: "action",
  select: "action",
  scroll: "action",
  scrollintoview: "action",
  swipe: "action",
};

function parser(
  label: string,
  options: {
    readonly flags?: readonly string[];
    readonly valueOptions?: readonly string[];
    readonly optionalValueOptions?: readonly string[];
    readonly payload?: CliRouteParserSpec["payload"];
    readonly allowDashDashPayload?: boolean;
  } = {},
): CliRouteParserSpec {
  return {
    label,
    flags: [...jsonFlags, ...(options.flags ?? [])],
    valueOptions: [...targetValueOptions, ...(options.valueOptions ?? [])],
    ...(options.optionalValueOptions === undefined
      ? {}
      : { optionalValueOptions: options.optionalValueOptions }),
    ...(options.payload === undefined ? {} : { payload: options.payload }),
    ...(options.allowDashDashPayload === undefined
      ? {}
      : { allowDashDashPayload: options.allowDashDashPayload }),
  };
}

function bindCliRoute(
  routeId: string,
  help: string,
  buildRequest: CliRequestBuilder,
): CliRouteBinding {
  const routeEntry = protocolCliRouteEntriesById.get(routeId);
  if (routeEntry === undefined) {
    throw new Error(`CLI binding references unknown protocol route: ${routeId}`);
  }
  const parser = routeParserSpecs[routeId];
  const formatter = routeFormatterKinds[routeId];
  if (parser === undefined || formatter === undefined) {
    throw new Error(`CLI binding is missing parser or formatter metadata: ${routeId}`);
  }

  return {
    route: routeEntry.route,
    command: routeEntry.command,
    help,
    parser,
    formatter,
    buildRequest,
  };
}

export const cliRouteBindings = {
  capabilities: bindCliRoute(
    "capabilities",
    "firefox-cli capabilities [--json]",
    buildCapabilitiesRequest,
  ),
  "tab.list": bindCliRoute("tab.list", "firefox-cli tab [--json]", buildTabsRequest),
  "tab.new": bindCliRoute("tab.new", "firefox-cli tab new [url] [--json]", buildTabsRequest),
  "tab.select": bindCliRoute(
    "tab.select",
    "firefox-cli tab select [target-or-url] [--json]",
    buildTabsRequest,
  ),
  "tab.close": bindCliRoute(
    "tab.close",
    "firefox-cli tab close [target-or-url] [--json]",
    buildTabsRequest,
  ),
  "window.list": bindCliRoute("window.list", "firefox-cli window [--json]", buildWindowsRequest),
  "window.new": bindCliRoute(
    "window.new",
    "firefox-cli window new [url] [--json]",
    buildWindowsRequest,
  ),
  "window.select": bindCliRoute(
    "window.select",
    "firefox-cli window select [target-or-url] [--json]",
    buildWindowsRequest,
  ),
  "window.close": bindCliRoute(
    "window.close",
    "firefox-cli window close [target-or-url] [--json]",
    buildWindowsRequest,
  ),
  open: bindCliRoute("open", "firefox-cli open [--new-tab] <url> [--json]", buildOpenRequest),
  back: bindCliRoute("back", "firefox-cli back [--json]", buildNavigationRequest),
  forward: bindCliRoute("forward", "firefox-cli forward [--json]", buildNavigationRequest),
  reload: bindCliRoute("reload", "firefox-cli reload [--json]", buildNavigationRequest),
  snapshot: bindCliRoute(
    "snapshot",
    "firefox-cli snapshot [-i] [-c] [-d depth] [-s selector] [--json]",
    buildSnapshotRequest,
  ),
  ref: bindCliRoute("ref", "firefox-cli ref <@ref> [--json]", buildRefRequest),
  get: bindCliRoute("get", "firefox-cli get <kind> [selector|@ref] [--json]", buildGetRequest),
  is: bindCliRoute("is", "firefox-cli is <kind> <selector|@ref> [--json]", buildIsRequest),
  wait: bindCliRoute("wait", "firefox-cli wait <condition> [--json]", buildWaitRequest),
  eval: bindCliRoute(
    "eval",
    "firefox-cli eval <js> | --stdin | -b base64 [--json]",
    buildEvalRequest,
  ),
  screenshot: bindCliRoute(
    "screenshot",
    "firefox-cli screenshot [path] [--json]",
    buildScreenshotRequest,
  ),
  drag: bindCliRoute("drag", "firefox-cli drag <source> <target> [--json]", buildDragRequest),
  upload: bindCliRoute(
    "upload",
    "firefox-cli upload <selector|@ref> <file...> [--json]",
    buildUploadRequest,
  ),
  mouse: bindCliRoute(
    "mouse",
    "firefox-cli mouse move|down|up|wheel [selector|@ref] [--json]",
    buildMouseRequest,
  ),
  keydown: bindCliRoute(
    "keydown",
    "firefox-cli keydown <key> [selector|@ref] [--json]",
    buildKeyEventRequest,
  ),
  keyup: bindCliRoute(
    "keyup",
    "firefox-cli keyup <key> [selector|@ref] [--json]",
    buildKeyEventRequest,
  ),
  find: bindCliRoute("find", "firefox-cli find <kind> <value> [--json]", buildFindRequest),
  frame: bindCliRoute("frame", "firefox-cli frame [--json]", buildFrameRequest),
  download: bindCliRoute(
    "download",
    "firefox-cli download <url> [filename] [--json]",
    buildDownloadRequest,
  ),
  dialog: bindCliRoute(
    "dialog",
    "firefox-cli dialog status|accept|dismiss [--json]",
    buildDialogRequest,
  ),
  clipboard: bindCliRoute(
    "clipboard",
    "firefox-cli clipboard read|write|copy|paste [text-or-selector] [--json]",
    buildClipboardRequest,
  ),
  cookies: bindCliRoute(
    "cookies",
    "firefox-cli cookies list|get|set|remove <url> [name] [value] [--json]",
    buildCookiesRequest,
  ),
  storage: bindCliRoute(
    "storage",
    "firefox-cli storage local|session get|set|remove|clear [key] [value] [--json]",
    buildStorageRequest,
  ),
  network: bindCliRoute(
    "network",
    "firefox-cli network list|clear [--window target] [--tab target] [--json]",
    buildNetworkRequest,
  ),
  console: bindCliRoute("console", "firefox-cli console list|clear [--json]", buildLogRequest),
  errors: bindCliRoute("errors", "firefox-cli errors list|clear [--json]", buildLogRequest),
  highlight: bindCliRoute(
    "highlight",
    "firefox-cli highlight <selector|@ref> [--json]",
    buildHighlightRequest,
  ),
  pdf: bindCliRoute("pdf", "firefox-cli pdf <path> [--json]", buildPdfRequest),
  "set.viewport": bindCliRoute(
    "set.viewport",
    "firefox-cli set viewport <width> <height> [--json]",
    buildSetViewportRequest,
  ),
  diff: bindCliRoute(
    "diff",
    "firefox-cli diff url|title|snapshot <expected> [--json]",
    buildDiffRequest,
  ),
  batch: bindCliRoute(
    "batch",
    "firefox-cli batch <json> | --stdin [--bail] [--json]",
    buildBatchRequest,
  ),
  click: bindCliRoute(
    "click",
    "firefox-cli click <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  dblclick: bindCliRoute(
    "dblclick",
    "firefox-cli dblclick <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  focus: bindCliRoute(
    "focus",
    "firefox-cli focus <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  hover: bindCliRoute(
    "hover",
    "firefox-cli hover <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  fill: bindCliRoute(
    "fill",
    "firefox-cli fill <selector|@ref> <text> [--json]",
    buildTextActionRequest,
  ),
  type: bindCliRoute(
    "type",
    "firefox-cli type <selector|@ref> <text> [--json]",
    buildTextActionRequest,
  ),
  press: bindCliRoute("press", "firefox-cli press <key> [--json]", buildPressRequest),
  "keyboard.type": bindCliRoute(
    "keyboard.type",
    "firefox-cli keyboard type <text> [--json]",
    buildKeyboardRequest,
  ),
  "keyboard.inserttext": bindCliRoute(
    "keyboard.inserttext",
    "firefox-cli keyboard inserttext <text> [--json]",
    buildKeyboardRequest,
  ),
  check: bindCliRoute(
    "check",
    "firefox-cli check <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  uncheck: bindCliRoute(
    "uncheck",
    "firefox-cli uncheck <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  select: bindCliRoute(
    "select",
    "firefox-cli select <selector|@ref> <value...> [--json]",
    buildSelectRequest,
  ),
  scroll: bindCliRoute(
    "scroll",
    "firefox-cli scroll up|down|left|right [px] [selector|@ref] [--json]",
    buildScrollRequest,
  ),
  scrollintoview: bindCliRoute(
    "scrollintoview",
    "firefox-cli scrollintoview <selector|@ref> [--json]",
    buildElementActionRequest,
  ),
  swipe: bindCliRoute(
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

export function validateCliRouteArgv(binding: CliRouteBinding, argv: readonly string[]): void {
  parseCliRouteArgv(binding, argv);
}

export function cliRouteWantsJsonOutput(
  binding: CliRouteBinding,
  argv: readonly string[],
): boolean {
  return parseCliRouteArgv(binding, argv).json;
}

function parseCliRouteArgv(
  binding: CliRouteBinding,
  argv: readonly string[],
): { readonly json: boolean } {
  const args = argv.slice(1);
  const positionals: string[] = [];
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--" && binding.parser.allowDashDashPayload === true) {
      break;
    }

    if (binding.parser.flags.includes(arg)) {
      if (shouldTreatKnownOptionAsPayload(binding.parser, args, index, 1, positionals.length)) {
        positionals.push(arg);
      } else if (arg === "--json") {
        json = true;
      }
      continue;
    }

    if (binding.parser.valueOptions.includes(arg)) {
      const value = args[index + 1];
      if (
        binding.route.id === "select" &&
        arg === "--generation" &&
        value === undefined &&
        canTreatUnknownOptionAsPayload(binding.parser, positionals.length)
      ) {
        positionals.push(arg);
        continue;
      }

      if (shouldTreatKnownOptionAsPayload(binding.parser, args, index, 2, positionals.length)) {
        positionals.push(arg);
        continue;
      }

      if (value === undefined || value.startsWith("-")) {
        throw new CliUsageError(`Missing value for ${arg}.`);
      }
      index += 1;
      continue;
    }

    if (binding.parser.optionalValueOptions?.includes(arg) === true) {
      const value = args[index + 1];
      if (value !== undefined && !value.startsWith("-")) {
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("-")) {
      if (canTreatUnknownOptionAsPayload(binding.parser, positionals.length)) {
        positionals.push(arg);
        continue;
      }
      throw new CliUsageError(`Unsupported ${binding.parser.label} option: ${arg}`);
    }

    positionals.push(arg);
  }

  return { json };
}

function shouldTreatKnownOptionAsPayload(
  parser: CliRouteParserSpec,
  args: readonly string[],
  index: number,
  width: number,
  currentPositionals: number,
): boolean {
  const payload = parser.payload;
  if (payload === undefined || currentPositionals < payload.payloadStartPositionals) {
    return false;
  }

  return currentPositionals + Math.max(0, args.length - index - width) < payload.minPositionals;
}

function canTreatUnknownOptionAsPayload(
  parser: CliRouteParserSpec,
  currentPositionals: number,
): boolean {
  const payload = parser.payload;
  return (
    payload !== undefined &&
    currentPositionals >= payload.payloadStartPositionals &&
    (currentPositionals < payload.minPositionals || payload.variadicAfterMin === true)
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
