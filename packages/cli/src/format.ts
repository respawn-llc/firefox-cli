import type {
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
import type { CliResponseFormatterKind, CliResult } from "./types.js";

type SuccessfulResponse<C extends CommandId> = Extract<ResponseEnvelope<C>, { readonly ok: true }>;

function responseResult<C extends CommandId>(
  response: ResponseEnvelope<C>,
): SuccessfulResponse<C>["result"] {
  return (response as SuccessfulResponse<C>).result;
}

export function formatCliResponse<C extends CommandId>(
  formatter: CliResponseFormatterKind,
  response: ResponseEnvelope<C>,
  json: boolean,
): CliResult {
  if (!response.ok) {
    return error(formatProtocolError(response.error));
  }

  switch (formatter) {
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

    case "tab-list": {
      const result = responseResult(response as ResponseEnvelope<"tabs.list">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(result.tabs.map(renderTabSummary).join(""));
    }

    case "tab-target": {
      const result = responseResult(
        response as ResponseEnvelope<
          "tab.new" | "tab.select" | "open" | "back" | "forward" | "reload"
        >,
      );
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(`${renderTargetSummary(result.target)}\n`);
    }

    case "tab-close": {
      const result = responseResult(response as ResponseEnvelope<"tab.close">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(`Closed tab ${result.closedTabId}\n`);
    }

    case "window-list": {
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

    case "window-target": {
      const result = responseResult(response as ResponseEnvelope<"window.new" | "window.select">);
      return json
        ? ok(`${JSON.stringify(result, null, 2)}\n`)
        : ok(`w${result.window.id} [${result.window.index}]\n`);
    }

    case "window-close": {
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

    case "ref": {
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

    case "action":
      return formatActionResponse(response as ResponseEnvelope<ActionResponseCommand>, json);
    case "json-object":
      return formatJsonOrObject(response as ResponseEnvelope<CommandId>, json);
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
  response: ResponseEnvelope<ActionResponseCommand>,
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
