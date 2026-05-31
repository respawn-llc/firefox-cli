import { z } from "zod";

import { safeParseCommandResult, safeParseStrictCommandParams } from "./command-validation.js";
import { PROTOCOL_VERSION } from "./constants.js";
import {
  boundarySchema,
  protocolErrorSchema,
  type Boundary,
  type ParseResult,
  type ProtocolError,
} from "./core.js";
import {
  parseNegotiatedHelloRequest,
  parseNegotiatedHelloResponse,
  type HelloRequestNegotiationOptions,
  type HelloResponseNegotiationOptions,
} from "./hello-negotiation.js";
import { failure } from "./parse-failure.js";
import {
  createRequestProtocolMismatchError,
  getRequestProtocolCompatibility,
  type RequestProtocolCompatibility,
} from "./protocol-compatibility.js";
import { isCommandId, type CommandId, type commandSchemas } from "./registry/index.js";

export type {
  HelloRequestNegotiationOptions,
  HelloResponseNegotiationOptions,
  RequestProtocolCompatibility,
};
export { createRequestProtocolMismatchError, getRequestProtocolCompatibility };

export type CommandParams<C extends CommandId> = z.infer<(typeof commandSchemas)[C]["params"]>;
export type CommandResult<C extends CommandId> = z.infer<(typeof commandSchemas)[C]["result"]>;

export type RequestEnvelope<C extends CommandId = CommandId> = C extends CommandId
  ? {
      readonly protocolVersion: number;
      readonly id: string;
      readonly command: C;
      readonly params: CommandParams<C>;
    }
  : never;

export type ResponseEnvelope<C extends CommandId = CommandId> = C extends CommandId
  ?
      | {
          readonly protocolVersion: number;
          readonly id: string;
          readonly ok: true;
          readonly result: CommandResult<C>;
        }
      | {
          readonly protocolVersion: number;
          readonly id: string;
          readonly ok: false;
          readonly error: ProtocolError;
        }
  : never;

type RequestEnvelopeFor<C extends CommandId> = {
  readonly protocolVersion: number;
  readonly id: string;
  readonly command: C;
  readonly params: CommandParams<C>;
};

type OkResponseEnvelopeFor<C extends CommandId> = {
  readonly protocolVersion: number;
  readonly id: string;
  readonly ok: true;
  readonly result: CommandResult<C>;
};

type ErrorResponseEnvelope = {
  readonly protocolVersion: number;
  readonly id: string;
  readonly ok: false;
  readonly error: ProtocolError;
};

export type ParseBoundaryRequestOptions = {
  readonly protocolVersion?: number;
  readonly hello?: HelloRequestNegotiationOptions;
};

export type ParseBoundaryResponseOptions = {
  readonly protocolVersion?: number;
  readonly hello?: HelloResponseNegotiationOptions;
};

export type ProtocolSession = {
  readonly protocolVersion: number;
  parseRequest(boundary: Boundary, raw: unknown): ParseResult<RequestEnvelope>;
  parseResponse<C extends CommandId>(
    boundary: Boundary,
    command: C,
    raw: unknown,
  ): ParseResult<ResponseEnvelope<C>>;
  parseResponseForRequest<C extends CommandId>(
    boundary: Boundary,
    request: RequestEnvelope<C>,
    raw: unknown,
  ): ParseResult<ResponseEnvelope<C>>;
  createOkResponse<C extends CommandId>(
    request: RequestEnvelope<C>,
    result: CommandResult<C>,
  ): ResponseEnvelope<C>;
  createErrorResponse(id: string, error: ProtocolError): ResponseEnvelope;
  createErrorResponseForRequest<C extends CommandId>(
    request: RequestEnvelope<C>,
    error: ProtocolError,
  ): ResponseEnvelope<C>;
  withResponseVersion<C extends CommandId>(
    request: RequestEnvelope<C>,
    response: ResponseEnvelope<C>,
  ): ResponseEnvelope<C>;
  withRequestVersion<C extends CommandId>(request: RequestEnvelope<C>): RequestEnvelope<C>;
};

const requestEnvelopeSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    id: z.string().min(1),
    command: z.string().min(1),
    params: z.unknown(),
  })
  .strict();

const responseEnvelopeSchema = z.discriminatedUnion("ok", [
  z
    .object({
      protocolVersion: z.number().int().positive(),
      id: z.string().min(1),
      ok: z.literal(true),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      protocolVersion: z.number().int().positive(),
      id: z.string().min(1),
      ok: z.literal(false),
      error: z.unknown(),
    })
    .strict(),
]);

export function parseBoundaryRequest(
  boundary: Boundary,
  raw: unknown,
  options: ParseBoundaryRequestOptions = {},
): ParseResult<RequestEnvelope> {
  const boundaryValidation = boundarySchema.safeParse(boundary);
  if (!boundaryValidation.success) {
    return failure("INVALID_ENVELOPE", "Unknown protocol boundary.", { boundary });
  }

  const decoded = decodeRaw(raw);
  if (!decoded.ok) {
    return decoded;
  }

  const envelope = requestEnvelopeSchema.safeParse(decoded.value);
  if (!envelope.success) {
    return failure("INVALID_ENVELOPE", "Request envelope is invalid.", {
      issues: envelope.error.issues,
    });
  }

  if (envelope.data.command === "hello" && options.hello !== undefined) {
    return parseNegotiatedHelloRequest(envelope.data, options.hello);
  }

  const expectedProtocolVersion = options.protocolVersion ?? PROTOCOL_VERSION;
  if (envelope.data.protocolVersion !== expectedProtocolVersion) {
    return failure("VERSION_MISMATCH", "Protocol version is not supported.", {
      received: envelope.data.protocolVersion,
      supported: expectedProtocolVersion,
    });
  }

  if (!isCommandId(envelope.data.command)) {
    return failure("UNKNOWN_COMMAND", `Unknown command: ${envelope.data.command}`, {
      command: envelope.data.command,
    });
  }

  const params = safeParseStrictCommandParams(envelope.data.command, envelope.data.params);
  if (!params.success) {
    return failure("INVALID_ENVELOPE", "Command params are invalid.", {
      command: envelope.data.command,
      issues: params.error.issues,
    });
  }

  const compatibility = getRequestProtocolCompatibility({
    protocolVersion: expectedProtocolVersion,
    command: envelope.data.command,
    params: params.data,
  });
  if (!compatibility.compatible) {
    return failure(
      "VERSION_MISMATCH",
      "Request requires a newer protocol version than the negotiated session.",
      {
        command: envelope.data.command,
        requiredProtocolVersion: compatibility.requiredProtocolVersion,
        negotiatedProtocolVersion: expectedProtocolVersion,
        ...(compatibility.reason === undefined ? {} : { reason: compatibility.reason }),
      },
    );
  }

  return {
    ok: true,
    value: createValidatedRequestEnvelope(
      envelope.data.command,
      params.data,
      envelope.data.id,
      expectedProtocolVersion,
    ),
  };
}

export function parseBoundaryResponse<C extends CommandId>(
  boundary: Boundary,
  command: C,
  raw: unknown,
  options?: ParseBoundaryResponseOptions,
): ParseResult<ResponseEnvelope<C>>;
export function parseBoundaryResponse(
  boundary: Boundary,
  command: CommandId,
  raw: unknown,
  options?: ParseBoundaryResponseOptions,
): ParseResult<ResponseEnvelope>;
export function parseBoundaryResponse(
  boundary: Boundary,
  command: CommandId,
  raw: unknown,
  options: ParseBoundaryResponseOptions = {},
): ParseResult<ResponseEnvelope> {
  const boundaryValidation = boundarySchema.safeParse(boundary);
  if (!boundaryValidation.success) {
    return failure("INVALID_RESPONSE", "Unknown protocol boundary.", { boundary });
  }

  const decoded = decodeRaw(raw);
  if (!decoded.ok) {
    return decoded;
  }

  const envelope = responseEnvelopeSchema.safeParse(decoded.value);
  if (!envelope.success) {
    return failure("INVALID_RESPONSE", "Response envelope is invalid.", {
      issues: envelope.error.issues,
    });
  }

  if (command === "hello" && options.hello !== undefined) {
    return parseNegotiatedHelloResponse(envelope.data, options.hello);
  }

  const expectedProtocolVersion = options.protocolVersion ?? PROTOCOL_VERSION;
  if (envelope.data.protocolVersion !== expectedProtocolVersion) {
    return failure("VERSION_MISMATCH", "Protocol version is not supported.", {
      received: envelope.data.protocolVersion,
      supported: expectedProtocolVersion,
    });
  }

  if (envelope.data.ok) {
    const result = safeParseCommandResult(command, envelope.data.result);
    if (!result.success) {
      return failure("INVALID_RESPONSE", "Command result is invalid.", {
        command,
        issues: result.error.issues,
      });
    }

    return {
      ok: true,
      value: createValidatedOkResponseEnvelope(
        command,
        result.data,
        envelope.data.id,
        expectedProtocolVersion,
      ),
    };
  }

  const error = protocolErrorSchema.safeParse(envelope.data.error);
  if (!error.success) {
    return failure("INVALID_RESPONSE", "Error response is invalid.", {
      issues: error.error.issues,
    });
  }

  return {
    ok: true,
    value: createValidatedErrorResponseEnvelope(
      envelope.data.id,
      error.data,
      expectedProtocolVersion,
    ),
  };
}

export function parseBoundaryResponseForRequest<C extends CommandId>(
  boundary: Boundary,
  request: RequestEnvelope<C>,
  raw: unknown,
  options?: ParseBoundaryResponseOptions,
): ParseResult<ResponseEnvelope<C>> {
  return parseBoundaryResponse(boundary, requestCommand(request), raw, options);
}

export function createRequest<C extends CommandId>(
  command: C,
  params: CommandParams<C>,
  id: string = crypto.randomUUID(),
  protocolVersion: number = PROTOCOL_VERSION,
): RequestEnvelope<C> {
  return createValidatedRequestEnvelope(command, params, id, protocolVersion);
}

export function createOkResponse<C extends CommandId>(
  request: RequestEnvelope<C>,
  result: CommandResult<C>,
  protocolVersion: number = request.protocolVersion,
): ResponseEnvelope<C> {
  return createValidatedOkResponseEnvelopeForRequest(request, result, protocolVersion);
}

export function createErrorResponse(
  id: string,
  error: ProtocolError,
  protocolVersion: number = PROTOCOL_VERSION,
): ResponseEnvelope {
  return createValidatedErrorResponseEnvelope(id, error, protocolVersion);
}

export function createErrorResponseForRequest<C extends CommandId>(
  request: RequestEnvelope<C>,
  error: ProtocolError,
  protocolVersion: number = request.protocolVersion,
): ResponseEnvelope<C> {
  return createValidatedErrorResponseEnvelope<C>(request.id, error, protocolVersion);
}

export function withRequestProtocolVersion<C extends CommandId>(
  request: RequestEnvelope<C>,
  protocolVersion: number,
): RequestEnvelope<C> {
  return {
    ...request,
    protocolVersion,
  };
}

export function withResponseProtocolVersion<C extends CommandId>(
  request: RequestEnvelope<C>,
  response: ResponseEnvelope<C>,
  protocolVersion: number,
): ResponseEnvelope<C> {
  return createValidatedResponseEnvelopeWithVersion(request, response, protocolVersion);
}

export function createProtocolSession(protocolVersion: number): ProtocolSession {
  return {
    protocolVersion,
    parseRequest: (boundary, raw) => parseBoundaryRequest(boundary, raw, { protocolVersion }),
    parseResponse: (boundary, command, raw) =>
      parseBoundaryResponse(boundary, command, raw, { protocolVersion }),
    parseResponseForRequest: (boundary, request, raw) =>
      parseBoundaryResponseForRequest(boundary, request, raw, { protocolVersion }),
    createOkResponse: (request, result) => createOkResponse(request, result, protocolVersion),
    createErrorResponse: (id, error) => createErrorResponse(id, error, protocolVersion),
    createErrorResponseForRequest: (request, error) =>
      createErrorResponseForRequest(request, error, protocolVersion),
    withResponseVersion: (request, response) =>
      withResponseProtocolVersion(request, response, protocolVersion),
    withRequestVersion: (request) => withRequestProtocolVersion(request, protocolVersion),
  };
}

function decodeRaw(raw: unknown): ParseResult<unknown> {
  if (typeof raw !== "string") {
    return { ok: true, value: raw };
  }

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return failure("INVALID_JSON", "Payload is not valid JSON.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function createValidatedRequestEnvelope<C extends CommandId>(
  command: C,
  params: CommandParams<C>,
  id: string,
  protocolVersion: number,
): RequestEnvelope<C> {
  const envelope: RequestEnvelopeFor<C> = {
    protocolVersion,
    id,
    command,
    params,
  };
  return envelope as RequestEnvelope<C>;
}

function createValidatedOkResponseEnvelope<C extends CommandId>(
  command: C,
  result: CommandResult<C>,
  id: string,
  protocolVersion: number,
): ResponseEnvelope<C> {
  void command;
  const envelope: OkResponseEnvelopeFor<C> = {
    protocolVersion,
    id,
    ok: true,
    result,
  };
  return envelope as ResponseEnvelope<C>;
}

function createValidatedOkResponseEnvelopeForRequest<C extends CommandId>(
  request: RequestEnvelope<C>,
  result: CommandResult<C>,
  protocolVersion: number,
): ResponseEnvelope<C> {
  const envelope: OkResponseEnvelopeFor<C> = {
    protocolVersion,
    id: request.id,
    ok: true,
    result,
  };
  return envelope as ResponseEnvelope<C>;
}

function createValidatedResponseEnvelopeWithVersion<C extends CommandId>(
  request: RequestEnvelope<C>,
  response: ResponseEnvelope<C>,
  protocolVersion: number,
): ResponseEnvelope<C> {
  if (!response.ok) {
    return createValidatedErrorResponseEnvelope<C>(request.id, response.error, protocolVersion);
  }

  const envelope: OkResponseEnvelopeFor<C> = {
    protocolVersion,
    id: request.id,
    ok: true,
    result: response.result as CommandResult<C>,
  };
  return envelope as ResponseEnvelope<C>;
}

function requestCommand<C extends CommandId>(request: RequestEnvelope<C>): C {
  return request.command as C;
}

function createValidatedErrorResponseEnvelope<C extends CommandId = CommandId>(
  id: string,
  error: ProtocolError,
  protocolVersion: number,
): ResponseEnvelope<C> {
  const envelope: ErrorResponseEnvelope = {
    protocolVersion,
    id,
    ok: false,
    error,
  };
  return envelope as ResponseEnvelope<C>;
}
