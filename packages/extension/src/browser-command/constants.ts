import { timeoutPolicies } from "@firefox-cli/protocol";

export const DEFAULT_WAIT_TIMEOUT_MS = timeoutPolicies.browserWait.timeoutMs;
export const DEFAULT_WAIT_INTERVAL_MS = timeoutPolicies.browserWait.intervalMs;
export const DEFAULT_EVAL_TIMEOUT_MS = timeoutPolicies.browserEval.timeoutMs;
export const DEFAULT_SCREENSHOT_TIMEOUT_MS = timeoutPolicies.browserScreenshot.timeoutMs;
