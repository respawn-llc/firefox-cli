import {
  commandSchemas,
  createRequest,
  type CommandId,
  type RequestEnvelope,
} from "@firefox-cli/protocol";
import { CliUsageError } from "./types.js";

export function createValidatedRequest<C extends CommandId>(
  command: C,
  params: unknown,
): RequestEnvelope<C> {
  return createRequest(command, validateCommandParams(command, params) as never);
}

export function validateProtocolRequest<C extends CommandId>(
  request: RequestEnvelope<C>,
): RequestEnvelope<C> {
  return {
    ...request,
    params: validateCommandParams(request.command, request.params) as RequestEnvelope<C>["params"],
  };
}

function validateCommandParams<C extends CommandId>(
  command: C,
  params: unknown,
): RequestEnvelope<C>["params"] {
  const parsed = commandSchemas[command].params.safeParse(params);
  if (parsed.success) {
    return parsed.data as RequestEnvelope<C>["params"];
  }

  const firstIssue = parsed.error.issues[0];
  const path = firstIssue?.path.length === 0 ? "" : ` at ${firstIssue?.path.join(".")}`;
  throw new CliUsageError(
    firstIssue === undefined
      ? `Invalid ${command} request.`
      : `Invalid ${command} request${path}: ${firstIssue.message}`,
  );
}
