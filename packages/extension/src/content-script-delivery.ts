import type { RequestEnvelope } from "@firefox-cli/protocol";

export type ContentScriptDeliveryCause =
  | "not-loaded"
  | "restricted-page"
  | "permission-denied"
  | "tab-unavailable"
  | "tab-discarded"
  | "unknown";

export type ContentScriptDeliveryStage = "send" | "inject" | "retry";

export class ContentScriptDeliveryError extends Error {
  readonly deliveryCause: ContentScriptDeliveryCause;
  readonly stage: ContentScriptDeliveryStage;
  readonly originalMessage: string;
  readonly retried: boolean;

  constructor(input: {
    readonly cause: ContentScriptDeliveryCause;
    readonly stage: ContentScriptDeliveryStage;
    readonly originalMessage: string;
    readonly retried: boolean;
  }) {
    super(createDeliveryErrorMessage(input));
    this.name = "ContentScriptDeliveryError";
    this.deliveryCause = input.cause;
    this.stage = input.stage;
    this.originalMessage = input.originalMessage;
    this.retried = input.retried;
  }
}

export type ContentScriptDeliveryDependencies = {
  readonly sendMessage: (tabId: number, request: RequestEnvelope) => Promise<unknown>;
  readonly injectContentScript: (tabId: number) => Promise<void>;
  readonly markInjected?: (tabId: number) => void;
};

export type ContentScriptInjectionState = {
  markInjected(tabId: number): void;
  forgetTab(tabId: number): void;
  hasInjected(tabId: number): boolean;
};

export function createContentScriptInjectionState(): ContentScriptInjectionState {
  const injectedTabs = new Set<number>();
  return {
    markInjected: (tabId) => {
      injectedTabs.add(tabId);
    },
    forgetTab: (tabId) => {
      injectedTabs.delete(tabId);
    },
    hasInjected: (tabId) => injectedTabs.has(tabId),
  };
}

export async function deliverContentScriptRequest(
  dependencies: ContentScriptDeliveryDependencies,
  tabId: number,
  request: RequestEnvelope,
): Promise<unknown> {
  try {
    const response = await dependencies.sendMessage(tabId, request);
    dependencies.markInjected?.(tabId);
    return response;
  } catch (error) {
    const firstFailure = classifyContentScriptDeliveryError(error);
    if (firstFailure !== "not-loaded") {
      throw new ContentScriptDeliveryError({
        cause: firstFailure,
        stage: "send",
        originalMessage: errorMessage(error),
        retried: false,
      });
    }
  }

  try {
    await dependencies.injectContentScript(tabId);
    dependencies.markInjected?.(tabId);
  } catch (error) {
    throw new ContentScriptDeliveryError({
      cause: classifyContentScriptDeliveryError(error),
      stage: "inject",
      originalMessage: errorMessage(error),
      retried: true,
    });
  }

  try {
    const response = await dependencies.sendMessage(tabId, request);
    dependencies.markInjected?.(tabId);
    return response;
  } catch (error) {
    throw new ContentScriptDeliveryError({
      cause: classifyContentScriptDeliveryError(error),
      stage: "retry",
      originalMessage: errorMessage(error),
      retried: true,
    });
  }
}

export function classifyContentScriptDeliveryError(error: unknown): ContentScriptDeliveryCause {
  const message = errorMessage(error).toLowerCase();
  if (
    includesAny(message, [
      "receiving end does not exist",
      "could not establish connection",
      "content script missing",
      "no matching message handler",
      "no receiver",
    ])
  ) {
    return "not-loaded";
  }
  if (
    includesAny(message, ["restricted firefox page", "restricted page", "privileged page", "cannot access"])
  ) {
    return "restricted-page";
  }
  if (includesAny(message, ["missing host permission", "permission denied", "not allowed"])) {
    return "permission-denied";
  }
  if (includesAny(message, ["discarded", "unloaded", "crashed"])) {
    return "tab-discarded";
  }
  if (includesAny(message, ["invalid tab id", "no tab with id", "tab not found"])) {
    return "tab-unavailable";
  }
  return "unknown";
}

function createDeliveryErrorMessage(input: {
  readonly cause: ContentScriptDeliveryCause;
  readonly stage: ContentScriptDeliveryStage;
  readonly originalMessage: string;
}): string {
  return `Content script delivery failed during ${input.stage} (${input.cause}): ${input.originalMessage}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function includesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
