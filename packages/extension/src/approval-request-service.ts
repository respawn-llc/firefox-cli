import { createErrorResponseForRequest, createOkResponse, type ProtocolError, type RequestEnvelope, type ResponseEnvelope } from "@firefox-cli/protocol";
import type { BackgroundBrowserAdapter } from "./browser-commands.js";

export const USER_DENIED_APPROVAL_MESSAGE =
  "User explicitly denied your request. Do not try to circumvent this decision by any means; do not try to re-request approval. If your desired usage was optional, skip it and use other tools. If denial materially affects your work (you need the CLI legitimately), ask the user how they'd like to proceed.";

const RATE_LIMIT_MESSAGE_PREFIX =
  "Request rate-limited: to prevent disturbing the user, approval auto-denied. If the user wants you to request approval again, ask them to manually open the extension popup and approve; otherwise wait ";
const RATE_LIMIT_SECONDS = [3, 27, 81] as const;
const APPROVAL_PAGE = "approval-request.html";

interface PendingApprovalRequest {
  readonly request: RequestEnvelope<"pair.requestApproval">;
  readonly resolve: (response: ResponseEnvelope<"pair.requestApproval">) => void;
  readonly requestId: string;
  status: "pending" | "approving";
  url: string;
}

export interface ApprovalRequestViewState {
  readonly active: boolean;
  readonly close?: boolean;
  readonly url?: string;
}

export class ApprovalRequestService {
  readonly #adapter: BackgroundBrowserAdapter;
  readonly #nowMs: () => number;
  #pending: PendingApprovalRequest | undefined;
  #nextAllowedAtMs = 0;
  #rateLimitIndex = 0;

  constructor(options: { readonly adapter: BackgroundBrowserAdapter; readonly nowMs?: () => number }) {
    this.#adapter = options.adapter;
    this.#nowMs = options.nowMs ?? Date.now;
  }

  async requestApproval(request: RequestEnvelope<"pair.requestApproval">, approved: boolean): Promise<ResponseEnvelope<"pair.requestApproval">> {
    if (approved) {
      return createErrorResponseForRequest(request, {
        code: "ACTION_REJECTED",
        message: await this.#alreadyApprovedMessage(),
      });
    }

    const rateLimited = this.#rateLimitError();
    if (rateLimited !== undefined) {
      return createErrorResponseForRequest(request, rateLimited);
    }

    if (this.#pending !== undefined) {
      return createErrorResponseForRequest(request, {
        code: "ACTION_REJECTED",
        message: "An approval request is already open in Firefox.",
      });
    }

    return new Promise<ResponseEnvelope<"pair.requestApproval">>((resolve) => {
      const pagePath = `${APPROVAL_PAGE}?request=${encodeURIComponent(request.id)}`;
      this.#pending = { request, resolve, requestId: request.id, status: "pending", url: pagePath };
      this.#recordApprovalRequest();
      this.#openApprovalPage(pagePath).catch((error: unknown) => {
        this.#rejectRequest(request.id, {
          code: "NATIVE_HOST_UNAVAILABLE",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  async openApprovalPage(request: RequestEnvelope<"pair.openApproval">, approved: boolean): Promise<ResponseEnvelope<"pair.openApproval">> {
    if (approved) {
      return createErrorResponseForRequest(request, {
        code: "ACTION_REJECTED",
        message: await this.#alreadyApprovedMessage(),
      });
    }

    const rateLimited = this.#rateLimitError();
    if (rateLimited !== undefined) {
      return createErrorResponseForRequest(request, rateLimited);
    }
    if (this.#pending !== undefined) {
      return createErrorResponseForRequest(request, {
        code: "ACTION_REJECTED",
        message: "An approval request is already open in Firefox.",
      });
    }

    this.#recordApprovalRequest();
    await this.#showApprovalNotification();
    try {
      return createOkResponse(request, { ok: true, url: await this.#adapter.openExtensionPage(`${APPROVAL_PAGE}?manual=1`) });
    } catch (error: unknown) {
      return createErrorResponseForRequest(request, {
        code: "NATIVE_HOST_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getViewState(requestId: string | undefined): ApprovalRequestViewState {
    if (!this.#requestMatchesPending(requestId)) {
      return { active: false };
    }
    return this.#pending === undefined ? { active: false } : { active: true, url: this.#pending.url };
  }

  async approve(requestId: string | undefined, approvePairing: () => Promise<boolean>): Promise<ApprovalRequestViewState> {
    if (!this.#requestMatchesPending(requestId)) {
      return { active: false };
    }
    const pending = this.#pending;
    if (pending?.status !== "pending") {
      return { active: false };
    }
    pending.status = "approving";
    let approved: boolean;
    try {
      approved = await approvePairing();
    } catch (error) {
      if (this.#pending === pending) {
        this.#pending = undefined;
        pending.resolve(
          createErrorResponseForRequest(pending.request, {
            code: "NATIVE_HOST_UNAVAILABLE",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        return { active: false, close: true };
      }
      return { active: false };
    }
    if (approved) {
      this.#pending = undefined;
      this.#rateLimitIndex = 0;
      this.#nextAllowedAtMs = 0;
      pending.resolve(createOkResponse(pending.request, { ok: true, url: pending.url }));
      return { active: false, close: true };
    } else if (this.#pending === pending) {
      pending.status = "pending";
    }
    return this.getViewState(requestId);
  }

  deny(requestId: string | undefined): ApprovalRequestViewState {
    if (!this.#requestMatchesPending(requestId)) {
      return { active: false };
    }
    const pending = this.#pending;
    if (pending?.status === "pending") {
      this.#pending = undefined;
      pending.resolve(
        createErrorResponseForRequest(pending.request, {
          code: "ACTION_REJECTED",
          message: USER_DENIED_APPROVAL_MESSAGE,
        }),
      );
      return { active: false, close: true };
    }
    return this.getViewState(requestId);
  }

  acceptExistingApproval(): void {
    const pending = this.#pending;
    if (pending !== undefined) {
      this.#pending = undefined;
      this.#rateLimitIndex = 0;
      this.#nextAllowedAtMs = 0;
      pending.resolve(createOkResponse(pending.request, { ok: true, url: pending.url }));
    }
  }

  rejectPending(error: ProtocolError): void {
    const pending = this.#pending;
    if (pending !== undefined) {
      this.#pending = undefined;
      pending.resolve(createErrorResponseForRequest(pending.request, error));
    }
  }

  async #alreadyApprovedMessage(): Promise<string> {
    const instance = await this.#adapter.getExtensionInstance();
    const windowSuffix = instance.focusedWindowId === undefined ? "" : `, focused window id ${String(instance.focusedWindowId)}`;
    return `firefox-cli is already approved for Firefox extension instance ${instance.extensionUrl}${windowSuffix}.`;
  }

  #rateLimitError(): ProtocolError | undefined {
    const remainingMs = this.#nextAllowedAtMs - this.#nowMs();
    if (remainingMs <= 0) {
      return undefined;
    }
    const retryAfterSeconds = this.#rateLimitSeconds();
    this.#rateLimitIndex += 1;
    this.#nextAllowedAtMs = this.#nowMs() + retryAfterSeconds * 1000;
    return {
      code: "ACTION_REJECTED",
      message: `${RATE_LIMIT_MESSAGE_PREFIX}${formatSeconds(retryAfterSeconds)} before trying again.`,
      details: { remainingSeconds: retryAfterSeconds },
    };
  }

  #recordApprovalRequest(): void {
    this.#nextAllowedAtMs = this.#nowMs() + this.#rateLimitSeconds() * 1000;
  }

  #requestMatchesPending(requestId: string | undefined): boolean {
    return this.#pending !== undefined && this.#pending.status === "pending" && requestId === this.#pending.requestId;
  }

  async #openApprovalPage(pagePath: string): Promise<void> {
    await this.#showApprovalNotification();
    const url = await this.#adapter.openExtensionPage(pagePath);
    if (this.#pending !== undefined && this.#pending.url === pagePath) {
      this.#pending.url = url;
    }
  }

  #rejectRequest(requestId: string, error: ProtocolError): void {
    const pending = this.#pending;
    if (pending?.requestId === requestId) {
      this.#pending = undefined;
      pending.resolve(createErrorResponseForRequest(pending.request, error));
    }
  }

  async #showApprovalNotification(): Promise<void> {
    try {
      await this.#adapter.showNotification({
        id: "firefox-cli-approval",
        title: "firefox-cli approval requested",
        message: "A CLI client is asking for Firefox control approval right now.",
      });
    } catch {
      // The approval page is the authoritative prompt. Notification failures must not block it.
    }
  }

  #rateLimitSeconds(): number {
    const configured = RATE_LIMIT_SECONDS[this.#rateLimitIndex];
    if (configured !== undefined) {
      return configured;
    }
    const lastConfigured = RATE_LIMIT_SECONDS[2];
    return lastConfigured * 3 ** (this.#rateLimitIndex - RATE_LIMIT_SECONDS.length + 1);
  }
}

function formatSeconds(seconds: number): string {
  return seconds === 1 ? "1 second" : `${String(seconds)} seconds`;
}
