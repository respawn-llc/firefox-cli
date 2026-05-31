import type { Boundary, ParseResult, ProtocolError } from "./core.js";
import {
  createErrorResponse,
  createErrorResponseForRequest,
  createOkResponse,
  parseBoundaryRequest,
  parseBoundaryResponse,
  parseBoundaryResponseForRequest,
  withRequestProtocolVersion,
  withResponseProtocolVersion,
  type CommandResult,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ParseBoundaryResponseOptions,
} from "./envelopes.js";
import type { CommandId } from "./registry/index.js";

export interface ProtocolSession {
  readonly protocolVersion: number;
  parseRequest(boundary: Boundary, raw: unknown): ParseResult<RequestEnvelope>;
  parseResponse<C extends CommandId>(boundary: Boundary, command: C, raw: unknown): ParseResult<ResponseEnvelope<C>>;
  parseResponseForRequest<C extends CommandId>(boundary: Boundary, request: RequestEnvelope<C>, raw: unknown): ParseResult<ResponseEnvelope<C>>;
  createOkResponse<C extends CommandId>(request: RequestEnvelope<C>, result: CommandResult<C>): ResponseEnvelope<C>;
  createErrorResponse(id: string, error: ProtocolError): ResponseEnvelope;
  createErrorResponseForRequest<C extends CommandId>(request: RequestEnvelope<C>, error: ProtocolError): ResponseEnvelope<C>;
  withResponseVersion<C extends CommandId>(request: RequestEnvelope<C>, response: ResponseEnvelope<C>): ResponseEnvelope<C>;
  withRequestVersion<C extends CommandId>(request: RequestEnvelope<C>): RequestEnvelope<C>;
}

export function createProtocolSession(protocolVersion: number): ProtocolSession {
  const responseOptions: ParseBoundaryResponseOptions = { protocolVersion };

  return {
    protocolVersion,
    parseRequest: (boundary, raw) => parseBoundaryRequest(boundary, raw, { protocolVersion }),
    parseResponse: (boundary, command, raw) => parseBoundaryResponse(boundary, command, raw, responseOptions),
    parseResponseForRequest: (boundary, request, raw) => parseBoundaryResponseForRequest(boundary, request, raw, responseOptions),
    createOkResponse: (request, result) => createOkResponse(request, result, protocolVersion),
    createErrorResponse: (id, error) => createErrorResponse(id, error, protocolVersion),
    createErrorResponseForRequest: (request, error) => createErrorResponseForRequest(request, error, protocolVersion),
    withResponseVersion: (request, response) => withResponseProtocolVersion(request, response, protocolVersion),
    withRequestVersion: (request) => withRequestProtocolVersion(request, protocolVersion),
  };
}
