import { getExtensionPermissionRequirements } from "@firefox-cli/protocol";

export async function requestHostAccess(): Promise<boolean> {
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
    throw new Error("Approve host access for all websites to enable browser control.");
  }
  return true;
}
