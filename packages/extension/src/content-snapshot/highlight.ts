const HIGHLIGHT_ATTRIBUTE = "data-firefox-cli-highlight";
const HIGHLIGHT_ATTRIBUTE_VALUE = "true";
const HIGHLIGHT_OUTLINE = "3px solid #ff9500";
const HIGHLIGHT_OUTLINE_OFFSET = "2px";

export interface HighlightScheduler {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (timer: unknown) => void;
}

interface HighlightField {
  baseline: string | null;
  readonly applied: string;
  ownedValue?: string | null;
  readonly read: (element: HTMLElement) => string | null;
  readonly write: (element: HTMLElement, value: string | null) => void;
}

interface HighlightRecord {
  readonly fields: readonly HighlightField[];
  timer?: unknown;
  clearTimer?: (timer: unknown) => void;
}

interface DocumentHighlightState {
  readonly records: WeakMap<HTMLElement, HighlightRecord>;
  currentElement?: HTMLElement;
}

const documentHighlightStates = new WeakMap<Document, DocumentHighlightState>();

export function applyElementHighlight(
  element: HTMLElement,
  options: {
    readonly durationMs?: number;
    readonly scheduler?: HighlightScheduler;
  },
): void {
  const state = getDocumentState(element.ownerDocument);
  const scheduler = options.scheduler ?? getDefaultScheduler(element);
  restorePreviousElementHighlight(state, element);

  const record = state.records.get(element) ?? createHighlightRecord(element);

  refreshPageOwnedBaselines(element, record);
  clearRecordTimer(record);
  applyRecord(element, record);
  state.records.set(element, record);
  state.currentElement = element;

  if (options.durationMs !== undefined) {
    record.timer = scheduler.setTimeout(() => {
      restoreRecord(element, record);
      state.records.delete(element);
      if (state.currentElement === element) {
        delete state.currentElement;
      }
    }, options.durationMs);
    record.clearTimer = scheduler.clearTimeout;
  }
}

function getDocumentState(document: Document): DocumentHighlightState {
  const existing = documentHighlightStates.get(document);
  if (existing !== undefined) {
    return existing;
  }
  const created = { records: new WeakMap<HTMLElement, HighlightRecord>() };
  documentHighlightStates.set(document, created);
  return created;
}

function restorePreviousElementHighlight(state: DocumentHighlightState, nextElement: HTMLElement): void {
  const previousElement = state.currentElement;
  if (previousElement === undefined || previousElement === nextElement) {
    return;
  }

  const previousRecord = state.records.get(previousElement);
  if (previousRecord !== undefined) {
    clearRecordTimer(previousRecord);
    restoreRecord(previousElement, previousRecord);
    state.records.delete(previousElement);
  }
  delete state.currentElement;
}

function createHighlightRecord(element: HTMLElement): HighlightRecord {
  return {
    fields: [
      {
        baseline: element.getAttribute(HIGHLIGHT_ATTRIBUTE),
        applied: HIGHLIGHT_ATTRIBUTE_VALUE,
        read: (target) => target.getAttribute(HIGHLIGHT_ATTRIBUTE),
        write: (target, value) => {
          if (value === null) {
            target.removeAttribute(HIGHLIGHT_ATTRIBUTE);
          } else {
            target.setAttribute(HIGHLIGHT_ATTRIBUTE, value);
          }
        },
      },
      {
        baseline: element.style.outline,
        applied: HIGHLIGHT_OUTLINE,
        read: (target) => target.style.outline,
        write: (target, value) => {
          target.style.outline = value ?? "";
        },
      },
      {
        baseline: element.style.outlineOffset,
        applied: HIGHLIGHT_OUTLINE_OFFSET,
        read: (target) => target.style.outlineOffset,
        write: (target, value) => {
          target.style.outlineOffset = value ?? "";
        },
      },
    ],
  };
}

function refreshPageOwnedBaselines(element: HTMLElement, record: HighlightRecord): void {
  for (const field of record.fields) {
    const current = field.read(element);
    if (current !== field.ownedValue) {
      field.baseline = current;
    }
  }
}

function applyRecord(element: HTMLElement, record: HighlightRecord): void {
  for (const field of record.fields) {
    field.write(element, field.applied);
    field.ownedValue = field.read(element);
  }
}

function restoreRecord(element: HTMLElement, record: HighlightRecord): void {
  delete record.timer;
  delete record.clearTimer;
  for (const field of record.fields) {
    if (field.read(element) === field.ownedValue) {
      field.write(element, field.baseline);
    }
    delete field.ownedValue;
  }
}

function clearRecordTimer(record: HighlightRecord): void {
  if ("timer" in record) {
    record.clearTimer?.(record.timer);
    delete record.timer;
    delete record.clearTimer;
  }
}

function getDefaultScheduler(element: HTMLElement): HighlightScheduler {
  const view = element.ownerDocument.defaultView;
  if (view !== null) {
    return {
      setTimeout: (callback, delayMs) => view.setTimeout(callback, delayMs),
      clearTimeout: (timer) => {
        if (typeof timer === "number") {
          view.clearTimeout(timer);
        }
      },
    };
  }

  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (timer) => {
      if (isTimeoutHandle(timer)) {
        globalThis.clearTimeout(timer);
      }
    },
  };
}

function isTimeoutHandle(timer: unknown): timer is ReturnType<typeof setTimeout> {
  return typeof timer === "number" || (typeof timer === "object" && timer !== null);
}
