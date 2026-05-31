import {
  createRequest,
  safeParseStrictCommandParams,
  type CommandParams,
  type CommandId,
  type RequestEnvelope,
} from "@firefox-cli/protocol";
import { CliUsageError } from "./types.js";

export function createValidatedRequest<C extends CommandId>(command: C, params: unknown): RequestEnvelope<C> {
  return createRequest(command, validateCommandParams(command, params));
}

export function validateProtocolRequest<C extends CommandId>(
  request: RequestEnvelope<C>,
): RequestEnvelope<C> {
  return {
    ...request,
    params: validateCommandParams(request.command, request.params),
  };
}

function validateCommandParams<C extends CommandId>(command: C, params: unknown): CommandParams<C> {
  const parsed = safeParseStrictCommandParams(command, params);
  if (parsed.success) {
    return parsed.data;
  }

  const firstIssue = parsed.error.issues[0];
  const path = firstIssue?.path.length === 0 ? "" : ` at ${firstIssue?.path.join(".")}`;
  throw new CliUsageError(
    firstIssue === undefined
      ? `Invalid ${command} request.`
      : `Invalid ${command} request${path}: ${firstIssue.message}`,
  );
}
