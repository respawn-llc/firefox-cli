import { requestHostAccess } from "./approval-permissions.js";

interface Status {
  readonly connected: boolean;
  readonly approved: boolean;
  readonly lastError?: string;
}

const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const approvalElement = document.querySelector<HTMLParagraphElement>("#approval");
const errorElement = document.querySelector<HTMLParagraphElement>("#error");
const approveButton = document.querySelector<HTMLButtonElement>("#approve");
const resetButton = document.querySelector<HTMLButtonElement>("#reset");

async function loadStatus(): Promise<void> {
  const status = await sendMessage<Status>("firefox-cli:get-status");
  renderStatus(status);
}

function renderStatus(status: Status): void {
  if (statusElement) {
    statusElement.textContent = status.connected ? "Native host connected" : "Native host disconnected";
    statusElement.dataset.state = status.connected ? "connected" : "disconnected";
  }

  if (approvalElement) {
    approvalElement.textContent = status.approved ? "Browser control approved" : "Approval required";
    approvalElement.dataset.state = status.approved ? "approved" : "pending";
  }

  if (errorElement) {
    errorElement.hidden = status.lastError === undefined;
    errorElement.textContent = status.lastError ?? "";
  }

  if (approveButton) {
    approveButton.hidden = status.approved;
  }
}

async function sendMessage<T>(type: string): Promise<T> {
  const response: T = await browser.runtime.sendMessage({ type });
  return response;
}

approveButton?.addEventListener("click", () => {
  approve().catch(renderError);
});

resetButton?.addEventListener("click", () => {
  sendMessage<Status>("firefox-cli:reset").then(renderStatus).catch(renderError);
});

loadStatus().catch(renderError);

function renderError(error: unknown): void {
  if (errorElement) {
    errorElement.hidden = false;
    errorElement.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function approve(): Promise<void> {
  const reloadAfterApproval = await requestHostAccess();
  const status = await sendMessage<Status>("firefox-cli:approve");
  renderStatus(status);
  if (reloadAfterApproval) {
    browser.runtime.reload();
  }
}
