import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
  createRequest,
  type CommandId,
  type ProtocolError,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ResolvedTarget,
  type TabSummary,
  type TargetSelector,
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

export type CliDependencies = {
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly homeDir: string;
  readonly appDataDir?: string;
  readonly packageRoot: string;
  readonly binaryPath?: string;
  readonly extensionPath?: string;
  sendRequest?(request: RequestEnvelope): Promise<ResponseEnvelope>;
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

  if (args[0] === "back" || args[0] === "forward" || args[0] === "reload") {
    return navigation(args[0], args.slice(1), dependencies);
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
    const extensionPath =
      dependencies.extensionPath ?? resolve(dependencies.packageRoot, "extension/development");
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
        `Extension: load ${extensionPath} in Firefox about:debugging.`,
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
              target: mergeTarget(target, { tab: parseTargetValue(positional[1]) }),
            }),
          )
        : subcommand === "close"
          ? await sendOrUnavailable(
              dependencies,
              createRequest("tab.close", {
                target: mergeTarget(target, { tab: parseTargetValue(positional[1] ?? "active") }),
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
              target: mergeTarget(target, { window: parseTargetValue(positional[1]) }),
            }),
          )
        : subcommand === "close"
          ? await sendOrUnavailable(
              dependencies,
              createRequest("window.close", {
                target: mergeTarget(target, {
                  window: parseTargetValue(positional[1] ?? "active"),
                }),
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

function getPositionals(args: readonly string[]): readonly string[] {
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (
      arg === "--json" ||
      arg === "--new-tab" ||
      arg === "-i" ||
      arg === "--interactive" ||
      arg === "-c" ||
      arg === "--compact" ||
      arg === "--verbose"
    ) {
      continue;
    }

    if (
      arg === "--window" ||
      arg === "--tab" ||
      arg === "-d" ||
      arg === "--depth" ||
      arg === "-s" ||
      arg === "--selector" ||
      arg === "--max-output" ||
      arg === "--generation"
    ) {
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      continue;
    }

    positionals.push(arg);
  }

  return positionals;
}

function parseTargetOptions(args: readonly string[]): TargetSelector {
  let target: TargetSelector = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--window") {
      target = mergeTarget(target, { window: parseTargetValue(args[index + 1]) });
      index += 1;
    } else if (arg === "--tab") {
      target = mergeTarget(target, { tab: parseTargetValue(args[index + 1]) });
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

function mergeTarget(base: TargetSelector, override: TargetSelector): TargetSelector {
  return {
    ...(base.window === undefined ? {} : { window: base.window }),
    ...(base.tab === undefined ? {} : { tab: base.tab }),
    ...(override.window === undefined ? {} : { window: override.window }),
    ...(override.tab === undefined ? {} : { tab: override.tab }),
  };
}

function optionalTarget(target: TargetSelector): { readonly target?: TargetSelector } {
  return target.window === undefined && target.tab === undefined ? {} : { target };
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
  outputKey: "selector" | "generationId",
): { readonly selector?: string; readonly generationId?: string } {
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
): { readonly maxDepth?: number; readonly maxOutputBytes?: number } {
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
