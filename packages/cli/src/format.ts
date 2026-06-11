import type {
  ActionKind,
  ActionResult,
  BatchResult,
  CommandId,
  EvalResult,
  ResolvedTarget,
  ResponseEnvelope,
  ScreenshotResult,
  TabSummary,
  WaitResult,
} from "@firefox-cli/protocol";
import { error, ok } from "./result.js";
import { formatProtocolError } from "./transport.js";
import type { CliResponseFormatter, CliResponseFormatterKind, CliResult } from "./types.js";

export function formatCliResponse<C extends CommandId>(formatter: CliResponseFormatter<C>, response: ResponseEnvelope<C>, json: boolean): CliResult {
  return formatter(response, json);
}

const formatCapabilities: CliResponseFormatter<"capabilities"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${response.result.capabilities.map((capability) => `${capability.command}\t${capability.status}`).join("\n")}\n`);
};

const formatTabList: CliResponseFormatter<"tabs.list"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(response.result.tabs.map(renderTabSummary).join(""));
};

const formatTabTarget: CliResponseFormatter<"tab.new" | "tab.select" | "open" | "back" | "forward" | "reload"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(`${renderTargetSummary(response.result.target)}\n`);
};

const formatTabClose: CliResponseFormatter<"tab.close"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(`Closed tab ${String(response.result.closedTabId)}\n`);
};

const formatWindowList: CliResponseFormatter<"windows.list"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(
        response.result.windows
          .map(
            (window) =>
              `${window.focused ? "*" : " "} w${String(window.id)} [${String(window.index)}] tabs=${String(
                window.tabCount,
              )}${window.activeTabId === undefined ? "" : ` active=t${String(window.activeTabId)}`}\n`,
          )
          .join(""),
      );
};

const formatWindowTarget: CliResponseFormatter<"window.new" | "window.select"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(`w${String(response.result.window.id)} [${String(response.result.window.index)}]\n`);
};

const formatWindowClose: CliResponseFormatter<"window.close"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(`Closed window ${String(response.result.closedWindowId)}\n`);
};

const formatSnapshot: CliResponseFormatter<"snapshot"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(response.result.text.endsWith("\n") ? response.result.text : `${response.result.text}\n`);
};

const formatRef: CliResponseFormatter<"ref.resolve"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  if (json) {
    return ok(`${JSON.stringify(response.result, null, 2)}\n`);
  }

  const element = response.result.element;
  return ok(`${element.ref} ${element.role} ${element.name ?? element.text ?? element.tagName} (${element.generationId})\n`);
};

const formatGet: CliResponseFormatter<"get"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(`${formatGetValue(response.result.value)}\n`);
};

const formatIs: CliResponseFormatter<"is"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(`${String(response.result.value)}\n`);
};

const formatWait: CliResponseFormatter<"wait"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(`${formatWaitResult(response.result)}\n`);
};

const formatEval: CliResponseFormatter<"eval"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(`${formatEvalResult(response.result)}\n`);
};

const formatScreenshot: CliResponseFormatter<"screenshot"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(`${formatScreenshotResult(response.result)}\n`);
};

const formatFind: CliResponseFormatter<"find"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(response.result.elements.map((element) => `${element.ref ?? ""} ${element.role} ${element.name ?? element.text ?? element.tagName}\n`).join(""));
};

const formatFrame: CliResponseFormatter<"frame"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(response.result.frames.map((frame) => `${String(frame.index)} ${frame.title ?? ""} ${frame.url ?? ""}\n`).join(""));
};

const formatBatch: CliResponseFormatter<"batch"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return {
    exitCode: response.result.ok ? 0 : 1,
    stdout: json ? `${JSON.stringify(response.result, null, 2)}\n` : `${formatBatchResult(response.result)}\n`,
    stderr: "",
  };
};

const formatActionResponse: CliResponseFormatter<ActionKind> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(`${formatActionResult(response.result)}\n`);
};

const formatJsonOrObject: CliResponseFormatter = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(`${JSON.stringify(response.result)}\n`);
};

export const formatApprovalRequest: CliResponseFormatter<"pair.requestApproval"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok("User approved the request\n");
};

export const cliResponseFormatters = {
  capabilities: formatCapabilities,
  "tab-list": formatTabList,
  "tab-target": formatTabTarget,
  "tab-close": formatTabClose,
  "window-list": formatWindowList,
  "window-target": formatWindowTarget,
  "window-close": formatWindowClose,
  snapshot: formatSnapshot,
  ref: formatRef,
  get: formatGet,
  is: formatIs,
  wait: formatWait,
  eval: formatEval,
  screenshot: formatScreenshot,
  find: formatFind,
  frame: formatFrame,
  batch: formatBatch,
  action: formatActionResponse,
  "json-object": formatJsonOrObject,
} satisfies Readonly<Record<CliResponseFormatterKind, CliResponseFormatter>>;

function renderTabSummary(tab: TabSummary): string {
  const activePrefix = tab.active ? "*" : " ";
  const title = tab.title ?? "(untitled)";
  const url = tab.url ?? "(url unavailable)";
  return `${activePrefix} w${String(tab.windowId)} t${String(tab.id)} [${String(tab.index)}] ${title} ${url}\n`;
}

function renderTargetSummary(target: ResolvedTarget): string {
  const title = target.title ?? "(untitled)";
  const url = target.url ?? "(url unavailable)";
  return `w${String(target.windowId)} t${String(target.tabId)} [${String(target.tabIndex)}] ${title} ${url}`;
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
  const suffix = `in ${String(result.elapsedMs)}ms`;
  if (result.kind === "element" && result.element !== undefined) {
    const element = result.element;
    const refPrefix = element.ref === undefined ? "" : `${element.ref} `;
    return `${refPrefix}${element.role} ${element.name ?? element.text ?? element.tagName} ${suffix}`;
  }

  if (result.kind === "text" || result.kind === "url" || result.kind === "function") {
    return `${formatGetValue(result.value)} ${suffix}`;
  }

  if (result.kind === "download") {
    return `download ${String(result.download.id)} ${result.download.state ?? "matched"} ${suffix}`;
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
  const dimensions = result.width === undefined || result.height === undefined ? "" : ` ${String(result.width)}x${String(result.height)}`;
  return `${result.path} ${String(result.bytes)} bytes${dimensions}`;
}

function formatBatchResult(result: BatchResult): string {
  return [
    ...result.steps.map((step) =>
      step.ok ? `${String(step.index)} ${step.command} ok` : `${String(step.index)} ${step.command} ${step.error.code}: ${step.error.message}`,
    ),
    `batch ${result.ok ? "ok" : "failed"} in ${String(result.elapsedMs)}ms`,
  ].join("\n");
}

function formatActionResult(result: ActionResult): string {
  const parts = [`${result.action} ok`];
  const elementText = formatActionElement(result);
  if (elementText !== undefined) {
    parts.push(elementText);
  }
  if (
    result.action === "fill" ||
    result.action === "type" ||
    result.action === "keyboard.type" ||
    result.action === "keyboard.inserttext" ||
    result.action === "upload"
  ) {
    parts.push(`valueLength=${String(result.valueLength)}`);
  }
  if (result.action === "select") {
    parts.push(`selected=${result.selectedValues.join(",")}`);
  }
  if (result.action === "scroll" || result.action === "swipe") {
    parts.push(`scroll=${String(result.scroll.x)},${String(result.scroll.y)}`);
  }
  return parts.join(" ");
}

function formatActionElement(result: ActionResult): string | undefined {
  if (result.element === undefined) {
    return undefined;
  }
  const refPrefix = result.element.ref === undefined ? "" : `${result.element.ref} `;
  return `${refPrefix}${result.element.role} ${result.element.name ?? result.element.text ?? result.element.tagName}`;
}
