import {
  createErrorResponse,
  createOkResponse,
  type ActionKind,
  type FindParams,
  type GetParams,
  type IsParams,
  type RefResolveParams,
  type RequestEnvelope,
  type ResponseEnvelope,
  type SnapshotParams,
  type WaitParams,
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
import { ContentSnapshotError, createContentErrorResponse } from "./errors.js";
import { createConsoleResult, createErrorsResult, installWindowLogCapture } from "./log-capture.js";
import { createSnapshotResult } from "./snapshot-render.js";

export function handleContentScriptRequest(
  request: RequestEnvelope,
  options: {
    readonly document: Document;
    readonly registry: ElementRefRegistry<Element>;
    readonly now?: number;
    readonly clock?: () => number;
    readonly sleep?: (durationMs: number) => Promise<void>;
  },
): ResponseEnvelope | Promise<ResponseEnvelope> {
  installWindowLogCapture(options.document.defaultView);

  if (request.command === "snapshot") {
    try {
      return createOkResponse(
        request,
        createSnapshotResult(
          options.document,
          request.params as SnapshotParams,
          options.registry,
          options.now,
        ),
      );
    } catch (error) {
      return createContentErrorResponse(request.id, error);
    }
  }

  if (request.command === "ref.resolve") {
    try {
      const params = request.params as RefResolveParams;
      const resolved = options.registry.resolveRef(params.ref, {
        ...(params.generationId === undefined ? {} : { generationId: params.generationId }),
        ...(options.now === undefined ? {} : { now: options.now }),
      });
      return createOkResponse(request, {
        element: summarizeElement(resolved.element, {
          ref: params.ref,
          generationId: resolved.generationId,
        }),
      });
    } catch (error) {
      return createContentErrorResponse(request.id, error);
    }
  }

  if (request.command === "get") {
    try {
      return createOkResponse(
        request,
        createGetResult(
          options.document,
          request.params as GetParams,
          options.registry,
          options.now,
        ),
      );
    } catch (error) {
      return createContentErrorResponse(request.id, error);
    }
  }

  if (request.command === "is") {
    try {
      return createOkResponse(
        request,
        createIsResult(options.document, request.params as IsParams, options.registry, options.now),
      );
    } catch (error) {
      return createContentErrorResponse(request.id, error);
    }
  }

  if (request.command === "wait") {
    return createWaitResult({
      document: options.document,
      params: request.params as WaitParams,
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
      .catch((error: unknown) => createContentErrorResponse(request.id, error));
  }

  if (request.command === "find") {
    try {
      return createOkResponse(
        request,
        createFindResult(options.document, request.params as FindParams),
      );
    } catch (error) {
      return createContentErrorResponse(request.id, error);
    }
  }

  if (request.command === "frame") {
    return createOkResponse(request, createFrameResult(options.document));
  }

  if (request.command === "dialog") {
    const command = request as RequestEnvelope<"dialog">;
    return createOkResponse(command, createDialogResult(command.params.action));
  }

  if (request.command === "clipboard") {
    const command = request as RequestEnvelope<"clipboard">;
    try {
      return createOkResponse(
        command,
        createClipboardResult(
          options.document,
          command.params.action,
          {
            ...(command.params.selector === undefined ? {} : { selector: command.params.selector }),
            ...(command.params.ref === undefined ? {} : { ref: command.params.ref }),
            ...(command.params.generationId === undefined
              ? {}
              : { generationId: command.params.generationId }),
            ...(command.params.text === undefined ? {} : { text: command.params.text }),
          },
          options.registry,
          options.now,
        ),
      );
    } catch (error) {
      return createContentErrorResponse(request.id, error);
    }
  }

  if (request.command === "storage") {
    const command = request as RequestEnvelope<"storage">;
    return createOkResponse(
      command,
      createStorageResult(options.document, {
        area: command.params.area,
        action: command.params.action,
        ...(command.params.key === undefined ? {} : { key: command.params.key }),
        ...(command.params.value === undefined ? {} : { value: command.params.value }),
      }),
    );
  }

  if (request.command === "console") {
    const command = request as RequestEnvelope<"console">;
    return createOkResponse(command, createConsoleResult(command.params.action));
  }

  if (request.command === "errors") {
    const command = request as RequestEnvelope<"errors">;
    return createOkResponse(command, createErrorsResult(command.params.action));
  }

  if (request.command === "highlight") {
    const command = request as RequestEnvelope<"highlight">;
    try {
      const params = command.params;
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
        element.dataset.firefoxCliHighlight = "true";
        element.style.outline = "3px solid #ff9500";
        element.style.outlineOffset = "2px";
      }
      return createOkResponse(command, {
        ok: true,
        element: summarizeWaitElement(element),
      });
    } catch (error) {
      return createContentErrorResponse(request.id, error);
    }
  }

  if (isActionCommand(request.command)) {
    const command = request as RequestEnvelope<ActionKind>;
    try {
      return createOkResponse(
        command,
        createActionResult({
          document: options.document,
          command: request.command,
          params: command.params,
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
      return createContentErrorResponse(request.id, error);
    }
  }

  return createErrorResponse(request.id, {
    code: "UNSUPPORTED_CAPABILITY",
    message: `Unsupported content command: ${request.command}`,
  });
}
