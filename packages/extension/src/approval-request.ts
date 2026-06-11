import { requestHostAccess } from "./approval-permissions.js";

interface ApprovalRequestState {
  readonly active: boolean;
  readonly close?: boolean;
}

interface ExtensionStatus {
  readonly approved: boolean;
  readonly lastError?: string;
}

const stateElement = document.querySelector<HTMLParagraphElement>("#request-state");
const errorElement = document.querySelector<HTMLParagraphElement>("#error");
const approveButton = document.querySelector<HTMLButtonElement>("#approve");
const denyButton = document.querySelector<HTMLButtonElement>("#deny");
const query = new URLSearchParams(window.location.search);
const manualApproval = query.get("manual") === "1";
const requestId = manualApproval ? undefined : (query.get("request") ?? undefined);

approveButton?.addEventListener("click", () => {
  approve().catch(renderError);
});

denyButton?.addEventListener("click", () => {
  deny().catch(renderError);
});

loadRequest().catch(renderError);

async function loadRequest(): Promise<void> {
  renderState(manualApproval ? { active: true } : await sendMessage<ApprovalRequestState>("firefox-cli:get-approval-request"));
}

async function approve(): Promise<void> {
  setBusy(true);
  const reloadAfterApproval = await requestHostAccess();
  const state = manualApproval
    ? statusToState(await sendMessage<ExtensionStatus>("firefox-cli:approve"))
    : await sendMessage<ApprovalRequestState>("firefox-cli:approve-request");
  renderState(state);
  await finishTerminalRequest(state, reloadAfterApproval);
}

async function deny(): Promise<void> {
  setBusy(true);
  const state = manualApproval ? { active: false } : await sendMessage<ApprovalRequestState>("firefox-cli:deny-approval-request");
  renderState(state);
  await finishTerminalRequest(state, false);
}

async function sendMessage<T>(type: string): Promise<T> {
  const response: T = await browser.runtime.sendMessage({ type, requestId });
  return response;
}

function renderState(state: ApprovalRequestState): void {
  setBusy(false);
  if (!state.active) {
    if (stateElement) {
      stateElement.textContent = "There is no active CLI approval request.";
    }
    if (approveButton) {
      approveButton.disabled = true;
    }
    if (denyButton) {
      denyButton.disabled = true;
    }
  }
}

async function finishTerminalRequest(state: ApprovalRequestState, reloadAfterApproval: boolean): Promise<void> {
  if (state.close !== true) {
    if (reloadAfterApproval) {
      browser.runtime.reload();
    }
    return;
  }
  const tab = await browser.tabs.getCurrent();
  if (reloadAfterApproval) {
    browser.runtime.reload();
  }
  if (tab?.id !== undefined) {
    await browser.tabs.remove(tab.id);
  } else {
    window.close();
  }
}

function statusToState(status: ExtensionStatus): ApprovalRequestState {
  if (status.lastError !== undefined) {
    renderError(status.lastError);
  }
  return { active: !status.approved };
}

function renderError(error: unknown): void {
  setBusy(false);
  if (errorElement) {
    errorElement.hidden = false;
    errorElement.textContent = error instanceof Error ? error.message : String(error);
  }
}

function setBusy(busy: boolean): void {
  if (approveButton) {
    approveButton.disabled = busy;
  }
  if (denyButton) {
    denyButton.disabled = busy;
  }
}
