import type { RequestEnvelope } from "@firefox-cli/protocol";
import { createValidatedRequest } from "../protocol-validation.js";

export function buildOpenApprovalRequest(): RequestEnvelope {
  return createValidatedRequest("pair.requestApproval", {});
}
