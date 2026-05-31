import { PROTOCOL_VERSION, isActionCommand, type ActionKind, type RequestEnvelope } from "@firefox-cli/protocol";

export function fakeContentResponse(request: RequestEnvelope): unknown {
  const factory = contentResponseFactories.get(request.command) ?? defaultContentResponse;
  return factory(request);
}

export function actionParamsFor(command: string): Record<string, unknown> {
  return actionParamFactories.get(command)?.() ?? { selector: "button" };
}

const actionParamFactoryEntries: readonly (readonly [string, () => Record<string, unknown>])[] = [
  ["fill", () => ({ selector: "input", text: "hello" })],
  ["type", () => ({ selector: "input", text: "hello" })],
  ["keyboard.type", () => ({ text: "hello" })],
  ["keyboard.inserttext", () => ({ text: "hello" })],
  ["press", () => ({ key: "Enter" })],
  ["select", () => ({ selector: "select", values: ["pro"] })],
  ["drag", () => ({ sourceSelector: "#source", targetSelector: "#target" })],
  [
    "upload",
    () => ({
      selector: "input[type=file]",
      files: [{ name: "fixture.txt", dataBase64: "aGVsbG8=" }],
    }),
  ],
  ["mouse", () => ({ action: "wheel", selector: "#feed", deltaY: 120 })],
  ["keydown", () => ({ key: "A", selector: "input" })],
  ["keyup", () => ({ key: "A", selector: "input" })],
  ["scroll", () => ({ direction: "down" })],
  ["swipe", () => ({ direction: "down" })],
];
const actionParamFactories: ReadonlyMap<string, () => Record<string, unknown>> = new Map(actionParamFactoryEntries);

type ContentResponseFactory = (request: RequestEnvelope) => unknown;

const contentResponseFactories: ReadonlyMap<string, ContentResponseFactory> = new Map([
  [
    "ref.resolve",
    (request) =>
      contentOkResponse(request, {
        element: {
          ref: "@e1",
          generationId: "g1",
          tagName: "button",
          role: "button",
          name: "Submit",
          text: "Submit",
          visible: true,
        },
      }),
  ],
  [
    "get",
    (request) =>
      contentOkResponse(request, {
        kind: "text",
        value: "Submit",
        truncated: false,
      }),
  ],
  ["is", (request) => contentOkResponse(request, { kind: "visible", value: true })],
  [
    "wait",
    (request) =>
      contentOkResponse(request, {
        kind: "text",
        matched: true,
        elapsedMs: 5,
        value: "Ready",
      }),
  ],
  [
    "find",
    (request) =>
      contentOkResponse(request, {
        elements: [
          {
            tagName: "button",
            role: "button",
            visible: true,
            name: "Submit",
          },
        ],
      }),
  ],
  ["frame", (request) => contentOkResponse(request, { frames: [{ index: 0, title: "Frame", url: "https://frame.test/" }] })],
  ["dialog", dialogResponse],
  ["clipboard", clipboardResponse],
  ["storage", storageResponse],
  ["console", consoleResponse],
  ["errors", errorsResponse],
  [
    "highlight",
    (request) =>
      contentOkResponse(request, {
        ok: true,
        element: {
          tagName: "button",
          role: "button",
          visible: true,
          name: "Submit",
        },
      }),
  ],
]);

function defaultContentResponse(request: RequestEnvelope): unknown {
  if (isActionCommand(request.command)) {
    return fakeActionResponse(request.command, request.id);
  }
  return contentOkResponse(request, {
    generationId: "g1",
    text: '@e1 button "Submit"',
    refs: 1,
    truncated: false,
    frames: [],
  });
}

function dialogResponse(request: RequestEnvelope): unknown {
  return contentOkResponse(request, {
    action: paramsAction(request.params),
    handled: false,
  });
}

function clipboardResponse(request: RequestEnvelope): unknown {
  const action = paramsAction(request.params);
  return contentOkResponse(request, {
    action,
    ok: true,
    ...(action === "copy" ? { text: "Copied" } : {}),
  });
}

function storageResponse(request: RequestEnvelope): unknown {
  return contentOkResponse(request, {
    area: paramsField(request.params, "area"),
    action: paramsAction(request.params),
    ok: true,
  });
}

function consoleResponse(request: RequestEnvelope): unknown {
  const action = paramsAction(request.params);
  return contentOkResponse(request, {
    action,
    ok: true,
    ...(action === "list" ? { entries: [], truncated: true, droppedEntries: 2 } : {}),
  });
}

function errorsResponse(request: RequestEnvelope): unknown {
  const action = paramsAction(request.params);
  return contentOkResponse(request, {
    action,
    ok: true,
    ...(action === "list" ? { errors: [], truncated: true, droppedEntries: 2 } : {}),
  });
}

function fakeActionResponse(command: ActionKind, id: string): unknown {
  const element = {
    tagName: "button",
    role: "button",
    visible: true,
    name: "Submit",
  };
  const base = { action: command, ok: true, element };
  return {
    protocolVersion: PROTOCOL_VERSION,
    id,
    ok: true,
    result:
      command === "scroll" || command === "swipe"
        ? { action: command, ok: true, scroll: { x: 0, y: 10 } }
        : command === "select"
          ? { ...base, selectedValues: ["Submit"] }
          : command === "fill" || command === "type" || command === "keyboard.type" || command === "keyboard.inserttext"
            ? { ...base, valueLength: 6 }
            : base,
  };
}

function contentOkResponse(request: RequestEnvelope, result: unknown): unknown {
  return {
    protocolVersion: request.protocolVersion,
    id: request.id,
    ok: true,
    result,
  };
}

function paramsAction(params: RequestEnvelope["params"]): unknown {
  return paramsField(params, "action");
}

function paramsField(params: RequestEnvelope["params"], field: string): unknown {
  return Object.entries(params).find(([key]) => key === field)?.[1];
}
