import {
  createErrorResponseForRequest,
  createOkResponse,
  dispatchCommandHandler,
  type ActionKind,
  type CommandHandlerMap,
  type RequestEnvelope,
  type ResponseEnvelope,
  isActionCommand,
} from "@firefox-cli/protocol";
import { createActionResult } from "../content-actions.js";
import { createWaitResult } from "../content-wait.js";
import type { ElementRefRegistry } from "../element-ref-registry.js";
import { isDisabled, isVisible, summarizeElement, summarizeWaitElement } from "./accessibility.js";
import { createFindResult, createFrameResult } from "./commands/find-frame.js";
import { createGetResult, createIsResult } from "./commands/get-is.js";
import {
  createClipboardResult,
  createDialogResult,
  createStorageResult,
} from "./commands/page-state.js";
import { queryOptionalElement, resolveElement } from "./dom.js";
import { ContentSnapshotError, createContentErrorResponseForRequest } from "./errors.js";
import { applyElementHighlight, type HighlightScheduler } from "./highlight.js";
import { createConsoleResult, createErrorsResult, installWindowLogCapture } from "./log-capture.js";
import { createSnapshotResult } from "./snapshot-render.js";

type ContentScriptRequestContext = {
  readonly document: Document;
  readonly registry: ElementRefRegistry<Element>;
  readonly now?: number;
  readonly clock?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly highlightScheduler?: HighlightScheduler;
};

type DirectContentCommand =
  | "snapshot"
  | "ref.resolve"
  | "get"
  | "is"
  | "wait"
  | "find"
  | "frame"
  | "dialog"
  | "clipboard"
  | "storage"
  | "console"
  | "errors"
  | "highlight";

const directContentHandlers: CommandHandlerMap<
  DirectContentCommand,
  [ContentScriptRequestContext]
> = {
  snapshot: (request, options) => {
    try {
      return createOkResponse(
        request,
        createSnapshotResult(options.document, request.params, options.registry, options.now),
      );
    } catch (error) {
      return createContentErrorResponseForRequest(request, error);
    }
  },
  "ref.resolve": (request, options) => {
    try {
      const resolved = options.registry.resolveRef(request.params.ref, {
        ...(request.params.generationId === undefined
          ? {}
          : { generationId: request.params.generationId }),
        ...(options.now === undefined ? {} : { now: options.now }),
      });
      return createOkResponse(request, {
        element: summarizeElement(resolved.element, {
          ref: request.params.ref,
          generationId: resolved.generationId,
        }),
      });
    } catch (error) {
      return createContentErrorResponseForRequest(request, error);
    }
  },
  get: (request, options) => {
    try {
      return createOkResponse(
        request,
        createGetResult(options.document, request.params, options.registry, options.now),
      );
    } catch (error) {
      return createContentErrorResponseForRequest(request, error);
    }
  },
  is: (request, options) => {
    try {
      return createOkResponse(
        request,
        createIsResult(options.document, request.params, options.registry, options.now),
      );
    } catch (error) {
      return createContentErrorResponseForRequest(request, error);
    }
  },
  wait: (request, options) =>
    createWaitResult({
      document: options.document,
      params: request.params,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      resolveRef: (ref, resolveOptions) =>
        options.registry.resolveRef(ref, {
          ...(resolveOptions.generationId === undefined
            ? {}
            : { generationId: resolveOptions.generationId }),
          now: resolveOptions.now,
        }),
      queryElement: (selector) => queryOptionalElement(options.document, selector),
      summarizeElement: summarizeWaitElement,
      isVisible,
      createError: (code, message) => new ContentSnapshotError(code, message),
    })
      .then((result) => createOkResponse(request, result))
      .catch((error: unknown) => createContentErrorResponseForRequest(request, error)),
  find: (request, options) => {
    try {
      return createOkResponse(request, createFindResult(options.document, request.params));
    } catch (error) {
      return createContentErrorResponseForRequest(request, error);
    }
  },
  frame: (request, options) => createOkResponse(request, createFrameResult(options.document)),
  dialog: (request) => createOkResponse(request, createDialogResult(request.params.action)),
  clipboard: (request, options) => {
    try {
      return createOkResponse(
        request,
        createClipboardResult(
          options.document,
          request.params.action,
          {
            ...(request.params.selector === undefined ? {} : { selector: request.params.selector }),
            ...(request.params.ref === undefined ? {} : { ref: request.params.ref }),
            ...(request.params.generationId === undefined
              ? {}
              : { generationId: request.params.generationId }),
            ...(request.params.text === undefined ? {} : { text: request.params.text }),
          },
          options.registry,
          options.now,
        ),
      );
    } catch (error) {
      return createContentErrorResponseForRequest(request, error);
    }
  },
  storage: (request, options) =>
    createOkResponse(
      request,
      createStorageResult(options.document, {
        area: request.params.area,
        action: request.params.action,
        ...(request.params.key === undefined ? {} : { key: request.params.key }),
        ...(request.params.value === undefined ? {} : { value: request.params.value }),
      }),
    ),
  console: (request) =>
    createOkResponse(request, createConsoleResult(request.params.action, request.protocolVersion)),
  errors: (request) =>
    createOkResponse(request, createErrorsResult(request.params.action, request.protocolVersion)),
  highlight: (request, options) => {
    try {
      const params = request.params;
      const element = resolveElement(
        options.document,
        {
          ...(params.selector === undefined ? {} : { selector: params.selector }),
          ...(params.ref === undefined ? {} : { ref: params.ref }),
          ...(params.generationId === undefined ? {} : { generationId: params.generationId }),
        },
        options.registry,
        options.now,
      );
      const view = options.document.defaultView;
      if (view !== null && element instanceof view.HTMLElement) {
        applyElementHighlight(element, {
          ...(params.durationMs === undefined ? {} : { durationMs: params.durationMs }),
          ...(options.highlightScheduler === undefined
            ? {}
            : { scheduler: options.highlightScheduler }),
        });
      }
      return createOkResponse(request, {
        ok: true,
        element: summarizeWaitElement(element),
      });
    } catch (error) {
      return createContentErrorResponseForRequest(request, error);
    }
  },
};

export function handleContentScriptRequest(
  request: RequestEnvelope,
  options: ContentScriptRequestContext,
): ResponseEnvelope | Promise<ResponseEnvelope> {
  installWindowLogCapture(options.document.defaultView);

  if (isDirectContentRequest(request)) {
    return dispatchCommandHandler(directContentHandlers, request, options);
  }

  if (isActionRequest(request)) {
    return handleActionCommand(request, options);
  }

  return createErrorResponseForRequest(request, {
    code: "UNSUPPORTED_CAPABILITY",
    message: `Unsupported content command: ${request.command}`,
  });
}

function handleActionCommand(
  request: RequestEnvelope<ActionKind>,
  options: ContentScriptRequestContext,
): ResponseEnvelope<ActionKind> {
  try {
    return createOkResponse(
      request,
      createActionResult({
        document: options.document,
        command: request.command,
        params: request.params,
        now: options.now ?? Date.now(),
        resolveRef: (ref, resolveOptions) =>
          options.registry.resolveRef(ref, {
            ...(resolveOptions.generationId === undefined
              ? {}
              : { generationId: resolveOptions.generationId }),
            now: resolveOptions.now,
          }),
        queryElement: (selector) => queryOptionalElement(options.document, selector),
        summarizeElement: summarizeWaitElement,
        isVisible,
        isDisabled,
        createError: (code, message) => new ContentSnapshotError(code, message),
      }),
    );
  } catch (error) {
    return createContentErrorResponseForRequest(request, error);
  }
}

function isActionRequest(request: RequestEnvelope): request is RequestEnvelope<ActionKind> {
  return isActionCommand(request.command);
}

function isDirectContentRequest(
  request: RequestEnvelope,
): request is RequestEnvelope<DirectContentCommand> {
  return Object.hasOwn(directContentHandlers, request.command);
}
