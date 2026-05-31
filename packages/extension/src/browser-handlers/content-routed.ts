import {
  LOG_RESULT_METADATA_PROTOCOL_VERSION,
  createErrorResponseForRequest,
  createOkResponse,
  type ActionKind,
  type ActionResult,
  type ConsoleResult,
  type DiffResult,
  type ErrorsResult,
  type FindResult,
  type FrameResult,
  type GetResult,
  type HighlightResult,
  type IsResult,
  type RefResolveResult,
  type RequestEnvelope,
  type SnapshotResult,
  type StorageResult,
} from "@firefox-cli/protocol";
import { sendContentCommand } from "../browser-command/content-bridge.js";
import { BrowserCommandError } from "../browser-command/errors.js";
import type { BackgroundBrowserAdapter } from "../browser-command/types.js";
import type { BrowserHandlerContext, BrowserHandlerMap } from "./types.js";

type ContentRoutedCommand =
  | "snapshot"
  | "ref.resolve"
  | "get"
  | "is"
  | "find"
  | "frame"
  | "dialog"
  | "storage"
  | "console"
  | "errors"
  | "highlight"
  | "diff";

export const contentRoutedHandlers: BrowserHandlerMap<ContentRoutedCommand> = {
  snapshot: async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    const snapshotResponse = await sendContentCommand(adapter, resolved.tab.id, request);
    if (!snapshotResponse.ok) {
      return createErrorResponseForRequest(request, snapshotResponse.error);
    }

    const result: SnapshotResult = {
      ...snapshotResponse.result,
      target: resolved.target,
    };
    return createOkResponse(request, result);
  },
  "ref.resolve": async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    const refResponse = await sendContentCommand(adapter, resolved.tab.id, request);
    if (!refResponse.ok) {
      return createErrorResponseForRequest(request, refResponse.error);
    }

    const result: RefResolveResult = {
      ...refResponse.result,
      target: resolved.target,
    };
    return createOkResponse(request, result);
  },
  get: async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    if (request.params.kind === "title" || request.params.kind === "url") {
      return createOkResponse(request, {
        kind: request.params.kind,
        value: request.params.kind === "title" ? (resolved.tab.title ?? "") : (resolved.tab.url ?? ""),
        target: resolved.target,
      });
    }

    const getResponse = await sendContentCommand(adapter, resolved.tab.id, request);
    if (!getResponse.ok) {
      return createErrorResponseForRequest(request, getResponse.error);
    }

    const result: GetResult = {
      ...getResponse.result,
      target: resolved.target,
    };
    return createOkResponse(request, result);
  },
  is: async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    const isResponse = await sendContentCommand(adapter, resolved.tab.id, request);
    if (!isResponse.ok) {
      return createErrorResponseForRequest(request, isResponse.error);
    }

    const result: IsResult = {
      ...isResponse.result,
      target: resolved.target,
    };
    return createOkResponse(request, result);
  },
  find: async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    const findResponse = await sendContentCommand(adapter, resolved.tab.id, request);
    if (!findResponse.ok) {
      return createErrorResponseForRequest(request, findResponse.error);
    }
    const result: FindResult = { ...findResponse.result, target: resolved.target };
    return createOkResponse(request, result);
  },
  frame: async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    const frameResponse = await sendContentCommand(adapter, resolved.tab.id, request);
    if (!frameResponse.ok) {
      return createErrorResponseForRequest(request, frameResponse.error);
    }
    const result: FrameResult = { ...frameResponse.result, target: resolved.target };
    return createOkResponse(request, result);
  },
  dialog: async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    const dialogResponse = await sendContentCommand(adapter, resolved.tab.id, request);
    if (!dialogResponse.ok) {
      return createErrorResponseForRequest(request, dialogResponse.error);
    }
    return createOkResponse(request, dialogResponse.result);
  },
  storage: async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    const storageResponse = await sendContentCommand(adapter, resolved.tab.id, request);
    if (!storageResponse.ok) {
      return createErrorResponseForRequest(request, storageResponse.error);
    }
    const result: StorageResult = storageResponse.result;
    return createOkResponse(request, result);
  },
  console: async (request, adapter, context) => handleLogCommand(request, adapter, context),
  errors: async (request, adapter, context) => handleLogCommand(request, adapter, context),
  highlight: async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    const highlightResponse = await sendContentCommand(adapter, resolved.tab.id, request);
    if (!highlightResponse.ok) {
      return createErrorResponseForRequest(request, highlightResponse.error);
    }
    const result: HighlightResult = { ...highlightResponse.result, target: resolved.target };
    return createOkResponse(request, result);
  },
  diff: async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    const actual =
      request.params.kind === "url"
        ? (resolved.tab.url ?? "")
        : request.params.kind === "title"
          ? (resolved.tab.title ?? "")
          : await snapshotTextForDiff(adapter, resolved.tab.id, request);
    const result: DiffResult = {
      kind: request.params.kind,
      expected: request.params.expected,
      actual,
      matches: actual === request.params.expected,
    };
    return createOkResponse(request, result);
  },
};

export async function handleActionCommand(
  command: RequestEnvelope<ActionKind>,
  adapter: BackgroundBrowserAdapter,
  context: BrowserHandlerContext,
) {
  const resolved = await context.targetContext.resolveTarget(command.params.target);
  const actionResponse = await sendContentCommand(adapter, resolved.tab.id, command);
  if (!actionResponse.ok) {
    return createErrorResponseForRequest(command, actionResponse.error);
  }

  const result: ActionResult = {
    ...actionResponse.result,
    target: resolved.target,
  };
  return createOkResponse(command, result);
}

async function handleLogCommand(
  command: RequestEnvelope<"console" | "errors">,
  adapter: BackgroundBrowserAdapter,
  context: BrowserHandlerContext,
) {
  const resolved = await context.targetContext.resolveTarget(command.params.target);
  const logResponse = await sendContentCommand(adapter, resolved.tab.id, command);
  if (!logResponse.ok) {
    return createErrorResponseForRequest(command, logResponse.error);
  }
  return createOkResponse(
    command,
    logResultForProtocolVersion(logResponse.result as ConsoleResult | ErrorsResult, command.protocolVersion),
  );
}

function logResultForProtocolVersion<T extends ConsoleResult | ErrorsResult>(
  result: T,
  protocolVersion: number,
): T {
  if (protocolVersion >= LOG_RESULT_METADATA_PROTOCOL_VERSION) {
    return result;
  }
  const { truncated: _truncated, droppedEntries: _droppedEntries, ...compatibleResult } = result;
  return compatibleResult as T;
}

async function snapshotTextForDiff(
  adapter: BackgroundBrowserAdapter,
  tabId: number,
  command: RequestEnvelope<"diff">,
): Promise<string> {
  const snapshotRequest: RequestEnvelope<"snapshot"> = {
    protocolVersion: command.protocolVersion,
    id: `${command.id}:snapshot`,
    command: "snapshot",
    params: {
      compact: true,
      ...(command.params.selector === undefined ? {} : { selector: command.params.selector }),
    },
  };
  const snapshotResponse = await sendContentCommand(adapter, tabId, snapshotRequest);
  if (!snapshotResponse.ok) {
    throw new BrowserCommandError(
      snapshotResponse.error.code as BrowserCommandError["code"],
      snapshotResponse.error.message,
    );
  }
  return snapshotResponse.result.text;
}
