import { access, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  FilePairStateStore,
  FileLocalIpcAuthTokenStore,
  LocalIpcError,
  planLocalIpcEndpoint,
  planNativeMessagingManifest,
  sendLocalIpcRequest,
  writeNativeMessagingManifest,
} from "@firefox-cli/native-host";
import {
  createErrorResponse,
  createRequest,
  type ActionResult,
  type BatchResult,
  type BatchStep,
  type CommandId,
  type EvalResult,
  type ProtocolError,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ResolvedTarget,
  type ScreenshotResult,
  type TabSummary,
  type TargetSelector,
  type WaitResult,
  gatedCapabilities,
  isBatchableCommandId,
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
  clearPairState?(): Promise<void>;
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

  if (args[0] === "capabilities") {
    return capabilities(args.slice(1), dependencies);
  }

  if (args[0] === "tab") {
    return tabs(args.slice(1), dependencies);
  }

  if (args[0] === "window") {
    return windows(args.slice(1), dependencies);
  }

  if (args[0] === "open") {
    return open(args.slice(1), dependencies);
  }

  if (args[0] === "snapshot") {
    return snapshot(args.slice(1), dependencies);
  }

  if (args[0] === "ref") {
    return refResolve(args.slice(1), dependencies);
  }

  if (args[0] === "get") {
    return get(args.slice(1), dependencies);
  }

  if (args[0] === "is") {
    return is(args.slice(1), dependencies);
  }

  if (args[0] === "wait") {
    return wait(args.slice(1), dependencies);
  }

  if (args[0] === "eval") {
    return evalCommand(args.slice(1), dependencies);
  }

  if (args[0] === "screenshot") {
    return screenshot(args.slice(1), dependencies);
  }

  if (args[0] === "drag") {
    return drag(args.slice(1), dependencies);
  }

  if (args[0] === "upload") {
    return upload(args.slice(1), dependencies);
  }

  if (args[0] === "mouse") {
    return mouse(args.slice(1), dependencies);
  }

  if (args[0] === "keydown" || args[0] === "keyup") {
    return keyEvent(args[0], args.slice(1), dependencies);
  }

  if (args[0] === "find") {
    return find(args.slice(1), dependencies);
  }

  if (args[0] === "frame") {
    return frame(args.slice(1), dependencies);
  }

  if (args[0] === "download") {
    return download(args.slice(1), dependencies);
  }

  if (args[0] === "dialog") {
    return dialog(args.slice(1), dependencies);
  }

  if (args[0] === "clipboard") {
    return clipboard(args.slice(1), dependencies);
  }

  if (args[0] === "cookies") {
    return cookies(args.slice(1), dependencies);
  }

  if (args[0] === "storage") {
    return storage(args.slice(1), dependencies);
  }

  if (args[0] === "network") {
    return network(args.slice(1), dependencies);
  }

  if (args[0] === "console") {
    return consoleCommand(args.slice(1), dependencies);
  }

  if (args[0] === "errors") {
    return errors(args.slice(1), dependencies);
  }

  if (args[0] === "highlight") {
    return highlight(args.slice(1), dependencies);
  }

  if (args[0] === "pdf") {
    return pdf(args.slice(1), dependencies);
  }

  if (args[0] === "set") {
    return setCommand(args.slice(1), dependencies);
  }

  if (args[0] === "diff") {
    return diffCommand(args.slice(1), dependencies);
  }

  if (args[0] === "batch") {
    return batch(args.slice(1), dependencies);
  }

  if (isElementActionCommand(args[0])) {
    return elementAction(args[0], args.slice(1), dependencies);
  }

  if (args[0] === "fill" || args[0] === "type") {
    return textElementAction(args[0], args.slice(1), dependencies);
  }

  if (args[0] === "press") {
    return press(args.slice(1), dependencies);
  }

  if (args[0] === "keyboard") {
    return keyboard(args.slice(1), dependencies);
  }

  if (args[0] === "select") {
    return select(args.slice(1), dependencies);
  }

  if (args[0] === "scroll" || args[0] === "swipe") {
    return scroll(args[0], args.slice(1), dependencies);
  }

  if (args[0] === "back" || args[0] === "forward" || args[0] === "reload") {
    return navigation(args[0], args.slice(1), dependencies);
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

export function renderHelp(): string {
  return [
    "firefox-cli",
    "",
    "Usage:",
    "  firefox-cli --version",
    "  firefox-cli setup native-host [--dry-run] [--json]",
    "  firefox-cli doctor [--fix] [--json]",
    "  firefox-cli unpair",
    "  firefox-cli capabilities [--json]",
    "  firefox-cli open [--new-tab] <url> [--json]",
    "  firefox-cli back|forward|reload [--json]",
    "  firefox-cli snapshot [-i] [-c] [-d depth] [-s selector] [--json]",
    "  firefox-cli ref <@ref> [--generation id] [--json]",
    "  firefox-cli get text|html|value|attr|count|box|styles <selector|@ref> [--json]",
    "  firefox-cli get title|url [--json]",
    "  firefox-cli is visible|enabled|checked <selector|@ref> [--generation id] [--json]",
    "  firefox-cli wait <ms|selector|@ref> [--state visible|hidden|attached] [--json]",
    "  firefox-cli wait --text text | --url glob | --fn js | --load domcontentloaded|complete [--json]",
    "  firefox-cli eval <js> | --stdin | -b base64 [--json]",
    "  firefox-cli screenshot [path] [--json]",
    "  firefox-cli drag <source-selector|@ref> <target-selector|@ref> [--json]",
    "  firefox-cli upload <selector|@ref> <file...> [--json]",
    "  firefox-cli mouse move|down|up|wheel [selector|@ref] [--json]",
    "  firefox-cli keydown|keyup <key> [selector|@ref] [--json]",
    "  firefox-cli find role|text|label|placeholder|alt|title|testid <value> [--json]",
    "  firefox-cli frame [--json]",
    "  firefox-cli download <url> [filename] [--json]",
    "  firefox-cli dialog status|accept|dismiss [--json]",
    "  firefox-cli clipboard read|write|copy|paste [text-or-selector] [--json]",
    "  firefox-cli cookies list|get|set|remove <url> [name] [value] [--json]",
    "  firefox-cli storage local|session get|set|remove|clear [key] [value] [--json]",
    "  firefox-cli network list|clear [--json]",
    "  firefox-cli console|errors list|clear [--json]",
    "  firefox-cli highlight <selector|@ref> [--json]",
    "  firefox-cli pdf <path> [--json]",
    "  firefox-cli set viewport <width> <height> [--json]",
    "  firefox-cli diff url|title|snapshot <expected> [--json]",
    "  firefox-cli batch <json> | --stdin [--bail] [--json]",
    "  firefox-cli click|dblclick|focus|hover|check|uncheck|scrollintoview <selector|@ref> [--json]",
    "  firefox-cli fill|type <selector|@ref> <text> [--json]",
    "  firefox-cli keyboard type|inserttext <text> [--json]",
    "  firefox-cli press <key> [--json]",
    "  firefox-cli select <selector|@ref> <value...> [--json]",
    "  firefox-cli scroll|swipe up|down|left|right [px] [selector|@ref] [--json]",
    "  firefox-cli tab [new|select|close] [target-or-url] [--json]",
    "  firefox-cli window [new|select|close] [target-or-url] [--json]",
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

async function capabilities(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const json = args.includes("--json");
  const request = createRequest("capabilities", {});
  const response = await sendOrUnavailable(dependencies, request);

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  if (json) {
    return ok(`${JSON.stringify(response.result, null, 2)}\n`);
  }

  return ok(
    `${response.result.capabilities
      .map((capability) => `${capability.command}\t${capability.status}`)
      .join("\n")}\n`,
  );
}

async function tabs(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const json = args.includes("--json");
  const positional = getPositionals(args);
  const subcommand = positional[0];
  const target = parseTargetOptions(args);
  const response =
    subcommand === "new"
      ? await sendOrUnavailable(
          dependencies,
          createRequest("tab.new", {
            ...optionalUrl(normalizeOptionalUrl(positional[1])),
            ...optionalTarget(target),
          }),
        )
      : subcommand === "select"
        ? await sendOrUnavailable(
            dependencies,
            createRequest("tab.select", {
              target: mergeTarget(target, parseOptionalTabTarget(positional[1], target)),
            }),
          )
        : subcommand === "close"
          ? await sendOrUnavailable(
              dependencies,
              createRequest("tab.close", {
                target: mergeTarget(target, parseOptionalTabTarget(positional[1], target)),
              }),
            )
          : await sendOrUnavailable(
              dependencies,
              createRequest("tabs.list", {
                ...optionalTarget(target),
              }),
            );

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  if (json) {
    return ok(`${JSON.stringify(response.result, null, 2)}\n`);
  }

  if ("tabs" in response.result) {
    return ok(response.result.tabs.map(renderTabSummary).join(""));
  }

  if ("target" in response.result) {
    return ok(`${renderTargetSummary(response.result.target)}\n`);
  }

  if ("closedTabId" in response.result) {
    return ok(`Closed tab ${response.result.closedTabId}\n`);
  }

  return ok(`${JSON.stringify(response.result)}\n`);
}

async function windows(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const json = args.includes("--json");
  const positional = getPositionals(args);
  const subcommand = positional[0];
  const target = parseTargetOptions(args);
  const response =
    subcommand === "new"
      ? await sendOrUnavailable(
          dependencies,
          createRequest("window.new", {
            ...optionalUrl(normalizeOptionalUrl(positional[1])),
          }),
        )
      : subcommand === "select"
        ? await sendOrUnavailable(
            dependencies,
            createRequest("window.select", {
              target: mergeTarget(target, parseOptionalWindowTarget(positional[1], target)),
            }),
          )
        : subcommand === "close"
          ? await sendOrUnavailable(
              dependencies,
              createRequest("window.close", {
                target: mergeTarget(target, parseOptionalWindowTarget(positional[1], target)),
              }),
            )
          : await sendOrUnavailable(dependencies, createRequest("windows.list", {}));

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  if (json) {
    return ok(`${JSON.stringify(response.result, null, 2)}\n`);
  }

  if ("windows" in response.result) {
    return ok(
      response.result.windows
        .map(
          (window) =>
            `${window.focused ? "*" : " "} w${window.id} [${window.index}] tabs=${
              window.tabCount
            }${window.activeTabId === undefined ? "" : ` active=t${window.activeTabId}`}\n`,
        )
        .join(""),
    );
  }

  if ("window" in response.result) {
    return ok(`w${response.result.window.id} [${response.result.window.index}]\n`);
  }

  if ("closedWindowId" in response.result) {
    return ok(`Closed window ${response.result.closedWindowId}\n`);
  }

  return ok(`${JSON.stringify(response.result)}\n`);
}

async function open(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const json = args.includes("--json");
  const url = normalizeOptionalUrl(getPositionals(args)[0]);
  if (url === undefined) {
    return error("Missing URL.\n");
  }

  const response = await sendOrUnavailable(
    dependencies,
    createRequest("open", {
      url,
      newTab: args.includes("--new-tab"),
      ...optionalTarget(parseTargetOptions(args)),
    }),
  );

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${renderTargetSummary(response.result.target)}\n`);
}

async function navigation(
  command: "back" | "forward" | "reload",
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const json = args.includes("--json");
  const response = await sendOrUnavailable(
    dependencies,
    createRequest(command, {
      ...optionalTarget(parseTargetOptions(args)),
    }),
  );

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${renderTargetSummary(response.result.target)}\n`);
}

async function snapshot(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const json = args.includes("--json");
  const response = await sendOrUnavailable(
    dependencies,
    createRequest("snapshot", {
      interactiveOnly: args.includes("-i") || args.includes("--interactive"),
      compact: args.includes("-c") || args.includes("--compact") || !args.includes("--verbose"),
      ...optionalPositiveInteger(args, ["-d", "--depth"], "depth", "maxDepth"),
      ...optionalStringOption(args, ["-s", "--selector"], "selector"),
      ...optionalPositiveInteger(args, ["--max-output"], "max output", "maxOutputBytes"),
      ...optionalTarget(parseTargetOptions(args)),
    }),
  );

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(response.result.text.endsWith("\n") ? response.result.text : `${response.result.text}\n`);
}

async function refResolve(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const json = args.includes("--json");
  const ref = getPositionals(args)[0];
  if (ref === undefined) {
    return error("Missing ref.\n");
  }

  const response = await sendOrUnavailable(
    dependencies,
    createRequest("ref.resolve", {
      ref,
      ...optionalStringOption(args, ["--generation"], "generationId"),
      ...optionalTarget(parseTargetOptions(args)),
    }),
  );

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  if (json) {
    return ok(`${JSON.stringify(response.result, null, 2)}\n`);
  }

  const element = response.result.element;
  return ok(
    `${element.ref} ${element.role} ${element.name ?? element.text ?? element.tagName} (${element.generationId})\n`,
  );
}

async function get(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const json = args.includes("--json");
  const positional = getPositionals(args);
  const kind = positional[0];
  if (!isGetKind(kind)) {
    return error("Missing or invalid get kind.\n");
  }

  const elementTarget = positional[1];
  const attribute = positional[2];
  if (kind === "attr" && attribute === undefined) {
    return error("Missing attribute name.\n");
  }

  if ((kind === "title" || kind === "url") && elementTarget !== undefined) {
    return error(`get ${kind} does not accept a selector or ref.\n`);
  }

  if (kind !== "title" && kind !== "url" && elementTarget === undefined) {
    return error("Missing selector or ref.\n");
  }

  const response = await sendOrUnavailable(
    dependencies,
    createRequest("get", {
      kind,
      ...parseElementTarget(elementTarget),
      ...(kind === "attr" && attribute !== undefined ? { attribute } : {}),
      ...optionalStringOption(args, ["--generation"], "generationId"),
      ...optionalPositiveInteger(args, ["--max-output"], "max output", "maxOutputBytes"),
      ...optionalTarget(parseTargetOptions(args)),
    }),
  );

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${formatGetValue(response.result.value)}\n`);
}

async function is(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const json = args.includes("--json");
  const positional = getPositionals(args);
  const kind = positional[0];
  if (!isIsKind(kind)) {
    return error("Missing or invalid is kind.\n");
  }

  const elementTarget = positional[1];
  if (elementTarget === undefined) {
    return error("Missing selector or ref.\n");
  }

  const response = await sendOrUnavailable(
    dependencies,
    createRequest("is", {
      kind,
      ...parseElementTarget(elementTarget),
      ...optionalStringOption(args, ["--generation"], "generationId"),
      ...optionalTarget(parseTargetOptions(args)),
    }),
  );

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${response.result.value}\n`);
}

async function wait(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const json = args.includes("--json");
  const waitArgs = parseWaitArguments(args);
  const params = parseWaitParams(waitArgs);
  const response = await sendOrUnavailable(
    dependencies,
    createRequest("wait", {
      ...params,
      ...(waitArgs.timeout === undefined
        ? {}
        : { timeoutMs: parsePositiveIntegerValue(waitArgs.timeout, "timeout") }),
      ...(waitArgs.interval === undefined
        ? {}
        : { intervalMs: parsePositiveIntegerValue(waitArgs.interval, "interval") }),
      ...optionalTarget(parseTargetOptions(args)),
    }),
  );

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${formatWaitResult(response.result)}\n`);
}

async function evalCommand(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const parsedArgs = parseEvalArguments(args);
  const script = await readEvalScript(parsedArgs, dependencies);
  const response = await sendOrUnavailable(
    dependencies,
    createRequest("eval", {
      script,
      source: parsedArgs.source,
      ...(parsedArgs.timeout === undefined
        ? {}
        : { timeoutMs: parsePositiveIntegerValue(parsedArgs.timeout, "timeout") }),
      ...(parsedArgs.maxResultBytes === undefined
        ? {}
        : { maxResultBytes: parsePositiveIntegerValue(parsedArgs.maxResultBytes, "max output") }),
      ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
    }),
  );

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return parsedArgs.json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${formatEvalResult(response.result)}\n`);
}

async function screenshot(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const parsedArgs = parseScreenshotArguments(args);
  const outputPath = resolve(
    dependencies.cwd ?? process.cwd(),
    parsedArgs.outputPath ?? "screenshot.png",
  );
  const response = await sendOrUnavailable(
    dependencies,
    createRequest("screenshot", {
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
    }),
  );

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return parsedArgs.json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${formatScreenshotResult(response.result)}\n`);
}

async function drag(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const parsed = parsePositionalsAndOptions(args);
  const [source, target] = parsed.positionals;
  if (source === undefined || target === undefined) {
    return error("Missing drag source or target.\n");
  }
  return formatActionResponse(
    await sendOrUnavailable(
      dependencies,
      createRequest("drag", {
        ...sourceDragTarget(source, "source"),
        ...sourceDragTarget(target, "target"),
        ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
      }),
    ),
    parsed.optionArgs.includes("--json"),
  );
}

async function upload(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const parsed = parsePositionalsAndOptions(args, { preserveUnknownOptions: true });
  const [elementTarget, ...paths] = parsed.positionals;
  if (elementTarget === undefined || paths.length === 0) {
    return error("Missing upload selector/ref or file path.\n");
  }
  const files = await Promise.all(
    paths.map(async (path) => {
      const absolutePath = resolve(dependencies.cwd ?? process.cwd(), path);
      return {
        name: basename(path),
        dataBase64: (await readFile(absolutePath)).toString("base64"),
      };
    }),
  );
  return formatActionResponse(
    await sendOrUnavailable(
      dependencies,
      createRequest("upload", {
        ...parseElementTarget(elementTarget),
        files,
        ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
        ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
      }),
    ),
    parsed.optionArgs.includes("--json"),
  );
}

async function mouse(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const parsed = parsePositionalsAndOptions(args);
  const action = parsed.positionals[0];
  if (action !== "move" && action !== "down" && action !== "up" && action !== "wheel") {
    return error("Missing or invalid mouse action.\n");
  }
  const maybeTarget = parsed.positionals[1];
  const response = await sendOrUnavailable(
    dependencies,
    createRequest("mouse", {
      action,
      ...parseElementTarget(maybeTarget),
      ...optionalNumberOption(parsed.optionArgs, ["--x"], "x"),
      ...optionalNumberOption(parsed.optionArgs, ["--y"], "y"),
      ...optionalNumberOption(parsed.optionArgs, ["--button"], "button"),
      ...optionalNumberOption(parsed.optionArgs, ["--delta-x"], "deltaX"),
      ...optionalNumberOption(parsed.optionArgs, ["--delta-y"], "deltaY"),
      ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
      ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
    }),
  );
  return formatActionResponse(response, parsed.optionArgs.includes("--json"));
}

async function keyEvent(
  command: "keydown" | "keyup",
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const parsed = parsePositionalsAndOptions(args);
  const key = parsed.positionals[0];
  if (key === undefined) {
    return error("Missing key.\n");
  }
  const response = await sendOrUnavailable(
    dependencies,
    createRequest(command, {
      key,
      ...parseElementTarget(parsed.positionals[1]),
      ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
      ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
    }),
  );
  return formatActionResponse(response, parsed.optionArgs.includes("--json"));
}

async function find(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const parsed = parsePayloadPositionalsAndOptions(args, {
    payloadStartPositionals: 1,
    minPositionals: 2,
  });
  const [kind, value] = parsed.positionals;
  if (!isFindKind(kind) || value === undefined) {
    return error("Missing or invalid find kind/value.\n");
  }
  const response = await sendOrUnavailable(
    dependencies,
    createRequest("find", {
      kind,
      value,
      ...optionalBooleanFlag(parsed.optionArgs, "--first", "first"),
      ...optionalBooleanFlag(parsed.optionArgs, "--last", "last"),
      ...optionalPositiveInteger(parsed.optionArgs, ["--nth"], "nth", "nth"),
      ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
    }),
  );
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }
  return parsed.optionArgs.includes("--json")
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(
        response.result.elements
          .map(
            (element) =>
              `${element.ref ?? ""} ${element.role} ${element.name ?? element.text ?? element.tagName}\n`,
          )
          .join(""),
      );
}

async function frame(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const json = args.includes("--json");
  const response = await sendOrUnavailable(
    dependencies,
    createRequest("frame", { ...optionalTarget(parseTargetOptions(args)) }),
  );
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }
  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(
        response.result.frames
          .map((frame) => `${frame.index} ${frame.title ?? ""} ${frame.url ?? ""}\n`)
          .join(""),
      );
}

async function download(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const json = args.includes("--json");
  const positional = getPositionals(args);
  const url = normalizeOptionalUrl(positional[0]);
  if (url === undefined) {
    return error("Missing download URL.\n");
  }
  const response = await sendOrUnavailable(
    dependencies,
    createRequest("download", {
      url,
      ...(positional[1] === undefined ? {} : { filename: positional[1] }),
      saveAs: args.includes("--save-as"),
    }),
  );
  return formatJsonOrObject(response, json);
}

async function dialog(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const json = args.includes("--json");
  const positional = getPositionals(args, { preserveUnknownOptions: true });
  const action = positional[0] ?? "status";
  if (action !== "status" && action !== "accept" && action !== "dismiss") {
    return error("Missing or invalid dialog action.\n");
  }
  return formatJsonOrObject(
    await sendOrUnavailable(
      dependencies,
      createRequest("dialog", {
        action,
        ...(positional[1] === undefined ? {} : { promptText: positional[1] }),
        ...optionalTarget(parseTargetOptions(args)),
      }),
    ),
    json,
  );
}

async function clipboard(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const parsed = parsePayloadPositionalsAndOptions(args, {
    payloadStartPositionals: 1,
    minPositionals: 1,
  });
  const action = parsed.positionals[0] ?? "read";
  if (action !== "read" && action !== "write" && action !== "copy" && action !== "paste") {
    return error("Missing or invalid clipboard action.\n");
  }
  const value = parsed.positionals[1];
  return formatJsonOrObject(
    await sendOrUnavailable(
      dependencies,
      createRequest("clipboard", {
        action,
        ...(action === "write" ? { text: value ?? "" } : parseElementTarget(value)),
        ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
        ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
      }),
    ),
    parsed.optionArgs.includes("--json"),
  );
}

async function cookies(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const parsed = parsePayloadPositionalsAndOptions(args, {
    payloadStartPositionals: 2,
    minPositionals: 2,
  });
  const [action, url, name, value] = parsed.positionals;
  if (
    (action !== "list" && action !== "get" && action !== "set" && action !== "remove") ||
    url === undefined
  ) {
    return error("Missing or invalid cookies action/url.\n");
  }
  return formatJsonOrObject(
    await sendOrUnavailable(
      dependencies,
      createRequest("cookies", {
        action,
        url: normalizeOptionalUrl(url) ?? url,
        ...(name === undefined ? {} : { name }),
        ...(value === undefined ? {} : { value }),
      }),
    ),
    parsed.optionArgs.includes("--json"),
  );
}

async function storage(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const parsed = parsePayloadPositionalsAndOptions(args, {
    payloadStartPositionals: 2,
    minPositionals: 2,
  });
  const [area, action, key, value] = parsed.positionals;
  if (
    (area !== "local" && area !== "session") ||
    (action !== "get" && action !== "set" && action !== "remove" && action !== "clear")
  ) {
    return error("Missing or invalid storage area/action.\n");
  }
  return formatJsonOrObject(
    await sendOrUnavailable(
      dependencies,
      createRequest("storage", {
        area,
        action,
        ...(key === undefined ? {} : { key }),
        ...(value === undefined ? {} : { value }),
        ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
      }),
    ),
    parsed.optionArgs.includes("--json"),
  );
}

async function network(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const json = args.includes("--json");
  const positional = getPositionals(args);
  const action = positional[0] ?? "list";
  if (action !== "list" && action !== "clear") {
    return error("Missing or invalid network action.\n");
  }
  return formatJsonOrObject(
    await sendOrUnavailable(
      dependencies,
      createRequest("network", {
        action,
        ...optionalStringOption(args, ["--url"], "urlGlob"),
      }),
    ),
    json,
  );
}

async function consoleCommand(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  return logCommand("console", args, dependencies);
}

async function errors(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  return logCommand("errors", args, dependencies);
}

async function logCommand(
  command: "console" | "errors",
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const action = getPositionals(args)[0] ?? "list";
  if (action !== "list" && action !== "clear") {
    return error(`Missing or invalid ${command} action.\n`);
  }
  return formatJsonOrObject(
    await sendOrUnavailable(
      dependencies,
      createRequest(command, { action, ...optionalTarget(parseTargetOptions(args)) }),
    ),
    args.includes("--json"),
  );
}

async function highlight(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const parsed = parsePositionalsAndOptions(args);
  const elementTarget = parsed.positionals[0];
  if (elementTarget === undefined) {
    return error("Missing selector or ref.\n");
  }
  return formatJsonOrObject(
    await sendOrUnavailable(
      dependencies,
      createRequest("highlight", {
        ...parseElementTarget(elementTarget),
        ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
        ...optionalPositiveInteger(parsed.optionArgs, ["--duration"], "duration", "durationMs"),
        ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
      }),
    ),
    parsed.optionArgs.includes("--json"),
  );
}

async function pdf(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const path = getPositionals(args)[0];
  if (path === undefined) {
    return error("Missing PDF path.\n");
  }
  return formatJsonOrObject(
    await sendOrUnavailable(
      dependencies,
      createRequest("pdf", {
        path: resolve(dependencies.cwd ?? process.cwd(), path),
        ...optionalTarget(parseTargetOptions(args)),
      }),
    ),
    args.includes("--json"),
  );
}

async function setCommand(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const positional = getPositionals(args);
  if (positional[0] !== "viewport") {
    return error("Missing or invalid set command.\n");
  }
  const width = parsePositiveIntegerValue(positional[1] ?? "", "width");
  const height = parsePositiveIntegerValue(positional[2] ?? "", "height");
  return formatJsonOrObject(
    await sendOrUnavailable(
      dependencies,
      createRequest("set.viewport", {
        width,
        height,
        ...optionalTarget(parseTargetOptions(args)),
      }),
    ),
    args.includes("--json"),
  );
}

async function diffCommand(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const parsed = parsePayloadPositionalsAndOptions(args, {
    payloadStartPositionals: 1,
    minPositionals: 2,
  });
  const [kind, expected] = parsed.positionals;
  if ((kind !== "url" && kind !== "title" && kind !== "snapshot") || expected === undefined) {
    return error("Missing or invalid diff kind/expected value.\n");
  }
  return formatJsonOrObject(
    await sendOrUnavailable(
      dependencies,
      createRequest("diff", {
        kind,
        expected,
        ...optionalStringOption(parsed.optionArgs, ["--selector"], "selector"),
        ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
      }),
    ),
    parsed.optionArgs.includes("--json"),
  );
}

async function batch(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const parsedArgs = parseBatchArguments(args);
  const steps = await readBatchSteps(parsedArgs, dependencies);
  const response = await sendOrUnavailable(
    dependencies,
    createRequest("batch", {
      steps,
      ...(parsedArgs.bail ? { bail: true } : {}),
      ...(parsedArgs.timeout === undefined
        ? {}
        : { timeoutMs: parsePositiveIntegerValue(parsedArgs.timeout, "timeout") }),
      ...(parsedArgs.maxResultBytes === undefined
        ? {}
        : { maxResultBytes: parsePositiveIntegerValue(parsedArgs.maxResultBytes, "max output") }),
      ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
    }),
  );

  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  const exitCode: CliExitCode = response.result.ok ? 0 : 1;
  return {
    exitCode,
    stdout: parsedArgs.json
      ? `${JSON.stringify(response.result, null, 2)}\n`
      : `${formatBatchResult(response.result)}\n`,
    stderr: "",
  };
}

async function elementAction(
  command: "click" | "dblclick" | "focus" | "hover" | "check" | "uncheck" | "scrollintoview",
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const parsedArgs = parsePositionalsAndOptions(args);
  const json = parsedArgs.optionArgs.includes("--json");
  const elementTarget = parsedArgs.positionals[0];
  if (elementTarget === undefined) {
    return error("Missing selector or ref.\n");
  }

  const response = await sendOrUnavailable(
    dependencies,
    createRequest(command, {
      ...parseElementTarget(elementTarget),
      ...optionalStringOption(parsedArgs.optionArgs, ["--generation"], "generationId"),
      ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
    }),
  );

  return formatActionResponse(response, json);
}

async function textElementAction(
  command: "fill" | "type",
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const parsedArgs = parsePayloadPositionalsAndOptions(args, {
    payloadStartPositionals: 1,
    minPositionals: 2,
  });
  const json = parsedArgs.optionArgs.includes("--json");
  const positional = parsedArgs.positionals;
  const elementTarget = positional[0];
  const text = positional[1];
  if (elementTarget === undefined) {
    return error("Missing selector or ref.\n");
  }
  if (text === undefined) {
    return error("Missing text.\n");
  }

  const response = await sendOrUnavailable(
    dependencies,
    createRequest(command, {
      ...parseElementTarget(elementTarget),
      text,
      ...optionalStringOption(parsedArgs.optionArgs, ["--generation"], "generationId"),
      ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
    }),
  );

  return formatActionResponse(response, json);
}

async function press(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const parsedArgs = parsePositionalsAndOptions(args);
  const json = parsedArgs.optionArgs.includes("--json");
  const key = parsedArgs.positionals[0];
  if (key === undefined) {
    return error("Missing key.\n");
  }

  const response = await sendOrUnavailable(
    dependencies,
    createRequest("press", {
      key,
      ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
    }),
  );

  return formatActionResponse(response, json);
}

async function keyboard(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const parsedArgs = parsePayloadPositionalsAndOptions(args, {
    payloadStartPositionals: 1,
    minPositionals: 2,
  });
  const json = parsedArgs.optionArgs.includes("--json");
  const positional = parsedArgs.positionals;
  const subcommand = positional[0];
  const text = positional[1];
  if (subcommand !== "type" && subcommand !== "inserttext") {
    return error("Missing or invalid keyboard command.\n");
  }
  if (text === undefined) {
    return error("Missing text.\n");
  }

  const command = subcommand === "type" ? "keyboard.type" : "keyboard.inserttext";
  const response = await sendOrUnavailable(
    dependencies,
    createRequest(command, {
      text,
      ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
    }),
  );

  return formatActionResponse(response, json);
}

async function select(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const parsedArgs = parseSelectArguments(args);
  const json = parsedArgs.optionArgs.includes("--json");
  const positional = parsedArgs.positionals;
  const elementTarget = positional[0];
  const values = positional.slice(1);
  if (elementTarget === undefined) {
    return error("Missing selector or ref.\n");
  }
  if (values.length === 0) {
    return error("Missing select value.\n");
  }

  const response = await sendOrUnavailable(
    dependencies,
    createRequest("select", {
      ...parseElementTarget(elementTarget),
      values,
      ...optionalStringOption(parsedArgs.optionArgs, ["--generation"], "generationId"),
      ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
    }),
  );

  return formatActionResponse(response, json);
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

async function scroll(
  command: "scroll" | "swipe",
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const parsedArgs = parsePositionalsAndOptions(args);
  const json = parsedArgs.optionArgs.includes("--json");
  const positional = parsedArgs.positionals;
  const direction = positional[0];
  if (!isScrollDirection(direction)) {
    return error(`Invalid direction: ${direction ?? ""}\n`);
  }

  const maybeDistance = positional[1];
  const hasDistance = maybeDistance !== undefined && /^\d+$/u.test(maybeDistance);
  const distancePx = hasDistance ? Number(maybeDistance) : undefined;
  const elementTarget = hasDistance ? positional[2] : positional[1];

  const response = await sendOrUnavailable(
    dependencies,
    createRequest(command, {
      direction,
      ...(distancePx === undefined ? {} : { distancePx }),
      ...parseElementTarget(elementTarget),
      ...optionalStringOption(parsedArgs.optionArgs, ["--generation"], "generationId"),
      ...optionalTarget(parseTargetOptions(parsedArgs.optionArgs)),
    }),
  );

  return formatActionResponse(response, json);
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

  const installed = JSON.parse(content) as { readonly path?: unknown };
  if (installed.path !== plan.manifest.path) {
    return {
      status: "stale",
      path: plan.manifestPath,
      installedPath: typeof installed.path === "string" ? installed.path : "<missing>",
      expectedPath: plan.manifest.path,
      nextAction: "Run `firefox-cli doctor --fix`.",
    };
  }

  return {
    status: "installed",
    path: plan.manifestPath,
  };
}

async function checkExtensionConnection(dependencies: CliDependencies): Promise<{
  readonly status: "connected" | "not-approved" | "version-mismatch" | "disconnected";
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

  return {
    status: "disconnected",
    nextAction: "Load the extension in Firefox and keep Firefox running.",
  };
}

async function sendOrUnavailable<C extends CommandId>(
  dependencies: CliDependencies,
  request: RequestEnvelope<C>,
): Promise<ResponseEnvelope<C>> {
  try {
    if (dependencies.sendRequest === undefined) {
      throw new LocalIpcError("CONNECTION_FAILED", "No native host IPC client is configured.");
    }
    return (await dependencies.sendRequest(request)) as ResponseEnvelope<C>;
  } catch (error) {
    if (error instanceof LocalIpcError) {
      return {
        protocolVersion: request.protocolVersion,
        id: request.id,
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
  return (
    value === "text" ||
    value === "html" ||
    value === "value" ||
    value === "attr" ||
    value === "title" ||
    value === "url" ||
    value === "count" ||
    value === "box" ||
    value === "styles"
  );
}

function isIsKind(value: string | undefined): value is "visible" | "enabled" | "checked" {
  return value === "visible" || value === "enabled" || value === "checked";
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
  return value === "up" || value === "down" || value === "left" || value === "right";
}

function isFindKind(
  value: string | undefined,
): value is "role" | "text" | "label" | "placeholder" | "alt" | "title" | "testid" {
  return (
    value === "role" ||
    value === "text" ||
    value === "label" ||
    value === "placeholder" ||
    value === "alt" ||
    value === "title" ||
    value === "testid"
  );
}

function isPotentialBatchCliCommand(value: string | undefined): boolean {
  return (
    value === "tab" ||
    value === "window" ||
    value === "open" ||
    value === "back" ||
    value === "forward" ||
    value === "reload" ||
    value === "snapshot" ||
    value === "ref" ||
    value === "get" ||
    value === "is" ||
    value === "wait" ||
    value === "eval" ||
    value === "screenshot" ||
    value === "drag" ||
    value === "upload" ||
    value === "mouse" ||
    value === "keydown" ||
    value === "keyup" ||
    value === "find" ||
    value === "frame" ||
    value === "download" ||
    value === "dialog" ||
    value === "clipboard" ||
    value === "cookies" ||
    value === "storage" ||
    value === "network" ||
    value === "console" ||
    value === "errors" ||
    value === "highlight" ||
    value === "pdf" ||
    value === "set" ||
    value === "diff" ||
    value === "click" ||
    value === "dblclick" ||
    value === "focus" ||
    value === "hover" ||
    value === "check" ||
    value === "uncheck" ||
    value === "scrollintoview" ||
    value === "fill" ||
    value === "type" ||
    value === "press" ||
    value === "keyboard" ||
    value === "select" ||
    value === "scroll" ||
    value === "swipe"
  );
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
        if (format !== "png" && format !== "jpeg") {
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

  const steps: BatchStep[] = [];
  for (const [index, rawStep] of raw.entries()) {
    steps.push(await parseBatchStep(rawStep, index, dependencies));
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
): Promise<BatchStep> {
  if (Array.isArray(rawStep)) {
    if (!rawStep.every((value): value is string => typeof value === "string")) {
      throw new CliUsageError(`Batch argv step ${index} must contain only strings.`);
    }
    return batchStepFromArgv(rawStep, index, dependencies);
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
): Promise<BatchStep> {
  if (!isPotentialBatchCliCommand(argv[0])) {
    throw new CliUsageError(`Invalid batch argv command at step ${index}.`);
  }
  if (batchArgvReadsStdin(argv)) {
    throw new CliUsageError(`Batch argv step ${index} cannot read from stdin.`);
  }

  let captured: RequestEnvelope | undefined;
  const parsed = await runCli(argv, {
    ...dependencies,
    sendRequest: async (request) => {
      captured = request;
      return createErrorResponse(request.id, {
        code: "UNSUPPORTED_CAPABILITY",
        message: "Batch parser captured request.",
      });
    },
    clearPairState: async () => {
      throw new CliUsageError(`Invalid batch argv command at step ${index}.`);
    },
  });

  if (captured === undefined) {
    throw new CliUsageError(
      parsed.stderr.trim().length === 0
        ? `Invalid batch argv command at step ${index}.`
        : `Invalid batch argv step ${index}: ${parsed.stderr.trim()}`,
    );
  }

  if (!isBatchableCommandId(captured.command)) {
    throw new CliUsageError(`Invalid batch command at step ${index}.`);
  }

  return {
    command: captured.command,
    params: stripImplicitBatchTarget(captured.command, captured.params, argv),
  };
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
  return (
    command === "tab.select" ||
    command === "tab.close" ||
    command === "window.select" ||
    command === "window.close"
  );
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
