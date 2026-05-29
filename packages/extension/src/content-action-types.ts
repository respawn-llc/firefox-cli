import type {
  ActionKind,
  DragParams,
  ElementActionParams,
  KeyboardTextActionParams,
  KeyEventParams,
  MouseParams,
  PressParams,
  ScrollParams,
  SelectParams,
  TextActionParams,
  UploadParams,
  WaitElementSummary,
} from "@firefox-cli/protocol";

export type ActionErrorCode =
  | "SELECTOR_NOT_FOUND"
  | "ELEMENT_NOT_VISIBLE"
  | "ELEMENT_DISABLED"
  | "NOT_EDITABLE"
  | "ACTION_REJECTED"
  | "OUTPUT_TOO_LARGE"
  | "NO_FOCUSED_ELEMENT"
  | "INVALID_KEY"
  | "OPTION_NOT_FOUND";

export type ElementResolution = {
  readonly element: Element;
  readonly ref?: string;
  readonly generationId?: string;
};

export type EditableValueElement = HTMLElement & {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  setSelectionRange?(start: number, end: number): void;
};

export type ActionOptions = {
  readonly document: Document;
  readonly command: ActionKind;
  readonly params:
    | ElementActionParams
    | TextActionParams
    | KeyboardTextActionParams
    | PressParams
    | SelectParams
    | ScrollParams
    | DragParams
    | UploadParams
    | MouseParams
    | KeyEventParams;
  readonly now: number;
  readonly resolveRef: (
    ref: string,
    options: { readonly generationId?: string; readonly now: number },
  ) => { readonly element: Element; readonly generationId: string };
  readonly queryElement: (selector: string) => Element | null;
  readonly summarizeElement: (
    element: Element,
    options?: { readonly ref: string; readonly generationId: string },
  ) => WaitElementSummary;
  readonly isVisible: (element: Element) => boolean;
  readonly isDisabled: (element: Element) => boolean;
  readonly createError: (code: ActionErrorCode, message: string) => Error;
};

export type ContentActionResult = {
  readonly action: ActionKind;
  readonly ok: true;
  readonly element?: WaitElementSummary;
  readonly valueLength?: number;
  readonly selectedValues?: string[];
  readonly scroll?: {
    readonly x: number;
    readonly y: number;
  };
};
