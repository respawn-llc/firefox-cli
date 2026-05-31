import type { ProtocolError } from "./core.js";
import type { CommandParams, CommandResult, RequestEnvelope, ResponseEnvelope } from "./envelopes.js";
import type { CommandId } from "./registry/index.js";

export function createValidatedRequestEnvelope<C extends CommandId>(
  command: C,
  params: CommandParams<C>,
  id: string,
  protocolVersion: number,
): RequestEnvelope<C>;
export function createValidatedRequestEnvelope(command: CommandId, params: CommandParams<CommandId>, id: string, protocolVersion: number): unknown {
  return { protocolVersion, id, command, params };
}

export function createValidatedOkResponseEnvelope<C extends CommandId>(result: CommandResult<C>, id: string, protocolVersion: number): ResponseEnvelope<C>;
export function createValidatedOkResponseEnvelope(result: CommandResult<CommandId>, id: string, protocolVersion: number): unknown {
  return { protocolVersion, id, ok: true, result };
}

export function createValidatedOkResponseEnvelopeForRequest<C extends CommandId>(
  request: RequestEnvelope<C>,
  result: CommandResult<C>,
  protocolVersion: number,
): ResponseEnvelope<C>;
export function createValidatedOkResponseEnvelopeForRequest(request: RequestEnvelope, result: CommandResult<CommandId>, protocolVersion: number): unknown {
  return { protocolVersion, id: request.id, ok: true, result };
}

export function createValidatedResponseEnvelopeWithVersion<C extends CommandId>(
  request: RequestEnvelope<C>,
  response: ResponseEnvelope<C>,
  protocolVersion: number,
): ResponseEnvelope<C>;
export function createValidatedResponseEnvelopeWithVersion(request: RequestEnvelope, response: ResponseEnvelope, protocolVersion: number): unknown {
  return response.ok
    ? { protocolVersion, id: request.id, ok: true, result: response.result }
    : createValidatedErrorResponseEnvelope(request.id, response.error, protocolVersion);
}

export function requestCommand<C extends CommandId>(request: RequestEnvelope<C>): C;
export function requestCommand(request: RequestEnvelope): unknown {
  return request.command;
}

export function createValidatedErrorResponseEnvelope<C extends CommandId = CommandId>(
  id: string,
  error: ProtocolError,
  protocolVersion: number,
): ResponseEnvelope<C>;
export function createValidatedErrorResponseEnvelope(id: string, error: ProtocolError, protocolVersion: number): unknown {
  return { protocolVersion, id, ok: false, error };
}
