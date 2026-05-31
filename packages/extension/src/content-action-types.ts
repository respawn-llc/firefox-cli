import type { ActionKind, CommandParams, WaitElementSummary } from "@firefox-cli/protocol";
import type { ContentElementResolver } from "./content-snapshot/element-resolver.js";

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

export interface ElementResolution {
  readonly element: Element;
  readonly ref?: string;
  readonly generationId?: string;
}

export type EditableValueElement = HTMLElement & {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  setSelectionRange?(start: number, end: number): void;
};

export interface ContentActionServices {
  readonly document: Document;
  readonly now: number;
  readonly elementResolver?: ContentElementResolver;
  readonly resolveRef: (
    ref: string,
    options: { readonly generationId?: string; readonly now: number },
  ) => { readonly element: Element; readonly generationId: string };
  readonly queryElement: (selector: string) => Element | null;
  readonly summarizeElement: (element: Element, options?: { readonly ref: string; readonly generationId: string }) => WaitElementSummary;
  readonly isVisible: (element: Element) => boolean;
  readonly isDisabled: (element: Element) => boolean;
  readonly createError: (code: ActionErrorCode, message: string) => Error;
}

export type ActionOptions<C extends ActionKind = ActionKind> = ContentActionServices & {
  readonly command: C;
  readonly params: CommandParams<C>;
};

export interface ContentActionResult {
  readonly action: ActionKind;
  readonly ok: true;
  readonly element?: WaitElementSummary;
  readonly valueLength?: number;
  readonly selectedValues?: string[];
  readonly scroll?: {
    readonly x: number;
    readonly y: number;
  };
}
