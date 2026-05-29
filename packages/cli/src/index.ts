import { access, open as openFile, readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  FilePairStateStore,
  FileLocalIpcAuthTokenStore,
  LocalIpcError,
  isPersistedJsonFileError,
  parseNativeMessagingManifestJson,
  planLocalIpcEndpoint,
  planNativeMessagingManifest,
  sendLocalIpcRequest,
  writeNativeMessagingManifest,
} from "@firefox-cli/native-host";
import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_BYTES,
  batchParamsSchema,
  clipboardActions,
  commandAcceptsProtocolBatchDefaultTarget,
  commandSchemas,
  cookieActions,
  createRequest,
  dialogActions,
  diffKinds,
  findKinds,
  getCliRoutes,
  getKinds,
  type ActionResult,
  type BatchResult,
  type BatchParams,
  type BatchStep,
  type CliRouteMetadata,
  type CommandId,
  type EvalResult,
  type ProtocolError,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ResolvedTarget,
  type ScreenshotResult,
  type TabSummary,
  type TargetSelector,
  type UploadParams,
  type WaitResult,
  isKinds,
  gatedCapabilities,
  isBatchableCommandId,
  logActions,
  networkActions,
  screenshotFormats,
  scrollDirections,
  storageActions,
  storageAreas,
} from "@firefox-cli/protocol";

export type CliExitCode = 0 | 1;

export type CliResult = {
  readonly exitCode: CliExitCode;
  readonly stdout: string;
  readonly stderr: string;
};

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const gatedCliCommands = new Map(
  gatedCapabilities.flatMap((capability) =>
    (capability.cliCommands ?? []).map((command) => [command, capability] as const),
  ),
);
const gatedCapabilitiesByCommand = new Map(
  gatedCapabilities.map((capability) => [capability.command, capability] as const),
);

type CliRequestBuilder = (
  args: readonly string[],
  dependencies: CliDependencies,
  context: CliRequestBuildContext,
) => Promise<RequestEnvelope> | RequestEnvelope;

type CliRequestBuildContext = {
  readonly uploadBudget: UploadBudget;
};

type CliRouteBinding = {
  readonly route: CliRouteMetadata;
  readonly command: CommandId;
  readonly help: string;
  readonly buildRequest: CliRequestBuilder;
};

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
    "firefox-cli network list|clear [--json]",
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

export type CliDependencies = {
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly homeDir: string;
  readonly appDataDir?: string;
  readonly packageRoot: string;
  readonly binaryPath?: string;
  readonly extensionPath?: string;
  readonly cwd?: string;
  sendRequest?(request: RequestEnvelope): Promise<ResponseEnvelope>;
  readStdin?(): Promise<string>;
  statUploadFile?(path: string): Promise<CliUploadFileStat>;
  readUploadFile?(path: string, limits: UploadReadLimits): Promise<Uint8Array>;
  clearPairState?(): Promise<void>;
};

export type CliUploadFileStat = {
  readonly size: number;
  readonly isFile: boolean;
};

export type UploadReadLimits = {
  readonly maxFileBytes: number;
  readonly maxRemainingTotalBytes: number;
};

export async function runCli(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  try {
    return await runCliOrThrow(args, dependencies);
  } catch (error) {
    if (error instanceof CliUsageError) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${error.message}\n`,
      };
    }

    throw error;
  }
}

async function runCliOrThrow(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  if (args.includes("--version") || args.includes("-V")) {
    return ok(`${dependencies.version}\n`);
  }

  if (args[0] === "setup") {
    return setup(args.slice(1), dependencies);
  }

  if (args[0] === "doctor") {
    return doctor(args.slice(1), dependencies);
  }

  if (args[0] === "unpair") {
    await dependencies.clearPairState?.();
    return ok("Pair state cleared. Approve firefox-cli again from the extension popup.\n");
  }

  const routeBinding = findCliRouteBindingForArgv(args);
  if (routeBinding !== undefined) {
    return runCliRouteBinding(routeBinding, args, dependencies);
  }

  const gated = args[0] === undefined ? undefined : gatedCliCommands.get(args[0]);
  if (gated !== undefined) {
    return error(formatGatedCapability(gated.command));
  }

  return {
    exitCode: args.length === 0 ? 0 : 1,
    stdout: renderHelp(),
    stderr: "",
  };
}

async function runCliRouteBinding(
  binding: CliRouteBinding,
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const request = await binding.buildRequest(argv, dependencies, {
    uploadBudget: createUploadBudget(),
  });
  const response = await sendOrUnavailable(dependencies, request);
  return formatCliResponse(request.command, response, argv);
}

type SuccessfulResponse<C extends CommandId> = Extract<ResponseEnvelope<C>, { readonly ok: true }>;

function responseResult<C extends CommandId>(
  response: ResponseEnvelope<C>,
): SuccessfulResponse<C>["result"] {
  return (response as SuccessfulResponse<C>).result;
}

function formatCliResponse<C extends CommandId>(
  command: C,
  response: ResponseEnvelope<C>,
  argv: readonly string[],
): CliResult {
  const json = cliRouteWantsJsonOutput(command, argv);
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  switch (command) {
    case "capabilities": {
      const result = responseResult(response as ResponseEnvelope<"capabilities">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(
            `${result.capabilities
              .map((capability) => `${capability.command}\t${capability.status}`)
              .join("\n")}\n`,
          );
    }

    case "tabs.list": {
      const result = responseResult(response as ResponseEnvelope<"tabs.list">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(result.tabs.map(renderTabSummary).join(""));
    }

    case "tab.new":
    case "tab.select":
    case "open":
    case "back":
    case "forward":
    case "reload": {
      const result = responseResult(
        response as ResponseEnvelope<
          "tab.new" | "tab.select" | "open" | "back" | "forward" | "reload"
        >,
      );
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(`${renderTargetSummary(result.target)}\n`);
    }

    case "tab.close": {
      const result = responseResult(response as ResponseEnvelope<"tab.close">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(`Closed tab ${result.closedTabId}\n`);
    }

    case "windows.list": {
      const result = responseResult(response as ResponseEnvelope<"windows.list">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(
            result.windows
              .map(
                (window) =>
                  `${window.focused ? "*" : " "} w${window.id} [${window.index}] tabs=${
                    window.tabCount
                  }${window.activeTabId === undefined ? "" : ` active=t${window.activeTabId}`}\n`,
              )
              .join(""),
          );
    }

    case "window.new":
    case "window.select": {
      const result = responseResult(response as ResponseEnvelope<"window.new" | "window.select">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(`w${result.window.id} [${result.window.index}]\n`);
    }

    case "window.close": {
      const result = responseResult(response as ResponseEnvelope<"window.close">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(`Closed window ${result.closedWindowId}\n`);
    }

    case "snapshot": {
      const result = responseResult(response as ResponseEnvelope<"snapshot">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(result.text.endsWith("\n") ? result.text : `${result.text}\n`);
    }

    case "ref.resolve": {
      const result = responseResult(response as ResponseEnvelope<"ref.resolve">);
      if (json) {
        return ok(`${JSON.stringify(result, null, 2)}\n`);
      }
      const element = result.element;
      return ok(
        `${element.ref} ${element.role} ${element.name ?? element.text ?? element.tagName} (${element.generationId})\n`,
      );
    }

    case "get": {
      const result = responseResult(response as ResponseEnvelope<"get">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(`${formatGetValue(result.value)}\n`);
    }

    case "is": {
      const result = responseResult(response as ResponseEnvelope<"is">);
      return json ? ok(`${JSON.stringify(result, null, 2)}\n`) : ok(`${result.value}\n`);
    }

    case "wait": {
      const result = responseResult(response as ResponseEnvelope<"wait">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(`${formatWaitResult(result)}\n`);
    }

    case "eval": {
      const result = responseResult(response as ResponseEnvelope<"eval">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(`${formatEvalResult(result)}\n`);
    }

    case "screenshot": {
      const result = responseResult(response as ResponseEnvelope<"screenshot">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(`${formatScreenshotResult(result)}\n`);
    }

    case "find": {
      const result = responseResult(response as ResponseEnvelope<"find">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(
            result.elements
              .map(
                (element) =>
                  `${element.ref ?? ""} ${element.role} ${element.name ?? element.text ?? element.tagName}\n`,
              )
              .join(""),
          );
    }

    case "frame": {
      const result = responseResult(response as ResponseEnvelope<"frame">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(
            result.frames
              .map((frame) => `${frame.index} ${frame.title ?? ""} ${frame.url ?? ""}\n`)
              .join(""),
          );
    }

    case "batch": {
      const result = responseResult(response as ResponseEnvelope<"batch">);
      return {
        exitCode: result.ok ? 0 : 1,
        stdout: json ? `${JSON.stringify(result, null, 2)}\n` : `${formatBatchResult(result)}\n`,
        stderr: "",
      };
    }

    default:
      return isActionResponseCommand(command)
        ? formatActionResponse(response as ResponseEnvelope<ActionResponseCommand>, json)
        : formatJsonOrObject(response as ResponseEnvelope<CommandId>, json);
  }
}

type ActionResponseCommand =
  | "click"
  | "dblclick"
  | "focus"
  | "hover"
  | "drag"
  | "upload"
  | "mouse"
  | "keydown"
  | "keyup"
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
  | "swipe";

function isActionResponseCommand(command: CommandId): command is ActionResponseCommand {
  return (
    command === "click" ||
    command === "dblclick" ||
    command === "focus" ||
    command === "hover" ||
    command === "drag" ||
    command === "upload" ||
    command === "mouse" ||
    command === "keydown" ||
    command === "keyup" ||
    command === "fill" ||
    command === "type" ||
    command === "press" ||
    command === "keyboard.type" ||
    command === "keyboard.inserttext" ||
    command === "check" ||
    command === "uncheck" ||
    command === "select" ||
    command === "scroll" ||
    command === "scrollintoview" ||
    command === "swipe"
  );
}

function cliRouteWantsJsonOutput(command: CommandId, argv: readonly string[]): boolean {
  const args = argv.slice(1);
  switch (command) {
    case "eval":
      return parseEvalArguments(args).json;
    case "screenshot":
      return parseScreenshotArguments(args).json;
    case "batch":
      return parseBatchArguments(args).json;
    case "find":
      return parsePayloadPositionalsAndOptions(args, {
        payloadStartPositionals: 1,
        minPositionals: 2,
      }).optionArgs.includes("--json");
    case "clipboard":
      return parsePayloadPositionalsAndOptions(args, {
        payloadStartPositionals: 1,
        minPositionals: 1,
      }).optionArgs.includes("--json");
    case "cookies":
    case "storage":
      return parsePayloadPositionalsAndOptions(args, {
        payloadStartPositionals: 2,
        minPositionals: 2,
      }).optionArgs.includes("--json");
    case "diff":
      return parsePayloadPositionalsAndOptions(args, {
        payloadStartPositionals: 1,
        minPositionals: 2,
      }).optionArgs.includes("--json");
    case "fill":
    case "type":
    case "keyboard.type":
    case "keyboard.inserttext":
      return parsePayloadPositionalsAndOptions(args, {
        payloadStartPositionals: 1,
        minPositionals: 2,
      }).optionArgs.includes("--json");
    case "select":
      return parseSelectArguments(args).optionArgs.includes("--json");
    case "drag":
    case "upload":
    case "mouse":
    case "keydown":
    case "keyup":
    case "click":
    case "dblclick":
    case "focus":
    case "hover":
    case "check":
    case "uncheck":
    case "press":
    case "scroll":
    case "scrollintoview":
    case "swipe":
      return parsePositionalsAndOptions(args, {
        preserveUnknownOptions: command === "upload",
      }).optionArgs.includes("--json");
    default:
      return args.includes("--json");
  }
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

export function createDefaultDependencies(version: string): CliDependencies {
  const binaryPath = process.execPath;
  const packageRoot = resolve(dirname(binaryPath), "../..");
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";

  return {
    version,
    platform: process.platform,
    arch: process.arch,
    homeDir,
    ...(process.env.APPDATA === undefined ? {} : { appDataDir: process.env.APPDATA }),
    packageRoot,
    binaryPath,
    cwd: process.cwd(),
    sendRequest: async (request) => {
      const stateRoot = getUserStateRoot(process.platform, homeDir, process.env.APPDATA);
      const endpoint = planLocalIpcEndpoint({
        platform: process.platform,
        rootDir: stateRoot,
      });
      const authToken = await new FileLocalIpcAuthTokenStore({ stateRoot }).read();
      return sendLocalIpcRequest(endpoint, request, { authToken });
    },
    clearPairState: async () => {
      await new FilePairStateStore({
        rootDir: homeDir,
        platform: process.platform,
        ...(process.env.APPDATA === undefined ? {} : { appDataDir: process.env.APPDATA }),
      }).clear();
    },
  };
}

export function getDefaultStateRoot(
  platform: NodeJS.Platform,
  homeDir: string,
  appDataDir: string | undefined,
): string {
  return getUserStateRoot(platform, homeDir, appDataDir);
}

async function setup(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  if (args[0] === "native-host") {
    return setupNativeHost(args, dependencies);
  }

  if (args.length === 0 || args.includes("--json")) {
    const plan = await createManifestPlan(dependencies);
    const extensionPath = await resolveExtensionInstallPath(dependencies);
    if (args.includes("--json")) {
      return ok(
        `${JSON.stringify(
          {
            extensionPath,
            nativeHostManifestPath: plan.manifestPath,
          },
          null,
          2,
        )}\n`,
      );
    }

    return ok(
      [
        "firefox-cli setup",
        formatExtensionSetupInstruction(extensionPath),
        "Native host: run `firefox-cli setup native-host`.",
        "",
      ].join("\n"),
    );
  }

  if (args[0] !== "native-host") {
    return { exitCode: 1, stdout: renderHelp(), stderr: "" };
  }

  return setupNativeHost(args, dependencies);
}

async function setupNativeHost(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const dryRun = args.includes("--dry-run");
  const json = args.includes("--json");
  const plan = await createManifestPlan(dependencies);

  if (!dryRun) {
    await writeNativeMessagingManifest(plan);
  }

  if (json) {
    return ok(`${JSON.stringify({ ...plan, dryRun }, null, 2)}\n`);
  }

  return ok(
    [
      `Native host manifest ${dryRun ? "planned" : "installed"}: ${plan.manifestPath}`,
      plan.registration.kind === "windows-registry"
        ? `Registry key to set: ${plan.registration.hive}\\${plan.registration.key}`
        : "Firefox will discover this per-user manifest automatically.",
      "",
    ].join("\n"),
  );
}

async function doctor(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const fix = args.includes("--fix");
  const json = args.includes("--json");
  const plan = await createManifestPlan(dependencies);
  let manifestStatus = await readNativeHostManifestStatus(plan);
  if (manifestStatus.status !== "installed" && fix) {
    await writeNativeMessagingManifest(plan);
    manifestStatus = { status: "installed", path: plan.manifestPath };
  }

  const connection = await checkExtensionConnection(dependencies);
  const payload = {
    nativeHostManifest: manifestStatus,
    extensionConnection: connection,
  };
  const setupHealthy = manifestStatus.status === "installed";

  if (json) {
    return {
      exitCode: setupHealthy && connection.status === "connected" ? 0 : 1,
      stdout: `${JSON.stringify(payload, null, 2)}\n`,
      stderr: "",
    };
  }

  return {
    exitCode: setupHealthy && connection.status === "connected" ? 0 : 1,
    stdout: [
      "firefox-cli doctor",
      `Native host manifest: ${payload.nativeHostManifest.status}`,
      `Path: ${plan.manifestPath}`,
      payload.nativeHostManifest.status === "stale"
        ? `Installed path: ${payload.nativeHostManifest.installedPath}`
        : undefined,
      payload.nativeHostManifest.status === "invalid"
        ? `Validation error: ${payload.nativeHostManifest.reason}`
        : undefined,
      `Extension connection: ${connection.status}`,
      "nextAction" in payload.nativeHostManifest
        ? `Next action: ${payload.nativeHostManifest.nextAction}`
        : undefined,
      connection.nextAction === undefined
        ? undefined
        : `Connection next action: ${connection.nextAction}`,
      "",
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
    stderr: "",
  };
}

function createValidatedRequest<C extends CommandId>(
  command: C,
  params: unknown,
): RequestEnvelope<C> {
  return createRequest(command, validateCommandParams(command, params) as never);
}

function validateProtocolRequest<C extends CommandId>(
  request: RequestEnvelope<C>,
): RequestEnvelope<C> {
  return {
    ...request,
    params: validateCommandParams(request.command, request.params) as RequestEnvelope<C>["params"],
  };
}

function validateCommandParams<C extends CommandId>(
  command: C,
  params: unknown,
): RequestEnvelope<C>["params"] {
  const parsed = commandSchemas[command].params.safeParse(params);
  if (parsed.success) {
    return parsed.data as RequestEnvelope<C>["params"];
  }

  const firstIssue = parsed.error.issues[0];
  const path = firstIssue?.path.length === 0 ? "" : ` at ${firstIssue?.path.join(".")}`;
  throw new CliUsageError(
    firstIssue === undefined
      ? `Invalid ${command} request.`
      : `Invalid ${command} request${path}: ${firstIssue.message}`,
  );
}

function buildCapabilitiesRequest(argv: readonly string[]): RequestEnvelope {
  parseTargetOptions(argv.slice(1));
  return createValidatedRequest("capabilities", {});
}

function buildTabsRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const positional = getPositionals(args);
  const subcommand = positional[0];
  const target = parseTargetOptions(args);
  if (subcommand === "new") {
    return createValidatedRequest("tab.new", {
      ...optionalUrl(normalizeOptionalUrl(positional[1])),
      ...optionalTarget(target),
    });
  }
  if (subcommand === "select") {
    return createValidatedRequest("tab.select", {
      target: mergeTarget(target, parseOptionalTabTarget(positional[1], target)),
    });
  }
  if (subcommand === "close") {
    return createValidatedRequest("tab.close", {
      target: mergeTarget(target, parseOptionalTabTarget(positional[1], target)),
    });
  }
  return createValidatedRequest("tabs.list", {
    ...optionalTarget(target),
  });
}

function buildWindowsRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const positional = getPositionals(args);
  const subcommand = positional[0];
  const target = parseTargetOptions(args);
  if (subcommand === "new") {
    return createValidatedRequest("window.new", {
      ...optionalUrl(normalizeOptionalUrl(positional[1])),
    });
  }
  if (subcommand === "select") {
    return createValidatedRequest("window.select", {
      target: mergeTarget(target, parseOptionalWindowTarget(positional[1], target)),
    });
  }
  if (subcommand === "close") {
    return createValidatedRequest("window.close", {
      target: mergeTarget(target, parseOptionalWindowTarget(positional[1], target)),
    });
  }
  return createValidatedRequest("windows.list", {});
}

function buildOpenRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const url = normalizeOptionalUrl(getPositionals(args)[0]);
  if (url === undefined) {
    throw new CliUsageError("Missing URL.");
  }
  return createValidatedRequest("open", {
    url,
    newTab: args.includes("--new-tab"),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

function buildNavigationRequest(argv: readonly string[]): RequestEnvelope {
  const command = argv[0];
  if (command !== "back" && command !== "forward" && command !== "reload") {
    throw new CliUsageError("Invalid navigation command.");
  }
  const args = argv.slice(1);
  return createValidatedRequest(command, {
    ...optionalTarget(parseTargetOptions(args)),
  });
}

function buildSnapshotRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  return createValidatedRequest("snapshot", {
    interactiveOnly: args.includes("-i") || args.includes("--interactive"),
    compact: args.includes("-c") || args.includes("--compact") || !args.includes("--verbose"),
    ...optionalPositiveInteger(args, ["-d", "--depth"], "depth", "maxDepth"),
    ...optionalStringOption(args, ["-s", "--selector"], "selector"),
    ...optionalPositiveInteger(args, ["--max-output"], "max output", "maxOutputBytes"),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

function buildRefRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const ref = getPositionals(args)[0];
  if (ref === undefined) {
    throw new CliUsageError("Missing ref.");
  }
  return createValidatedRequest("ref.resolve", {
    ref,
    ...optionalStringOption(args, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

function buildGetRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const positional = getPositionals(args);
  const kind = positional[0];
  if (!isGetKind(kind)) {
    throw new CliUsageError("Missing or invalid get kind.");
  }
  const elementTarget = positional[1];
  const attribute = positional[2];
  if (kind === "attr" && attribute === undefined) {
    throw new CliUsageError("Missing attribute name.");
  }
  if ((kind === "title" || kind === "url") && elementTarget !== undefined) {
    throw new CliUsageError(`get ${kind} does not accept a selector or ref.`);
  }
  if (kind !== "title" && kind !== "url" && elementTarget === undefined) {
    throw new CliUsageError("Missing selector or ref.");
  }
  return createValidatedRequest("get", {
    kind,
    ...parseElementTarget(elementTarget),
    ...(kind === "attr" && attribute !== undefined ? { attribute } : {}),
    ...optionalStringOption(args, ["--generation"], "generationId"),
    ...optionalPositiveInteger(args, ["--max-output"], "max output", "maxOutputBytes"),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

function buildIsRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const positional = getPositionals(args);
  const kind = positional[0];
  if (!isIsKind(kind)) {
    throw new CliUsageError("Missing or invalid is kind.");
  }
  const elementTarget = positional[1];
  if (elementTarget === undefined) {
    throw new CliUsageError("Missing selector or ref.");
  }
  return createValidatedRequest("is", {
    kind,
    ...parseElementTarget(elementTarget),
    ...optionalStringOption(args, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

function buildWaitRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const waitArgs = parseWaitArguments(args);
  return createValidatedRequest("wait", {
    ...parseWaitParams(waitArgs),
    ...(waitArgs.timeout === undefined
      ? {}
      : { timeoutMs: parsePositiveIntegerValue(waitArgs.timeout, "timeout") }),
    ...(waitArgs.interval === undefined
      ? {}
      : { intervalMs: parsePositiveIntegerValue(waitArgs.interval, "interval") }),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

async function buildEvalRequest(
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<RequestEnvelope> {
  const parsedArgs = parseEvalArguments(argv.slice(1));
  const script = await readEvalScript(parsedArgs, dependencies);
  return createValidatedRequest("eval", {
    script,
    source: parsedArgs.source,
    ...(parsedArgs.timeout === undefined
      ? {}
      : { timeoutMs: parsePositiveIntegerValue(parsedArgs.timeout, "timeout") }),
    ...(parsedArgs.maxResultBytes === undefined
      ? {}
      : { maxResultBytes: parsePositiveIntegerValue(parsedArgs.maxResultBytes, "max output") }),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

function buildScreenshotRequest(
  argv: readonly string[],
  dependencies: CliDependencies,
): RequestEnvelope {
  const parsedArgs = parseScreenshotArguments(argv.slice(1));
  const outputPath = resolve(
    dependencies.cwd ?? process.cwd(),
    parsedArgs.outputPath ?? "screenshot.png",
  );
  return createValidatedRequest("screenshot", {
    path: outputPath,
    format: parsedArgs.format,
    ...(parsedArgs.fullPage ? { fullPage: true } : {}),
    ...(parsedArgs.quality === undefined
      ? {}
      : { quality: parsePositiveIntegerValue(parsedArgs.quality, "quality") }),
    ...(parsedArgs.timeout === undefined
      ? {}
      : { timeoutMs: parsePositiveIntegerValue(parsedArgs.timeout, "timeout") }),
    ...(parsedArgs.maxImageBytes === undefined
      ? {}
      : { maxImageBytes: parsePositiveIntegerValue(parsedArgs.maxImageBytes, "max output") }),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

function buildDragRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePositionalsAndOptions(argv.slice(1));
  const [source, target] = parsed.positionals;
  if (source === undefined || target === undefined) {
    throw new CliUsageError("Missing drag source or target.");
  }
  return createValidatedRequest("drag", {
    ...sourceDragTarget(source, "source"),
    ...sourceDragTarget(target, "target"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

async function buildUploadRequest(
  argv: readonly string[],
  dependencies: CliDependencies,
  context: CliRequestBuildContext,
): Promise<RequestEnvelope> {
  const parsed = parseUploadArguments(argv.slice(1));
  return createValidatedRequest(
    "upload",
    await createUploadParams(parsed, dependencies, context.uploadBudget),
  );
}

function buildMouseRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePositionalsAndOptions(argv.slice(1));
  const action = parsed.positionals[0];
  if (action !== "move" && action !== "down" && action !== "up" && action !== "wheel") {
    throw new CliUsageError("Missing or invalid mouse action.");
  }
  return createValidatedRequest("mouse", {
    action,
    ...parseElementTarget(parsed.positionals[1]),
    ...optionalNumberOption(parsed.optionArgs, ["--x"], "x"),
    ...optionalNumberOption(parsed.optionArgs, ["--y"], "y"),
    ...optionalNumberOption(parsed.optionArgs, ["--button"], "button"),
    ...optionalNumberOption(parsed.optionArgs, ["--delta-x"], "deltaX"),
    ...optionalNumberOption(parsed.optionArgs, ["--delta-y"], "deltaY"),
    ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

function buildKeyEventRequest(argv: readonly string[]): RequestEnvelope {
  const command = argv[0];
  if (command !== "keydown" && command !== "keyup") {
    throw new CliUsageError("Invalid key event command.");
  }
  const parsed = parsePositionalsAndOptions(argv.slice(1));
  const key = parsed.positionals[0];
  if (key === undefined) {
    throw new CliUsageError("Missing key.");
  }
  return createValidatedRequest(command, {
    key,
    ...parseElementTarget(parsed.positionals[1]),
    ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

function buildFindRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 1,
    minPositionals: 2,
  });
  const [kind, value] = parsed.positionals;
  if (!isFindKind(kind) || value === undefined) {
    throw new CliUsageError("Missing or invalid find kind/value.");
  }
  return createValidatedRequest("find", {
    kind,
    value,
    ...optionalBooleanFlag(parsed.optionArgs, "--first", "first"),
    ...optionalBooleanFlag(parsed.optionArgs, "--last", "last"),
    ...optionalPositiveInteger(parsed.optionArgs, ["--nth"], "nth", "nth"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

function buildFrameRequest(argv: readonly string[]): RequestEnvelope {
  return createValidatedRequest("frame", { ...optionalTarget(parseTargetOptions(argv.slice(1))) });
}

function buildDownloadRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  parseTargetOptions(args);
  const positional = getPositionals(args);
  const url = normalizeOptionalUrl(positional[0]);
  if (url === undefined) {
    throw new CliUsageError("Missing download URL.");
  }
  return createValidatedRequest("download", {
    url,
    ...(positional[1] === undefined ? {} : { filename: positional[1] }),
    saveAs: args.includes("--save-as"),
  });
}

function buildDialogRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const positional = getPositionals(args, { preserveUnknownOptions: true });
  const action = positional[0] ?? "status";
  if (!isDialogAction(action)) {
    throw new CliUsageError("Missing or invalid dialog action.");
  }
  return createValidatedRequest("dialog", {
    action,
    ...(positional[1] === undefined ? {} : { promptText: positional[1] }),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

function buildClipboardRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 1,
    minPositionals: 1,
  });
  const action = parsed.positionals[0] ?? "read";
  if (!isClipboardAction(action)) {
    throw new CliUsageError("Missing or invalid clipboard action.");
  }
  const value = parsed.positionals[1];
  return createValidatedRequest("clipboard", {
    action,
    ...(action === "write" ? { text: value ?? "" } : parseElementTarget(value)),
    ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

function buildCookiesRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 2,
    minPositionals: 2,
  });
  parseTargetOptions(parsed.optionArgs);
  const [action, url, name, value] = parsed.positionals;
  if (!isCookieAction(action) || url === undefined) {
    throw new CliUsageError("Missing or invalid cookies action/url.");
  }
  return createValidatedRequest("cookies", {
    action,
    url: normalizeOptionalUrl(url) ?? url,
    ...(name === undefined ? {} : { name }),
    ...(value === undefined ? {} : { value }),
  });
}

function buildStorageRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 2,
    minPositionals: 2,
  });
  const [area, action, key, value] = parsed.positionals;
  if (!isStorageArea(area) || !isStorageAction(action)) {
    throw new CliUsageError("Missing or invalid storage area/action.");
  }
  return createValidatedRequest("storage", {
    area,
    action,
    ...(key === undefined ? {} : { key }),
    ...(value === undefined ? {} : { value }),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

function buildNetworkRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  parseTargetOptions(args);
  const action = getPositionals(args)[0] ?? "list";
  if (!isNetworkAction(action)) {
    throw new CliUsageError("Missing or invalid network action.");
  }
  return createValidatedRequest("network", {
    action,
    ...optionalStringOption(args, ["--url"], "urlGlob"),
  });
}

function buildLogRequest(argv: readonly string[]): RequestEnvelope {
  const command = argv[0];
  if (command !== "console" && command !== "errors") {
    throw new CliUsageError("Invalid log command.");
  }
  const args = argv.slice(1);
  const action = getPositionals(args)[0] ?? "list";
  if (!isLogAction(action)) {
    throw new CliUsageError(`Missing or invalid ${command} action.`);
  }
  return createValidatedRequest(command, { action, ...optionalTarget(parseTargetOptions(args)) });
}

function buildHighlightRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePositionalsAndOptions(argv.slice(1));
  const elementTarget = parsed.positionals[0];
  if (elementTarget === undefined) {
    throw new CliUsageError("Missing selector or ref.");
  }
  return createValidatedRequest("highlight", {
    ...parseElementTarget(elementTarget),
    ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
    ...optionalPositiveInteger(parsed.optionArgs, ["--duration"], "duration", "durationMs"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

function buildPdfRequest(argv: readonly string[], dependencies: CliDependencies): RequestEnvelope {
  const path = getPositionals(argv.slice(1))[0];
  if (path === undefined) {
    throw new CliUsageError("Missing PDF path.");
  }
  return createValidatedRequest("pdf", {
    path: resolve(dependencies.cwd ?? process.cwd(), path),
    ...optionalTarget(parseTargetOptions(argv.slice(1))),
  });
}

function buildSetViewportRequest(argv: readonly string[]): RequestEnvelope {
  const args = argv.slice(1);
  const positional = getPositionals(args);
  if (positional[0] !== "viewport") {
    throw new CliUsageError("Missing or invalid set command.");
  }
  return createValidatedRequest("set.viewport", {
    width: parsePositiveIntegerValue(positional[1] ?? "", "width"),
    height: parsePositiveIntegerValue(positional[2] ?? "", "height"),
    ...optionalTarget(parseTargetOptions(args)),
  });
}

function buildDiffRequest(argv: readonly string[]): RequestEnvelope {
  const parsed = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 1,
    minPositionals: 2,
  });
  const [kind, expected] = parsed.positionals;
  if (!isDiffKind(kind) || expected === undefined) {
    throw new CliUsageError("Missing or invalid diff kind/expected value.");
  }
  return createValidatedRequest("diff", {
    kind,
    expected,
    ...optionalStringOption(parsed.optionArgs, ["--selector"], "selector"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  });
}

async function buildBatchRequest(
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<RequestEnvelope> {
  const parsedArgs = parseBatchArguments(argv.slice(1));
  const steps = await readBatchSteps(parsedArgs, dependencies);
  const params = parseBatchParamsForCli({
    steps,
    ...(parsedArgs.bail ? { bail: true } : {}),
    ...(parsedArgs.timeout === undefined
      ? {}
      : { timeoutMs: parsePositiveIntegerValue(parsedArgs.timeout, "timeout") }),
    ...(parsedArgs.maxResultBytes === undefined
      ? {}
      : { maxResultBytes: parsePositiveIntegerValue(parsedArgs.maxResultBytes, "max output") }),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
  return createValidatedRequest("batch", params);
}

function buildElementActionRequest(argv: readonly string[]): RequestEnvelope {
  const command = argv[0];
  if (!isElementActionCommand(command)) {
    throw new CliUsageError("Invalid element action command.");
  }
  const parsedArgs = parsePositionalsAndOptions(argv.slice(1));
  const elementTarget = parsedArgs.positionals[0];
  if (elementTarget === undefined) {
    throw new CliUsageError("Missing selector or ref.");
  }
  return createValidatedRequest(command, {
    ...parseElementTarget(elementTarget),
    ...optionalStringOption(parsedArgs.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

function buildTextActionRequest(argv: readonly string[]): RequestEnvelope {
  const command = argv[0];
  if (command !== "fill" && command !== "type") {
    throw new CliUsageError("Invalid text action command.");
  }
  const parsedArgs = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 1,
    minPositionals: 2,
  });
  const elementTarget = parsedArgs.positionals[0];
  const text = parsedArgs.positionals[1];
  if (elementTarget === undefined) {
    throw new CliUsageError("Missing selector or ref.");
  }
  if (text === undefined) {
    throw new CliUsageError("Missing text.");
  }
  return createValidatedRequest(command, {
    ...parseElementTarget(elementTarget),
    text,
    ...optionalStringOption(parsedArgs.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

function buildPressRequest(argv: readonly string[]): RequestEnvelope {
  const parsedArgs = parsePositionalsAndOptions(argv.slice(1));
  const key = parsedArgs.positionals[0];
  if (key === undefined) {
    throw new CliUsageError("Missing key.");
  }
  return createValidatedRequest("press", {
    key,
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

function buildKeyboardRequest(argv: readonly string[]): RequestEnvelope {
  const parsedArgs = parsePayloadPositionalsAndOptions(argv.slice(1), {
    payloadStartPositionals: 1,
    minPositionals: 2,
  });
  const subcommand = parsedArgs.positionals[0];
  const text = parsedArgs.positionals[1];
  if (subcommand !== "type" && subcommand !== "inserttext") {
    throw new CliUsageError("Missing or invalid keyboard command.");
  }
  if (text === undefined) {
    throw new CliUsageError("Missing text.");
  }
  return createValidatedRequest(subcommand === "type" ? "keyboard.type" : "keyboard.inserttext", {
    text,
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

function buildSelectRequest(argv: readonly string[]): RequestEnvelope {
  const parsedArgs = parseSelectArguments(argv.slice(1));
  const elementTarget = parsedArgs.positionals[0];
  const values = parsedArgs.positionals.slice(1);
  if (elementTarget === undefined) {
    throw new CliUsageError("Missing selector or ref.");
  }
  if (values.length === 0) {
    throw new CliUsageError("Missing select value.");
  }
  return createValidatedRequest("select", {
    ...parseElementTarget(elementTarget),
    values,
    ...optionalStringOption(parsedArgs.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

function parseSelectArguments(args: readonly string[]): {
  readonly positionals: readonly string[];
  readonly optionArgs: readonly string[];
} {
  const positionals: string[] = [];
  const optionArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--json") {
      optionArgs.push(arg);
      continue;
    }

    if (arg === "--tab" || arg === "--window") {
      const value = readFlagValue(args, index, arg);
      optionArgs.push(arg, value);
      index += 1;
      continue;
    }

    if (arg === "--generation") {
      const value = args[index + 1];
      if (value !== undefined) {
        optionArgs.push(arg, value);
        index += 1;
        continue;
      }
    }

    positionals.push(arg);
  }

  return { positionals, optionArgs };
}

function buildScrollRequest(argv: readonly string[]): RequestEnvelope {
  const command = argv[0];
  if (command !== "scroll" && command !== "swipe") {
    throw new CliUsageError("Invalid scroll command.");
  }
  const parsedArgs = parsePositionalsAndOptions(argv.slice(1));
  const direction = parsedArgs.positionals[0];
  if (!isScrollDirection(direction)) {
    throw new CliUsageError(`Invalid direction: ${direction ?? ""}`);
  }
  const maybeDistance = parsedArgs.positionals[1];
  const hasDistance = maybeDistance !== undefined && /^\d+$/u.test(maybeDistance);
  const distancePx = hasDistance ? Number(maybeDistance) : undefined;
  const elementTarget = hasDistance ? parsedArgs.positionals[2] : parsedArgs.positionals[1];
  return createValidatedRequest(command, {
    direction,
    ...(distancePx === undefined ? {} : { distancePx }),
    ...parseElementTarget(elementTarget),
    ...optionalStringOption(parsedArgs.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
  });
}

async function createManifestPlan(dependencies: CliDependencies) {
  if (dependencies.binaryPath !== undefined) {
    return planNativeMessagingManifest({
      binaryPath: dependencies.binaryPath,
      platform: dependencies.platform,
      homeDir: dependencies.homeDir,
      ...optionalAppDataDir(dependencies.appDataDir),
    });
  }

  return planNativeMessagingManifest({
    packageRoot: dependencies.packageRoot,
    platform: dependencies.platform,
    arch: dependencies.arch,
    homeDir: dependencies.homeDir,
    ...optionalAppDataDir(dependencies.appDataDir),
  });
}

async function resolveExtensionInstallPath(dependencies: CliDependencies): Promise<string> {
  if (dependencies.extensionPath !== undefined) {
    return dependencies.extensionPath;
  }

  const signedXpiPath = resolve(dependencies.packageRoot, "extension/firefox-cli.xpi");
  try {
    await access(signedXpiPath);
    return signedXpiPath;
  } catch {
    return resolve(dependencies.packageRoot, "extension/development");
  }
}

function formatExtensionSetupInstruction(extensionPath: string): string {
  return extensionPath.endsWith(".xpi")
    ? `Extension: install ${extensionPath} in Firefox.`
    : `Extension: load ${extensionPath} in Firefox about:debugging.`;
}

async function readNativeHostManifestStatus(
  plan: Awaited<ReturnType<typeof createManifestPlan>>,
): Promise<
  | {
      readonly status: "installed";
      readonly path: string;
    }
  | {
      readonly status: "missing";
      readonly path: string;
      readonly nextAction: string;
    }
  | {
      readonly status: "stale";
      readonly path: string;
      readonly installedPath: string;
      readonly expectedPath: string;
      readonly nextAction: string;
    }
  | {
      readonly status: "invalid";
      readonly path: string;
      readonly reason: string;
      readonly nextAction: string;
    }
> {
  let content: string;
  try {
    content = await readFile(plan.manifestPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        status: "missing",
        path: plan.manifestPath,
        nextAction: "Run `firefox-cli setup native-host`.",
      };
    }
    throw error;
  }

  let installed: typeof plan.manifest;
  try {
    installed = parseNativeMessagingManifestJson(content, plan.manifestPath);
  } catch (error) {
    if (isPersistedJsonFileError(error)) {
      return {
        status: "invalid",
        path: plan.manifestPath,
        reason: error.message,
        nextAction: "Run `firefox-cli doctor --fix`.",
      };
    }
    throw error;
  }

  if (!isNativeMessagingManifestCanonical(installed, plan.manifest)) {
    return {
      status: "stale",
      path: plan.manifestPath,
      installedPath: installed.path,
      expectedPath: plan.manifest.path,
      nextAction: "Run `firefox-cli doctor --fix`.",
    };
  }

  return {
    status: "installed",
    path: plan.manifestPath,
  };
}

function isNativeMessagingManifestCanonical(
  installed: Awaited<ReturnType<typeof createManifestPlan>>["manifest"],
  expected: Awaited<ReturnType<typeof createManifestPlan>>["manifest"],
): boolean {
  return (
    installed.name === expected.name &&
    installed.description === expected.description &&
    installed.path === expected.path &&
    installed.type === expected.type &&
    installed.allowed_extensions.length === expected.allowed_extensions.length &&
    installed.allowed_extensions.every(
      (value, index) => value === expected.allowed_extensions[index],
    )
  );
}

async function checkExtensionConnection(dependencies: CliDependencies): Promise<{
  readonly status:
    | "connected"
    | "not-approved"
    | "version-mismatch"
    | "pairing-mismatch"
    | "disconnected";
  readonly nextAction?: string;
}> {
  const response = await sendOrUnavailable(dependencies, createRequest("noop", {}));
  if (response.ok) {
    return { status: "connected" };
  }

  if (response.error.code === "NOT_APPROVED") {
    return {
      status: "not-approved",
      nextAction: "Open the firefox-cli extension popup and approve this native host.",
    };
  }

  if (response.error.code === "VERSION_MISMATCH") {
    return {
      status: "version-mismatch",
      nextAction:
        "Upgrade/rebuild firefox-cli, the native host, and the extension so their protocol versions match.",
    };
  }

  if (response.error.code === "PAIRING_MISMATCH") {
    return {
      status: "pairing-mismatch",
      nextAction: response.error.message,
    };
  }

  return {
    status: "disconnected",
    nextAction: "Load the extension in Firefox and keep Firefox running.",
  };
}

async function sendOrUnavailable<C extends CommandId>(
  dependencies: CliDependencies,
  request: RequestEnvelope<C>,
): Promise<ResponseEnvelope<C>> {
  const validatedRequest = validateProtocolRequest(request);
  try {
    if (dependencies.sendRequest === undefined) {
      throw new LocalIpcError("CONNECTION_FAILED", "No native host IPC client is configured.");
    }
    return (await dependencies.sendRequest(validatedRequest)) as ResponseEnvelope<C>;
  } catch (error) {
    if (error instanceof LocalIpcError) {
      return {
        protocolVersion: validatedRequest.protocolVersion,
        id: validatedRequest.id,
        ok: false,
        error: {
          code: "NATIVE_HOST_UNAVAILABLE",
          message: "firefox-cli native host is not running.",
        },
      };
    }
    throw error;
  }
}

function formatProtocolError(error: ProtocolError): string {
  if (error.code === "NOT_APPROVED") {
    return `Not approved: ${error.message}\n`;
  }

  if (error.code === "NATIVE_HOST_UNAVAILABLE") {
    return `Native host unavailable: ${error.message}\n`;
  }

  if (error.code === "VERSION_MISMATCH") {
    return `Version mismatch: ${error.message}. Upgrade/rebuild firefox-cli, the native host, and the extension.\n`;
  }

  if (error.code === "REF_NOT_FOUND") {
    return `${error.code}: ${error.message} Run \`firefox-cli snapshot -i\` again.\n`;
  }

  if (error.code === "SCRIPT_INJECTION_FAILED") {
    return `${error.code}: ${error.message} Try a normal web page tab and reload it after updating the extension.\n`;
  }

  return `${error.code}: ${error.message}\n`;
}

function formatGatedCapability(command: string): string {
  const capability = gatedCapabilitiesByCommand.get(command);
  return formatProtocolError({
    code: "UNSUPPORTED_CAPABILITY",
    message: capability?.reason ?? `${command} is not supported by firefox-cli.`,
  });
}

function renderTabSummary(tab: TabSummary): string {
  const activePrefix = tab.active ? "*" : " ";
  const title = tab.title ?? "(untitled)";
  const url = tab.url ?? "(url unavailable)";
  return `${activePrefix} w${tab.windowId} t${tab.id} [${tab.index}] ${title} ${url}\n`;
}

function renderTargetSummary(target: ResolvedTarget): string {
  const title = target.title ?? "(untitled)";
  const url = target.url ?? "(url unavailable)";
  return `w${target.windowId} t${target.tabId} [${target.tabIndex}] ${title} ${url}`;
}

function isGetKind(
  value: string | undefined,
): value is "text" | "html" | "value" | "attr" | "title" | "url" | "count" | "box" | "styles" {
  return isOneOf(getKinds, value);
}

function isIsKind(value: string | undefined): value is "visible" | "enabled" | "checked" {
  return isOneOf(isKinds, value);
}

function isElementActionCommand(
  value: string | undefined,
): value is "click" | "dblclick" | "focus" | "hover" | "check" | "uncheck" | "scrollintoview" {
  return (
    value === "click" ||
    value === "dblclick" ||
    value === "focus" ||
    value === "hover" ||
    value === "check" ||
    value === "uncheck" ||
    value === "scrollintoview"
  );
}

function isScrollDirection(value: string | undefined): value is "up" | "down" | "left" | "right" {
  return isOneOf(scrollDirections, value);
}

function isFindKind(
  value: string | undefined,
): value is "role" | "text" | "label" | "placeholder" | "alt" | "title" | "testid" {
  return isOneOf(findKinds, value);
}

function isScreenshotFormat(
  value: string | undefined,
): value is (typeof screenshotFormats)[number] {
  return isOneOf(screenshotFormats, value);
}

function isDialogAction(value: string | undefined): value is (typeof dialogActions)[number] {
  return isOneOf(dialogActions, value);
}

function isClipboardAction(value: string | undefined): value is (typeof clipboardActions)[number] {
  return isOneOf(clipboardActions, value);
}

function isCookieAction(value: string | undefined): value is (typeof cookieActions)[number] {
  return isOneOf(cookieActions, value);
}

function isStorageArea(value: string | undefined): value is (typeof storageAreas)[number] {
  return isOneOf(storageAreas, value);
}

function isStorageAction(value: string | undefined): value is (typeof storageActions)[number] {
  return isOneOf(storageActions, value);
}

function isNetworkAction(value: string | undefined): value is (typeof networkActions)[number] {
  return isOneOf(networkActions, value);
}

function isLogAction(value: string | undefined): value is (typeof logActions)[number] {
  return isOneOf(logActions, value);
}

function isDiffKind(value: string | undefined): value is (typeof diffKinds)[number] {
  return isOneOf(diffKinds, value);
}

function isOneOf<const T extends readonly string[]>(
  values: T,
  value: string | undefined,
): value is T[number] {
  return value !== undefined && values.includes(value);
}

type ParsedWaitArguments = {
  readonly positionals: readonly string[];
  readonly text?: string;
  readonly urlGlob?: string;
  readonly expression?: string;
  readonly loadState?: string;
  readonly download?: string;
  readonly state?: string;
  readonly generationId?: string;
  readonly timeout?: string;
  readonly interval?: string;
};

type ParsedEvalArguments = {
  readonly optionArgs: readonly string[];
  readonly source: "argv" | "stdin" | "base64";
  readonly script?: string;
  readonly base64?: string;
  readonly timeout?: string;
  readonly maxResultBytes?: string;
  readonly json: boolean;
};

type ParsedScreenshotArguments = {
  readonly optionArgs: readonly string[];
  readonly outputPath?: string;
  readonly format: "png" | "jpeg";
  readonly fullPage: boolean;
  readonly quality?: string;
  readonly timeout?: string;
  readonly maxImageBytes?: string;
  readonly json: boolean;
};

type ParsedBatchArguments = {
  readonly optionArgs: readonly string[];
  readonly inputSource: "argv" | "stdin";
  readonly input?: string;
  readonly bail: boolean;
  readonly timeout?: string;
  readonly maxResultBytes?: string;
  readonly json: boolean;
};

function parseEvalArguments(args: readonly string[]): ParsedEvalArguments {
  const optionArgs: string[] = [];
  const scriptParts: string[] = [];
  const sourceFlags: ("stdin" | "base64")[] = [];
  const parsed: {
    source?: "stdin" | "base64";
    base64?: string;
    timeout?: string;
    maxResultBytes?: string;
    json: boolean;
  } = { json: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--") {
      scriptParts.push(...args.slice(index + 1));
      break;
    }

    switch (arg) {
      case "--json":
        parsed.json = true;
        optionArgs.push(arg);
        break;
      case "--stdin":
        parsed.source = "stdin";
        sourceFlags.push("stdin");
        break;
      case "-b":
      case "--base64":
        parsed.source = "base64";
        sourceFlags.push("base64");
        parsed.base64 = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--timeout":
        parsed.timeout = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--max-output":
        parsed.maxResultBytes = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--window":
      case "--tab": {
        const value = readFlagValue(args, index, arg);
        optionArgs.push(arg, value);
        index += 1;
        break;
      }
      default:
        if (arg.startsWith("-")) {
          throw new CliUsageError(`Unsupported eval option: ${arg}`);
        }
        scriptParts.push(arg);
        break;
    }
  }

  const script = scriptParts.length === 0 ? undefined : scriptParts.join(" ");
  const sourceCount = (script === undefined ? 0 : 1) + sourceFlags.length;
  if (sourceCount !== 1) {
    throw new CliUsageError("Specify exactly one eval source.");
  }

  return {
    optionArgs,
    source: parsed.source ?? "argv",
    ...(script === undefined ? {} : { script }),
    ...(parsed.base64 === undefined ? {} : { base64: parsed.base64 }),
    ...(parsed.timeout === undefined ? {} : { timeout: parsed.timeout }),
    ...(parsed.maxResultBytes === undefined ? {} : { maxResultBytes: parsed.maxResultBytes }),
    json: parsed.json,
  };
}

function parseScreenshotArguments(args: readonly string[]): ParsedScreenshotArguments {
  const optionArgs: string[] = [];
  const parsed: {
    outputPath?: string;
    format: "png" | "jpeg";
    fullPage: boolean;
    quality?: string;
    timeout?: string;
    maxImageBytes?: string;
    json: boolean;
  } = { format: "png", fullPage: false, json: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    switch (arg) {
      case "--json":
        parsed.json = true;
        optionArgs.push(arg);
        break;
      case "--timeout":
        parsed.timeout = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--max-output":
        parsed.maxImageBytes = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--full":
        parsed.fullPage = true;
        break;
      case "--format":
      case "--screenshot-format": {
        const format = readFlagValue(args, index, arg).toLowerCase();
        if (!isScreenshotFormat(format)) {
          throw new CliUsageError("Only PNG and JPEG screenshots are supported.");
        }
        parsed.format = format;
        index += 1;
        break;
      }
      case "--screenshot-quality":
        parsed.quality = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--window":
      case "--tab": {
        const value = readFlagValue(args, index, arg);
        optionArgs.push(arg, value);
        index += 1;
        break;
      }
      default:
        if (arg.startsWith("-")) {
          throw new CliUsageError(`Unsupported screenshot option: ${arg}`);
        }
        if (parsed.outputPath !== undefined) {
          throw new CliUsageError("Specify at most one screenshot path.");
        }
        parsed.outputPath = arg;
        break;
    }
  }

  return {
    optionArgs,
    ...(parsed.outputPath === undefined ? {} : { outputPath: parsed.outputPath }),
    format: parsed.format,
    fullPage: parsed.fullPage,
    ...(parsed.quality === undefined ? {} : { quality: parsed.quality }),
    ...(parsed.timeout === undefined ? {} : { timeout: parsed.timeout }),
    ...(parsed.maxImageBytes === undefined ? {} : { maxImageBytes: parsed.maxImageBytes }),
    json: parsed.json,
  };
}

function parseBatchArguments(args: readonly string[]): ParsedBatchArguments {
  const optionArgs: string[] = [];
  const parsed: {
    inputSource?: "argv" | "stdin";
    input?: string;
    bail: boolean;
    timeout?: string;
    maxResultBytes?: string;
    json: boolean;
  } = { bail: false, json: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    switch (arg) {
      case "--json":
        parsed.json = true;
        optionArgs.push(arg);
        break;
      case "--bail":
        parsed.bail = true;
        break;
      case "--stdin":
        if (parsed.inputSource !== undefined) {
          throw new CliUsageError("Specify exactly one batch input source.");
        }
        parsed.inputSource = "stdin";
        break;
      case "--timeout":
        parsed.timeout = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--max-output":
        parsed.maxResultBytes = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--window":
      case "--tab": {
        const value = readFlagValue(args, index, arg);
        optionArgs.push(arg, value);
        index += 1;
        break;
      }
      default:
        if (arg.startsWith("-")) {
          throw new CliUsageError(`Unsupported batch option: ${arg}`);
        }
        if (parsed.inputSource !== undefined) {
          throw new CliUsageError("Specify exactly one batch input source.");
        }
        parsed.inputSource = "argv";
        parsed.input = arg;
        break;
    }
  }

  if (parsed.inputSource === undefined) {
    throw new CliUsageError("Missing batch JSON.");
  }

  return {
    optionArgs,
    inputSource: parsed.inputSource,
    ...(parsed.input === undefined ? {} : { input: parsed.input }),
    bail: parsed.bail,
    ...(parsed.timeout === undefined ? {} : { timeout: parsed.timeout }),
    ...(parsed.maxResultBytes === undefined ? {} : { maxResultBytes: parsed.maxResultBytes }),
    json: parsed.json,
  };
}

async function readEvalScript(
  args: ParsedEvalArguments,
  dependencies: CliDependencies,
): Promise<string> {
  const script =
    args.source === "stdin"
      ? await (dependencies.readStdin?.() ?? readProcessStdin())
      : args.source === "base64"
        ? decodeBase64(args.base64 ?? "")
        : (args.script ?? "");

  if (script.length === 0) {
    throw new CliUsageError("Eval script is empty.");
  }

  return script;
}

type ParsedUploadArguments = {
  readonly elementTarget: string;
  readonly paths: readonly string[];
  readonly optionArgs: readonly string[];
};

type UploadBudget = {
  bytes: number;
};

type UploadFilePlan = {
  readonly inputPath: string;
  readonly absolutePath: string;
  readonly size: number;
};

function parseUploadArguments(args: readonly string[]): ParsedUploadArguments {
  const parsed = parsePositionalsAndOptions(args, { preserveUnknownOptions: true });
  const [elementTarget, ...paths] = parsed.positionals;
  if (elementTarget === undefined || paths.length === 0) {
    throw new CliUsageError("Missing upload selector/ref or file path.");
  }
  if (paths.length > MAX_UPLOAD_FILES) {
    throw new CliUsageError(`Upload accepts at most ${MAX_UPLOAD_FILES} files.`);
  }

  return {
    elementTarget,
    paths,
    optionArgs: parsed.optionArgs,
  };
}

async function createUploadParams(
  parsed: ParsedUploadArguments,
  dependencies: CliDependencies,
  uploadBudget: UploadBudget,
): Promise<UploadParams> {
  const files = await readUploadFiles(parsed.paths, dependencies, uploadBudget);
  return {
    ...parseElementTarget(parsed.elementTarget),
    files,
    ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  };
}

function createUploadBudget(): UploadBudget {
  return { bytes: 0 };
}

async function readUploadFiles(
  paths: readonly string[],
  dependencies: CliDependencies,
  uploadBudget: UploadBudget,
): Promise<UploadParams["files"]> {
  const plans = await statUploadFiles(paths, dependencies);
  assertUploadPlanBudget(plans, uploadBudget.bytes);

  const files: UploadParams["files"] = [];
  for (const plan of plans) {
    const rawBytes = await readUploadFileBytes(plan, dependencies, {
      maxFileBytes: MAX_UPLOAD_FILE_BYTES,
      maxRemainingTotalBytes: MAX_UPLOAD_TOTAL_BYTES - uploadBudget.bytes,
    });
    if (rawBytes.byteLength > MAX_UPLOAD_FILE_BYTES) {
      throw uploadFileTooLarge(plan.inputPath, rawBytes.byteLength);
    }
    if (uploadBudget.bytes + rawBytes.byteLength > MAX_UPLOAD_TOTAL_BYTES) {
      throw uploadTotalTooLarge(uploadBudget.bytes + rawBytes.byteLength);
    }
    const bytes = Buffer.from(rawBytes);
    uploadBudget.bytes += bytes.byteLength;
    files.push({
      name: basename(plan.inputPath),
      dataBase64: bytes.toString("base64"),
    });
  }

  return files;
}

async function statUploadFiles(
  paths: readonly string[],
  dependencies: CliDependencies,
): Promise<readonly UploadFilePlan[]> {
  if (paths.length > MAX_UPLOAD_FILES) {
    throw new CliUsageError(`Upload accepts at most ${MAX_UPLOAD_FILES} files.`);
  }

  return Promise.all(
    paths.map(async (inputPath) => {
      const absolutePath = resolve(dependencies.cwd ?? process.cwd(), inputPath);
      const fileStat = await statUploadPath(absolutePath, dependencies);
      if (!fileStat.isFile) {
        throw new CliUsageError(`Upload path is not a file: ${inputPath}`);
      }
      if (fileStat.size > MAX_UPLOAD_FILE_BYTES) {
        throw uploadFileTooLarge(inputPath, fileStat.size);
      }

      return {
        inputPath,
        absolutePath,
        size: fileStat.size,
      };
    }),
  );
}

function assertUploadPlanBudget(plans: readonly UploadFilePlan[], existingBytes: number): void {
  const plannedBytes = plans.reduce((total, plan) => total + plan.size, 0);
  const aggregateBytes = existingBytes + plannedBytes;
  if (aggregateBytes > MAX_UPLOAD_TOTAL_BYTES) {
    throw uploadTotalTooLarge(aggregateBytes);
  }
}

async function statUploadPath(
  absolutePath: string,
  dependencies: CliDependencies,
): Promise<CliUploadFileStat> {
  if (dependencies.statUploadFile !== undefined) {
    return dependencies.statUploadFile(absolutePath);
  }

  const fileStat = await stat(absolutePath);
  return {
    size: fileStat.size,
    isFile: fileStat.isFile(),
  };
}

async function readUploadFileBytes(
  plan: UploadFilePlan,
  dependencies: CliDependencies,
  limits: UploadReadLimits,
): Promise<Uint8Array> {
  if (dependencies.readUploadFile !== undefined) {
    return dependencies.readUploadFile(plan.absolutePath, limits);
  }

  const handle = await openFile(plan.absolutePath, "r");
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of handle.createReadStream({ highWaterMark: 64 * 1024 })) {
      const bytes = Buffer.from(chunk);
      totalBytes += bytes.byteLength;
      if (totalBytes > limits.maxFileBytes) {
        throw uploadFileTooLarge(plan.inputPath, totalBytes);
      }
      if (totalBytes > limits.maxRemainingTotalBytes) {
        throw uploadTotalTooLarge(
          MAX_UPLOAD_TOTAL_BYTES - limits.maxRemainingTotalBytes + totalBytes,
        );
      }
      chunks.push(bytes);
    }
  } finally {
    await handle.close();
  }

  return Buffer.concat(chunks, totalBytes);
}

function uploadFileTooLarge(path: string, actualBytes: number): CliUsageError {
  return new CliUsageError(
    `Upload file exceeds ${MAX_UPLOAD_FILE_BYTES} byte per-file limit: ${path} (${actualBytes} bytes).`,
  );
}

function uploadTotalTooLarge(actualBytes: number): CliUsageError {
  return new CliUsageError(
    `Upload files exceed ${MAX_UPLOAD_TOTAL_BYTES} byte total limit (${actualBytes} bytes).`,
  );
}

function parseBatchParamsForCli(params: BatchParams): BatchParams {
  const parsed = batchParamsSchema.safeParse(params);
  if (parsed.success) {
    return parsed.data;
  }

  const firstIssue = parsed.error.issues[0];
  throw new CliUsageError(
    firstIssue === undefined
      ? "Batch request is invalid."
      : `Batch request is invalid: ${firstIssue.message}`,
  );
}

async function validateBatchArgvUploadMetadata(
  rawSteps: readonly unknown[],
  dependencies: CliDependencies,
): Promise<void> {
  let plannedBytes = 0;
  for (const [index, rawStep] of rawSteps.entries()) {
    if (
      !Array.isArray(rawStep) ||
      !rawStep.every((value): value is string => typeof value === "string") ||
      rawStep[0] !== "upload"
    ) {
      continue;
    }

    const parsed = parseBatchUploadArguments(rawStep, index);
    const plans = await statUploadFiles(parsed.paths, dependencies);
    const stepBytes = plans.reduce((total, plan) => total + plan.size, 0);
    plannedBytes += stepBytes;
    if (plannedBytes > MAX_UPLOAD_TOTAL_BYTES) {
      throw uploadTotalTooLarge(plannedBytes);
    }
  }
}

function parseBatchUploadArguments(argv: readonly string[], index: number): ParsedUploadArguments {
  try {
    return parseUploadArguments(argv.slice(1));
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw new CliUsageError(`Invalid batch argv step ${index}: ${error.message}`);
    }
    throw error;
  }
}

async function readBatchSteps(
  args: ParsedBatchArguments,
  dependencies: CliDependencies,
): Promise<BatchStep[]> {
  const input =
    args.inputSource === "stdin"
      ? await (dependencies.readStdin?.() ?? readProcessStdin())
      : (args.input ?? "");
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    throw new CliUsageError("Invalid batch JSON.");
  }

  if (!Array.isArray(raw)) {
    throw new CliUsageError("Batch JSON must be an array.");
  }

  await validateBatchArgvUploadMetadata(raw, dependencies);

  const steps: BatchStep[] = [];
  const uploadBudget = createUploadBudget();
  for (const [index, rawStep] of raw.entries()) {
    steps.push(await parseBatchStep(rawStep, index, dependencies, uploadBudget));
  }
  if (steps.length === 0) {
    throw new CliUsageError("Batch requires at least one step.");
  }

  return steps;
}

async function parseBatchStep(
  rawStep: unknown,
  index: number,
  dependencies: CliDependencies,
  uploadBudget: UploadBudget,
): Promise<BatchStep> {
  if (Array.isArray(rawStep)) {
    if (!rawStep.every((value): value is string => typeof value === "string")) {
      throw new CliUsageError(`Batch argv step ${index} must contain only strings.`);
    }
    return batchStepFromArgv(rawStep, index, dependencies, uploadBudget);
  }

  if (!isRecord(rawStep)) {
    throw new CliUsageError(`Batch step ${index} must be an argv array or command object.`);
  }

  const command = rawStep.command;
  if (typeof command !== "string" || !isBatchableCommandId(command)) {
    throw new CliUsageError(`Invalid batch command at step ${index}.`);
  }

  return {
    command,
    params: rawStep.params ?? {},
  };
}

async function batchStepFromArgv(
  argv: readonly string[],
  index: number,
  dependencies: CliDependencies,
  uploadBudget: UploadBudget,
): Promise<BatchStep> {
  if (batchArgvReadsStdin(argv)) {
    throw new CliUsageError(`Batch argv step ${index} cannot read from stdin.`);
  }

  const binding = findCliRouteBindingForArgv(argv);
  if (binding === undefined || !binding.route.batch) {
    throw new CliUsageError(`Invalid batch argv command at step ${index}.`);
  }

  let request: RequestEnvelope;
  try {
    request = await binding.buildRequest(argv, dependencies, { uploadBudget });
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw new CliUsageError(`Invalid batch argv step ${index}: ${error.message}`);
    }
    throw error;
  }

  if (!isBatchableCommandId(request.command)) {
    throw new CliUsageError(`Invalid batch command at step ${index}.`);
  }

  return {
    command: request.command,
    params: stripImplicitBatchTarget(request.command, request.params, argv),
  };
}

function findCliRouteBindingForArgv(argv: readonly string[]): CliRouteBinding | undefined {
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

function batchArgvReadsStdin(argv: readonly string[]): boolean {
  return argv[0] === "eval" && argv.includes("--stdin");
}

function stripImplicitBatchTarget(
  command: CommandId,
  params: unknown,
  argv: readonly string[],
): unknown {
  if (!isImplicitBatchDefaultTargetCommand(command) || !isRecord(params)) {
    return params;
  }

  if (hasExplicitTargetInBatchArgv(command, argv)) {
    return params;
  }

  const { target: _target, ...paramsWithoutImplicitTarget } = params;
  return paramsWithoutImplicitTarget;
}

function isImplicitBatchDefaultTargetCommand(command: CommandId): boolean {
  return commandAcceptsProtocolBatchDefaultTarget(command);
}

function hasExplicitTargetInBatchArgv(command: CommandId, argv: readonly string[]): boolean {
  const positionals = getPositionals(argv.slice(1));
  if (command === "tab.select" || command === "tab.close") {
    return positionals[1] !== undefined || hasOption(argv, "--tab") || hasOption(argv, "--window");
  }

  if (command === "window.select" || command === "window.close") {
    return positionals[1] !== undefined || hasOption(argv, "--window");
  }

  return false;
}

function decodeBase64(value: string): string {
  const normalized = value.trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(normalized)) {
    throw new CliUsageError("Invalid base64 eval script.");
  }

  return Buffer.from(normalized, "base64").toString("utf8");
}

function parseWaitParams(waitArgs: ParsedWaitArguments): {
  readonly kind: "ms" | "element" | "text" | "url" | "function" | "load-state" | "download";
  readonly durationMs?: number;
  readonly selector?: string;
  readonly ref?: string;
  readonly generationId?: string;
  readonly state?:
    | "visible"
    | "hidden"
    | "attached"
    | "domcontentloaded"
    | "complete"
    | "networkidle";
  readonly text?: string;
  readonly urlGlob?: string;
  readonly expression?: string;
  readonly downloadId?: number;
  readonly filenameGlob?: string;
} {
  const conditionCount = [
    waitArgs.text,
    waitArgs.urlGlob,
    waitArgs.expression,
    waitArgs.loadState,
    waitArgs.download,
  ].filter((value) => value !== undefined).length;
  if (conditionCount > 1) {
    throw new CliUsageError("Specify exactly one wait condition.");
  }

  if (conditionCount > 0 && waitArgs.positionals.length > 0) {
    throw new CliUsageError("Specify exactly one wait condition.");
  }

  if (conditionCount > 0 && waitArgs.state !== undefined) {
    throw new CliUsageError("Only element waits accept --state.");
  }

  if (conditionCount > 0 && waitArgs.generationId !== undefined) {
    throw new CliUsageError("Only element waits accept --generation.");
  }

  if (waitArgs.text !== undefined) {
    return { kind: "text", text: waitArgs.text };
  }

  if (waitArgs.urlGlob !== undefined) {
    return { kind: "url", urlGlob: waitArgs.urlGlob };
  }

  if (waitArgs.expression !== undefined) {
    return { kind: "function", expression: waitArgs.expression };
  }

  if (waitArgs.loadState !== undefined) {
    if (
      waitArgs.loadState !== "domcontentloaded" &&
      waitArgs.loadState !== "complete" &&
      waitArgs.loadState !== "networkidle"
    ) {
      throw new CliUsageError(`Invalid load state: ${waitArgs.loadState}`);
    }
    return { kind: "load-state", state: waitArgs.loadState };
  }

  if (waitArgs.download !== undefined) {
    if (waitArgs.download.length === 0) {
      return { kind: "download" };
    }
    return /^\d+$/u.test(waitArgs.download)
      ? { kind: "download", downloadId: Number(waitArgs.download) }
      : { kind: "download", filenameGlob: waitArgs.download };
  }

  const target = waitArgs.positionals[0];
  if (target === undefined) {
    throw new CliUsageError("Missing wait target or condition.");
  }

  if (waitArgs.positionals.length > 1) {
    throw new CliUsageError("Specify exactly one wait condition.");
  }

  if (/^\d+$/u.test(target)) {
    if (waitArgs.state !== undefined) {
      throw new CliUsageError("Only element waits accept --state.");
    }
    if (waitArgs.generationId !== undefined) {
      throw new CliUsageError("Only element waits accept --generation.");
    }
    return { kind: "ms", durationMs: Number(target) };
  }

  const elementState = waitArgs.state ?? "visible";
  if (elementState !== "visible" && elementState !== "hidden" && elementState !== "attached") {
    throw new CliUsageError(`Invalid wait state: ${elementState}`);
  }
  const elementTarget = parseElementTarget(target);
  if (elementTarget.ref === undefined && waitArgs.generationId !== undefined) {
    throw new CliUsageError("Generation IDs apply only to refs.");
  }

  return {
    kind: "element",
    ...elementTarget,
    state: elementState,
    ...(waitArgs.generationId === undefined ? {} : { generationId: waitArgs.generationId }),
  };
}

function parseWaitArguments(args: readonly string[]): ParsedWaitArguments {
  const parsed: {
    positionals: string[];
    text?: string;
    urlGlob?: string;
    expression?: string;
    loadState?: string;
    download?: string;
    state?: string;
    generationId?: string;
    timeout?: string;
    interval?: string;
  } = { positionals: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined || arg === "--json") {
      continue;
    }

    if (arg === "--window" || arg === "--tab") {
      readFlagValue(args, index, arg);
      index += 1;
      continue;
    }

    switch (arg) {
      case "--text":
        parsed.text = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--url":
        parsed.urlGlob = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--fn":
        parsed.expression = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--load":
        parsed.loadState = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--download":
        {
          const downloadTarget = args[index + 1];
          if (downloadTarget !== undefined && !downloadTarget.startsWith("-")) {
            parsed.download = downloadTarget;
            index += 1;
          } else {
            parsed.download = "";
          }
        }
        break;
      case "--state":
        parsed.state = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--generation":
        parsed.generationId = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--timeout":
        parsed.timeout = readFlagValue(args, index, arg);
        index += 1;
        break;
      case "--interval":
        parsed.interval = readFlagValue(args, index, arg);
        index += 1;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new CliUsageError(`Unsupported wait option: ${arg}`);
        }
        parsed.positionals.push(arg);
        break;
    }
  }

  return parsed;
}

function parseElementTarget(value: string | undefined): {
  readonly selector?: string;
  readonly ref?: string;
} {
  if (value === undefined) {
    return {};
  }

  if (/^@e[1-9]\d*$/u.test(value)) {
    return { ref: value };
  }

  if (value.startsWith("@")) {
    throw new CliUsageError(`Invalid ref: ${value}`);
  }

  return { selector: value };
}

function formatGetValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value, null, 2);
}

function formatWaitResult(result: WaitResult): string {
  const suffix = `in ${result.elapsedMs}ms`;
  if (result.kind === "element" && result.element !== undefined) {
    const element = result.element;
    const refPrefix = element.ref === undefined ? "" : `${element.ref} `;
    return `${refPrefix}${element.role} ${element.name ?? element.text ?? element.tagName} ${suffix}`;
  }

  if ("value" in result && result.value !== undefined) {
    return `${formatGetValue(result.value)} ${suffix}`;
  }

  if (result.kind === "download") {
    return `download ${result.download.id} ${result.download.state ?? "matched"} ${suffix}`;
  }

  return `matched ${suffix}`;
}

function formatEvalResult(result: EvalResult): string {
  if (result.value.type === "undefined") {
    return "undefined";
  }

  return formatGetValue(result.value.value);
}

function formatScreenshotResult(result: ScreenshotResult): string {
  const dimensions =
    result.width === undefined || result.height === undefined
      ? ""
      : ` ${result.width}x${result.height}`;
  return `${result.path} ${result.bytes} bytes${dimensions}`;
}

function formatBatchResult(result: BatchResult): string {
  return [
    ...result.steps.map((step) =>
      step.ok
        ? `${step.index} ${step.command} ok`
        : `${step.index} ${step.command} ${step.error.code}: ${step.error.message}`,
    ),
    `batch ${result.ok ? "ok" : "failed"} in ${result.elapsedMs}ms`,
  ].join("\n");
}

function formatActionResult(result: ActionResult): string {
  const parts = [`${result.action} ok`];
  if (result.element !== undefined) {
    const refPrefix = result.element.ref === undefined ? "" : `${result.element.ref} `;
    parts.push(
      `${refPrefix}${result.element.role} ${
        result.element.name ?? result.element.text ?? result.element.tagName
      }`,
    );
  }
  if ("valueLength" in result && result.valueLength !== undefined) {
    parts.push(`valueLength=${result.valueLength}`);
  }
  if ("selectedValues" in result && result.selectedValues !== undefined) {
    parts.push(`selected=${result.selectedValues.join(",")}`);
  }
  if ("scroll" in result && result.scroll !== undefined) {
    parts.push(`scroll=${result.scroll.x},${result.scroll.y}`);
  }
  return parts.join(" ");
}

function formatActionResponse(
  response: ResponseEnvelope<
    | "click"
    | "dblclick"
    | "focus"
    | "hover"
    | "drag"
    | "upload"
    | "mouse"
    | "keydown"
    | "keyup"
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
  >,
  json: boolean,
): CliResult {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${formatActionResult(response.result)}\n`);
}

function formatJsonOrObject<C extends CommandId>(
  response: ResponseEnvelope<C>,
  json: boolean,
): CliResult {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${JSON.stringify(response.result)}\n`);
}

function getPositionals(
  args: readonly string[],
  options: { readonly preserveUnknownOptions?: boolean; readonly minPositionals?: number } = {},
): readonly string[] {
  return parsePositionalsAndOptions(args, options).positionals;
}

function parsePositionalsAndOptions(
  args: readonly string[],
  options: { readonly preserveUnknownOptions?: boolean; readonly minPositionals?: number } = {},
): { readonly positionals: readonly string[]; readonly optionArgs: readonly string[] } {
  const positionals: string[] = [];
  const optionArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (isBooleanPositionalOption(arg)) {
      if (shouldPreserveOptionLiteral(args, index, 1, positionals.length, options)) {
        positionals.push(arg);
      } else {
        optionArgs.push(arg);
      }
      continue;
    }

    if (isValuePositionalOption(arg)) {
      if (shouldPreserveOptionLiteral(args, index, 2, positionals.length, options)) {
        positionals.push(arg);
        continue;
      }
      optionArgs.push(arg);
      const value = args[index + 1];
      if (value !== undefined) {
        optionArgs.push(value);
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--") && options.preserveUnknownOptions !== true) {
      continue;
    }

    positionals.push(arg);
  }

  return { positionals, optionArgs };
}

function parsePayloadPositionalsAndOptions(
  args: readonly string[],
  options: {
    readonly payloadStartPositionals: number;
    readonly minPositionals: number;
    readonly variadicAfterMin?: boolean;
  },
): { readonly positionals: readonly string[]; readonly optionArgs: readonly string[] } {
  const positionals: string[] = [];
  const optionArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (isBooleanPositionalOption(arg)) {
      if (shouldTreatOptionAsPayload(args, index, 1, positionals.length, options)) {
        positionals.push(arg);
      } else {
        optionArgs.push(arg);
      }
      continue;
    }

    if (isValuePositionalOption(arg)) {
      if (shouldTreatOptionAsPayload(args, index, 2, positionals.length, options)) {
        positionals.push(arg);
        continue;
      }

      optionArgs.push(arg);
      const value = args[index + 1];
      if (value !== undefined) {
        optionArgs.push(value);
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--") && positionals.length < options.payloadStartPositionals) {
      continue;
    }

    positionals.push(arg);
  }

  return { positionals, optionArgs };
}

function isBooleanPositionalOption(arg: string): boolean {
  return (
    arg === "--json" ||
    arg === "--new-tab" ||
    arg === "-i" ||
    arg === "--interactive" ||
    arg === "-c" ||
    arg === "--compact" ||
    arg === "--verbose" ||
    arg === "--first" ||
    arg === "--last"
  );
}

function isValuePositionalOption(arg: string): boolean {
  return (
    arg === "--window" ||
    arg === "--tab" ||
    arg === "-d" ||
    arg === "--depth" ||
    arg === "-s" ||
    arg === "--selector" ||
    arg === "--max-output" ||
    arg === "--generation" ||
    arg === "--state" ||
    arg === "--text" ||
    arg === "--url" ||
    arg === "--x" ||
    arg === "--y" ||
    arg === "--button" ||
    arg === "--delta-x" ||
    arg === "--delta-y" ||
    arg === "--duration" ||
    arg === "--fn" ||
    arg === "--load" ||
    arg === "--timeout" ||
    arg === "--interval"
  );
}

function shouldPreserveOptionLiteral(
  args: readonly string[],
  index: number,
  width: number,
  currentPositionals: number,
  options: { readonly preserveUnknownOptions?: boolean; readonly minPositionals?: number },
): boolean {
  const minimum = options.minPositionals ?? 0;
  return (
    options.preserveUnknownOptions === true &&
    currentPositionals + Math.max(0, args.length - index - width) < minimum
  );
}

function shouldTreatOptionAsPayload(
  args: readonly string[],
  index: number,
  width: number,
  currentPositionals: number,
  options: {
    readonly payloadStartPositionals: number;
    readonly minPositionals: number;
    readonly variadicAfterMin?: boolean;
  },
): boolean {
  if (currentPositionals < options.payloadStartPositionals) {
    return false;
  }

  if (options.variadicAfterMin === true && currentPositionals >= options.minPositionals) {
    return true;
  }

  return currentPositionals + Math.max(0, args.length - index - width) < options.minPositionals;
}

function parseTargetOptions(args: readonly string[]): TargetSelector {
  let target: TargetSelector = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--window") {
      target = mergeTarget(target, { window: parseTargetValue(readFlagValue(args, index, arg)) });
      index += 1;
    } else if (arg === "--tab") {
      target = mergeTarget(target, { tab: parseTargetValue(readFlagValue(args, index, arg)) });
      index += 1;
    }
  }

  return target;
}

function parseTargetValue(value: string | undefined): NonNullable<TargetSelector["tab"]> {
  if (value === undefined || value === "active") {
    return { kind: "active" };
  }

  const [prefix, rawValue] = value.includes(":") ? value.split(":", 2) : ["index", value];
  if (prefix !== "id" && prefix !== "index") {
    throw new CliUsageError(`Invalid target prefix: ${prefix}`);
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliUsageError(`Invalid target: ${value}`);
  }

  return prefix === "id" ? { kind: "id", id: parsed } : { kind: "index", index: parsed };
}

function parseOptionalTabTarget(value: string | undefined, base: TargetSelector): TargetSelector {
  if (value !== undefined) {
    return { tab: parseTargetValue(value) };
  }

  return base.tab === undefined ? { tab: { kind: "active" } } : {};
}

function parseOptionalWindowTarget(
  value: string | undefined,
  base: TargetSelector,
): TargetSelector {
  if (value !== undefined) {
    return { window: parseTargetValue(value) };
  }

  return base.window === undefined ? { window: { kind: "active" } } : {};
}

function mergeTarget(base: TargetSelector, override: TargetSelector): TargetSelector {
  return {
    ...(base.window === undefined ? {} : { window: base.window }),
    ...(base.tab === undefined ? {} : { tab: base.tab }),
    ...(override.window === undefined ? {} : { window: override.window }),
    ...(override.tab === undefined ? {} : { tab: override.tab }),
  };
}

function hasOption(args: readonly string[], option: string): boolean {
  return args.includes(option);
}

function optionalBooleanFlag<K extends string>(
  args: readonly string[],
  flag: string,
  outputKey: K,
): { readonly [P in K]?: true } {
  return args.includes(flag) ? ({ [outputKey]: true } as { readonly [P in K]?: true }) : {};
}

function optionalNumberOption<K extends string>(
  args: readonly string[],
  names: readonly string[],
  outputKey: K,
): { readonly [P in K]?: number } {
  const value = getOptionValue(args, names);
  if (value === undefined) {
    return {};
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CliUsageError(`Invalid ${outputKey}: ${value}`);
  }
  return { [outputKey]: parsed } as { readonly [P in K]?: number };
}

function sourceDragTarget(
  value: string,
  role: "source" | "target",
): {
  readonly sourceSelector?: string;
  readonly sourceRef?: string;
  readonly targetSelector?: string;
  readonly targetRef?: string;
} {
  const parsed = parseElementTarget(value);
  if (role === "source") {
    return parsed.ref === undefined
      ? { sourceSelector: parsed.selector ?? value }
      : { sourceRef: parsed.ref };
  }
  return parsed.ref === undefined
    ? { targetSelector: parsed.selector ?? value }
    : { targetRef: parsed.ref };
}

function optionalTarget(target: TargetSelector): { readonly target?: TargetSelector } {
  return target.window === undefined && target.tab === undefined ? {} : { target };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalUrl(url: string | undefined): { readonly url?: string } {
  return url === undefined ? {} : { url };
}

function optionalStringOption(
  args: readonly string[],
  names: readonly string[],
  outputKey: "selector",
): { readonly selector?: string };
function optionalStringOption(
  args: readonly string[],
  names: readonly string[],
  outputKey: "generationId",
): { readonly generationId?: string };
function optionalStringOption(
  args: readonly string[],
  names: readonly string[],
  outputKey: "urlGlob",
): { readonly urlGlob?: string };
function optionalStringOption(
  args: readonly string[],
  names: readonly string[],
  outputKey: "selector" | "generationId" | "urlGlob",
): { readonly selector?: string; readonly generationId?: string; readonly urlGlob?: string } {
  const value = getOptionValue(args, names);
  if (value === undefined) {
    return {};
  }

  if (value.length === 0) {
    throw new CliUsageError(`Missing ${outputKey}.`);
  }

  return { [outputKey]: value };
}

function optionalPositiveInteger(
  args: readonly string[],
  names: readonly string[],
  label: string,
  outputKey: "maxDepth" | "maxOutputBytes",
): { readonly maxDepth?: number; readonly maxOutputBytes?: number };
function optionalPositiveInteger(
  args: readonly string[],
  names: readonly string[],
  label: string,
  outputKey: "durationMs",
): { readonly durationMs?: number };
function optionalPositiveInteger(
  args: readonly string[],
  names: readonly string[],
  label: string,
  outputKey: "nth",
): { readonly nth?: number };
function optionalPositiveInteger(
  args: readonly string[],
  names: readonly string[],
  label: string,
  outputKey: "maxDepth" | "maxOutputBytes" | "nth" | "durationMs",
): {
  readonly maxDepth?: number;
  readonly maxOutputBytes?: number;
  readonly nth?: number;
  readonly durationMs?: number;
} {
  const value = getOptionValue(args, names);
  if (value === undefined) {
    return {};
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || (outputKey === "maxOutputBytes" && parsed === 0)) {
    throw new CliUsageError(`Invalid ${label}: ${value}`);
  }

  return { [outputKey]: parsed };
}

function parsePositiveIntegerValue(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliUsageError(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function readFlagValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new CliUsageError(`Missing value for ${flag}.`);
  }
  return value;
}

function getOptionValue(args: readonly string[], names: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    if (names.includes(args[index] ?? "")) {
      const value = args[index + 1];
      if (value === undefined) {
        throw new CliUsageError(`Missing value for ${args[index]}.`);
      }
      return value;
    }
  }

  return undefined;
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return value;
  }

  return `https://${value}`;
}

function getUserStateRoot(
  platform: NodeJS.Platform,
  homeDir: string,
  appDataDir: string | undefined,
): string {
  if (platform === "win32") {
    return appDataDir ?? resolve(homeDir, "AppData", "Roaming");
  }

  return platform === "darwin"
    ? resolve(homeDir, "Library/Application Support/firefox-cli")
    : resolve(homeDir, ".config/firefox-cli");
}

function optionalAppDataDir(appDataDir: string | undefined): { readonly appDataDir?: string } {
  return appDataDir === undefined ? {} : { appDataDir };
}

function readProcessStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      content += chunk;
    });
    process.stdin.once("end", () => resolve(content));
    process.stdin.once("error", reject);
  });
}

function ok(stdout: string): CliResult {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
  };
}

function error(stderr: string): CliResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr,
  };
}
