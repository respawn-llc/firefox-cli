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

export function formatCliResponse<C extends CommandId>(
  formatter: CliResponseFormatter<C>,
  response: ResponseEnvelope<C>,
  json: boolean,
): CliResult {
  return formatter(response, json);
}

const formatCapabilities: CliResponseFormatter<"capabilities"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(
        `${response.result.capabilities
          .map((capability) => `${capability.command}\t${capability.status}`)
          .join("\n")}\n`,
      );
};

const formatTabList: CliResponseFormatter<"tabs.list"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(response.result.tabs.map(renderTabSummary).join(""));
};

const formatTabTarget: CliResponseFormatter<
  "tab.new" | "tab.select" | "open" | "back" | "forward" | "reload"
> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${renderTargetSummary(response.result.target)}\n`);
};

const formatTabClose: CliResponseFormatter<"tab.close"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`Closed tab ${response.result.closedTabId}\n`);
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
              `${window.focused ? "*" : " "} w${window.id} [${window.index}] tabs=${
                window.tabCount
              }${window.activeTabId === undefined ? "" : ` active=t${window.activeTabId}`}\n`,
          )
          .join(""),
      );
};

const formatWindowTarget: CliResponseFormatter<"window.new" | "window.select"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`w${response.result.window.id} [${response.result.window.index}]\n`);
};

const formatWindowClose: CliResponseFormatter<"window.close"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`Closed window ${response.result.closedWindowId}\n`);
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
  return ok(
    `${element.ref} ${element.role} ${element.name ?? element.text ?? element.tagName} (${element.generationId})\n`,
  );
};

const formatGet: CliResponseFormatter<"get"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${formatGetValue(response.result.value)}\n`);
};

const formatIs: CliResponseFormatter<"is"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json ? ok(`${JSON.stringify(response.result, null, 2)}\n`) : ok(`${response.result.value}\n`);
};

const formatWait: CliResponseFormatter<"wait"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${formatWaitResult(response.result)}\n`);
};

const formatEval: CliResponseFormatter<"eval"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${formatEvalResult(response.result)}\n`);
};

const formatScreenshot: CliResponseFormatter<"screenshot"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${formatScreenshotResult(response.result)}\n`);
};

const formatFind: CliResponseFormatter<"find"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(
        response.result.elements
          .map(
            (element) =>
              `${element.ref ?? ""} ${element.role} ${element.name ?? element.text ?? element.tagName}\n`,
          )
          .join(""),
      );
};

const formatFrame: CliResponseFormatter<"frame"> = (response, json) => {
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
};

const formatBatch: CliResponseFormatter<"batch"> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return {
    exitCode: response.result.ok ? 0 : 1,
    stdout: json
      ? `${JSON.stringify(response.result, null, 2)}\n`
      : `${formatBatchResult(response.result)}\n`,
    stderr: "",
  };
};

const formatActionResponse: CliResponseFormatter<ActionKind> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${formatActionResult(response.result)}\n`);
};

const formatJsonOrObject: CliResponseFormatter<CommandId> = (response, json) => {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  return json
    ? ok(`${JSON.stringify(response.result, null, 2)}\n`)
    : ok(`${JSON.stringify(response.result)}\n`);
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
  return `${activePrefix} w${tab.windowId} t${tab.id} [${tab.index}] ${title} ${url}\n`;
}

function renderTargetSummary(target: ResolvedTarget): string {
  const title = target.title ?? "(untitled)";
  const url = target.url ?? "(url unavailable)";
  return `w${target.windowId} t${target.tabId} [${target.tabIndex}] ${title} ${url}`;
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
    result.width === undefined || result.height === undefined ? "" : ` ${result.width}x${result.height}`;
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
