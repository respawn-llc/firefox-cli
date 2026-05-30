import { getExtensionPermissionRequirements } from "@firefox-cli/protocol";

type Status = {
  readonly connected: boolean;
  readonly approved: boolean;
  readonly lastError?: string;
  readonly diagnostics: string;
};

const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const approvalElement = document.querySelector<HTMLParagraphElement>("#approval");
const errorElement = document.querySelector<HTMLParagraphElement>("#error");
const diagnosticsElement = document.querySelector<HTMLTextAreaElement>("#diagnostics");
const approveButton = document.querySelector<HTMLButtonElement>("#approve");
const resetButton = document.querySelector<HTMLButtonElement>("#reset");
const diagnosticsButton = document.querySelector<HTMLButtonElement>("#copy-diagnostics");

async function loadStatus(): Promise<void> {
  const status = await sendMessage<Status>("firefox-cli:get-status");
  renderStatus(status);
}

function renderStatus(status: Status): void {
  if (statusElement) {
    statusElement.textContent = status.connected
      ? "Native host connected."
      : "Native host disconnected.";
  }

  if (approvalElement) {
    approvalElement.textContent = status.approved
      ? "Approved for CLI control."
      : "Not approved. Approve before running CLI commands.";
  }

  if (errorElement) {
    errorElement.hidden = status.lastError === undefined;
    errorElement.textContent = status.lastError ?? "";
  }

  if (diagnosticsElement) {
    diagnosticsElement.value = status.diagnostics;
  }
}

async function sendMessage<T>(type: string): Promise<T> {
  return (await browser.runtime.sendMessage({ type })) as T;
}

approveButton?.addEventListener("click", () => {
  approve().catch(renderError);
});

resetButton?.addEventListener("click", () => {
  sendMessage<Status>("firefox-cli:reset").then(renderStatus).catch(renderError);
});

diagnosticsButton?.addEventListener("click", () => {
  if (diagnosticsElement) {
    diagnosticsElement.select();
    document.execCommand("copy");
  }
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

async function requestHostAccess(): Promise<boolean> {
  const permissions = browser.permissions;
  if (permissions === undefined) {
    throw new Error("Firefox permissions API is unavailable.");
  }

  const required = { origins: getExtensionPermissionRequirements().popupApprovalOrigins };
  const captureApiRequiresReload = typeof browser.tabs.captureVisibleTab !== "function";
  if (await permissions.contains(required)) {
    return captureApiRequiresReload;
  }

  if (!(await permissions.request(required))) {
    throw new Error("Approve host access for all websites to use firefox-cli commands.");
  }
  return true;
}
