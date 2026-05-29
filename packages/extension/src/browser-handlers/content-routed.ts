import {
  createErrorResponse,
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
import { getOrderedWindows, resolveTarget } from "../browser-command/targets.js";
import type { BackgroundBrowserAdapter } from "../browser-command/types.js";
import type { BrowserHandlerMap } from "./types.js";

export const contentRoutedHandlers: BrowserHandlerMap = {
  snapshot: async (request, adapter) => {
    const command = request as RequestEnvelope<"snapshot">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const snapshotResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!snapshotResponse.ok) {
      return createErrorResponse(command.id, snapshotResponse.error, command.protocolVersion);
    }

    const result: SnapshotResult = {
      ...snapshotResponse.result,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  },
  "ref.resolve": async (request, adapter) => {
    const command = request as RequestEnvelope<"ref.resolve">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const refResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!refResponse.ok) {
      return createErrorResponse(command.id, refResponse.error, command.protocolVersion);
    }

    const result: RefResolveResult = {
      ...refResponse.result,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  },
  get: async (request, adapter) => {
    const command = request as RequestEnvelope<"get">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    if (command.params.kind === "title" || command.params.kind === "url") {
      return createOkResponse(command, {
        kind: command.params.kind,
        value:
          command.params.kind === "title" ? (resolved.tab.title ?? "") : (resolved.tab.url ?? ""),
        target: resolved.target,
      });
    }

    const getResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!getResponse.ok) {
      return createErrorResponse(command.id, getResponse.error, command.protocolVersion);
    }

    const result: GetResult = {
      ...getResponse.result,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  },
  is: async (request, adapter) => {
    const command = request as RequestEnvelope<"is">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const isResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!isResponse.ok) {
      return createErrorResponse(command.id, isResponse.error, command.protocolVersion);
    }

    const result: IsResult = {
      ...isResponse.result,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  },
  find: async (request, adapter) => {
    const command = request as RequestEnvelope<"find">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const findResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!findResponse.ok) {
      return createErrorResponse(command.id, findResponse.error, command.protocolVersion);
    }
    const result: FindResult = { ...findResponse.result, target: resolved.target };
    return createOkResponse(command, result);
  },
  frame: async (request, adapter) => {
    const command = request as RequestEnvelope<"frame">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const frameResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!frameResponse.ok) {
      return createErrorResponse(command.id, frameResponse.error, command.protocolVersion);
    }
    const result: FrameResult = { ...frameResponse.result, target: resolved.target };
    return createOkResponse(command, result);
  },
  dialog: async (request, adapter) => {
    const command = request as RequestEnvelope<"dialog">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const dialogResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!dialogResponse.ok) {
      return createErrorResponse(command.id, dialogResponse.error, command.protocolVersion);
    }
    return createOkResponse(command, dialogResponse.result);
  },
  storage: async (request, adapter) => {
    const command = request as RequestEnvelope<"storage">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const storageResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!storageResponse.ok) {
      return createErrorResponse(command.id, storageResponse.error, command.protocolVersion);
    }
    const result: StorageResult = storageResponse.result;
    return createOkResponse(command, result);
  },
  console: async (request, adapter) =>
    handleLogCommand(request as RequestEnvelope<"console">, adapter),
  errors: async (request, adapter) =>
    handleLogCommand(request as RequestEnvelope<"errors">, adapter),
  highlight: async (request, adapter) => {
    const command = request as RequestEnvelope<"highlight">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const highlightResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!highlightResponse.ok) {
      return createErrorResponse(command.id, highlightResponse.error, command.protocolVersion);
    }
    const result: HighlightResult = { ...highlightResponse.result, target: resolved.target };
    return createOkResponse(command, result);
  },
  diff: async (request, adapter) => {
    const command = request as RequestEnvelope<"diff">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const actual =
      command.params.kind === "url"
        ? (resolved.tab.url ?? "")
        : command.params.kind === "title"
          ? (resolved.tab.title ?? "")
          : await snapshotTextForDiff(adapter, resolved.tab.id, command);
    const result: DiffResult = {
      kind: command.params.kind,
      expected: command.params.expected,
      actual,
      matches: actual === command.params.expected,
    };
    return createOkResponse(command, result);
  },
};

export async function handleActionCommand(
  command: RequestEnvelope<ActionKind>,
  adapter: BackgroundBrowserAdapter,
) {
  const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
  const actionResponse = await sendContentCommand(adapter, resolved.tab.id, command);
  if (!actionResponse.ok) {
    return createErrorResponse(command.id, actionResponse.error, command.protocolVersion);
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
) {
  const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
  const logResponse = await sendContentCommand(adapter, resolved.tab.id, command);
  if (!logResponse.ok) {
    return createErrorResponse(command.id, logResponse.error, command.protocolVersion);
  }
  return createOkResponse(command, logResponse.result as ConsoleResult | ErrorsResult);
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
