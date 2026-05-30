import { z } from "zod";

import { PROTOCOL_VERSION } from "./constants.js";
import {
  boundarySchema,
  createProtocolVersionMismatchError,
  isProtocolVersionInRange,
  negotiateProtocolVersion,
  protocolErrorSchema,
  type Boundary,
  type Component,
  type ComponentIdentity,
  type ErrorCode,
  type ParseResult,
  type ProtocolError,
  type ProtocolVersionRange,
} from "./core.js";
import { commandSchemas, isCommandId, type CommandId } from "./registry/index.js";

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

export type HelloRequestNegotiationOptions = {
  readonly local: ProtocolVersionRange;
  readonly expectedPeerComponent: Component;
};

export type HelloResponseNegotiationOptions = {
  readonly local: ProtocolVersionRange;
  readonly expectedPeerComponent: Component;
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

export type RequestProtocolCompatibility = {
  readonly compatible: boolean;
  readonly requiredProtocolVersion: number;
  readonly reason?: string;
};

type RequestProtocolSubject = {
  readonly command: string;
  readonly params: unknown;
  readonly protocolVersion?: number;
};

const SCOPED_NETWORK_PROTOCOL_VERSION = 2;

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

  const params = commandSchemas[envelope.data.command].params.safeParse(envelope.data.params);
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
    const result = commandSchemas[command].result.safeParse(envelope.data.result);
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
  return parseBoundaryResponse(boundary, request.command as C, raw, options);
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
  const envelope: OkResponseEnvelopeFor<C> = {
    protocolVersion,
    id: request.id,
    ok: true,
    result,
  };
  return envelope as ResponseEnvelope<C>;
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
  return createValidatedErrorResponseEnvelope(request.id, error, protocolVersion);
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
  return response.ok
    ? createOkResponse(request, response.result as CommandResult<C>, protocolVersion)
    : createValidatedErrorResponseEnvelope<C>(request.id, response.error, protocolVersion);
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

export function getRequestProtocolCompatibility(
  request: RequestProtocolSubject,
  protocolVersion: number = requestProtocolVersion(request),
): RequestProtocolCompatibility {
  const requiredProtocolVersion = getRequiredRequestProtocolVersion(request);
  return {
    compatible: protocolVersion >= requiredProtocolVersion,
    requiredProtocolVersion,
    ...(requiredProtocolVersion > 1 ? { reason: requiredProtocolReason(request) } : {}),
  };
}

export function createRequestProtocolMismatchError(
  request: RequestProtocolSubject,
  protocolVersion: number,
): ProtocolError {
  const compatibility = getRequestProtocolCompatibility(request, protocolVersion);
  return {
    code: "VERSION_MISMATCH",
    message: "Request requires a newer protocol version than the negotiated session.",
    details: {
      command: request.command,
      requiredProtocolVersion: compatibility.requiredProtocolVersion,
      negotiatedProtocolVersion: protocolVersion,
      ...(compatibility.reason === undefined ? {} : { reason: compatibility.reason }),
    },
  };
}

function getRequiredRequestProtocolVersion(request: RequestProtocolSubject) {
  return requestUsesScopedNetworkSemantics(request) ? SCOPED_NETWORK_PROTOCOL_VERSION : 1;
}

function requestUsesScopedNetworkSemantics(request: RequestProtocolSubject): boolean {
  if (request.command === "network") {
    return true;
  }

  if (request.command === "wait" && isNetworkIdleWaitParams(request.params)) {
    return true;
  }

  if (request.command !== "batch" || !hasSteps(request.params)) {
    return false;
  }

  return request.params.steps.some((step) =>
    requestUsesScopedNetworkSemantics({
      command: step.command,
      params: step.params,
    }),
  );
}

function requiredProtocolReason(request: RequestProtocolSubject): string {
  if (request.command === "batch") {
    return "Batch contains scoped network command semantics.";
  }
  if (request.command === "wait") {
    return "Network-idle waits are scoped to the resolved tab.";
  }
  return "Network commands are scoped to the resolved tab.";
}

function requestProtocolVersion(request: { readonly protocolVersion?: number }): number {
  return request.protocolVersion ?? PROTOCOL_VERSION;
}

function isNetworkIdleWaitParams(params: unknown): boolean {
  return (
    typeof params === "object" &&
    params !== null &&
    "kind" in params &&
    params.kind === "load-state" &&
    "state" in params &&
    params.state === "networkidle"
  );
}

function hasSteps(params: unknown): params is {
  readonly steps: readonly { readonly command: string; readonly params: unknown }[];
} {
  return (
    typeof params === "object" &&
    params !== null &&
    "steps" in params &&
    Array.isArray(params.steps)
  );
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

function failure(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ParseResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

function parseNegotiatedHelloRequest(
  envelope: z.infer<typeof requestEnvelopeSchema>,
  options: HelloRequestNegotiationOptions,
): ParseResult<RequestEnvelope<"hello">> {
  const params = commandSchemas.hello.params.safeParse(envelope.params);
  if (!params.success) {
    return failure("INVALID_ENVELOPE", "Command params are invalid.", {
      command: "hello",
      issues: params.error.issues,
    });
  }

  const peer = params.data;
  const negotiation = validateHelloNegotiation({
    envelopeProtocolVersion: envelope.protocolVersion,
    local: options.local,
    peer,
    expectedPeerComponent: options.expectedPeerComponent,
    errorCode: "INVALID_ENVELOPE",
  });
  if (!negotiation.ok) {
    return negotiation;
  }

  return {
    ok: true,
    value: {
      protocolVersion: negotiation.value,
      id: envelope.id,
      command: "hello",
      params: peer,
    },
  };
}

function parseNegotiatedHelloResponse(
  envelope: z.infer<typeof responseEnvelopeSchema>,
  options: HelloResponseNegotiationOptions,
): ParseResult<ResponseEnvelope<"hello">> {
  if (!envelope.ok) {
    const error = protocolErrorSchema.safeParse(envelope.error);
    if (!error.success) {
      return failure("INVALID_RESPONSE", "Error response is invalid.", {
        issues: error.error.issues,
      });
    }

    if (
      !isProtocolVersionInRange(envelope.protocolVersion, options.local) &&
      error.data.code !== "VERSION_MISMATCH"
    ) {
      return {
        ok: false,
        error: createProtocolVersionMismatchError(options.local, {
          protocolMin: envelope.protocolVersion,
          protocolMax: envelope.protocolVersion,
        }),
      };
    }

    return {
      ok: true,
      value: {
        protocolVersion: envelope.protocolVersion,
        id: envelope.id,
        ok: false,
        error: error.data,
      },
    };
  }

  const result = commandSchemas.hello.result.safeParse(envelope.result);
  if (!result.success) {
    return failure("INVALID_RESPONSE", "Command result is invalid.", {
      command: "hello",
      issues: result.error.issues,
    });
  }

  const negotiation = validateHelloNegotiation({
    envelopeProtocolVersion: envelope.protocolVersion,
    local: options.local,
    peer: result.data.peer,
    expectedPeerComponent: options.expectedPeerComponent,
    errorCode: "INVALID_RESPONSE",
  });
  if (!negotiation.ok) {
    return negotiation;
  }

  if (result.data.negotiatedProtocolVersion !== negotiation.value) {
    return failure("INVALID_RESPONSE", "Negotiated protocol version is invalid.", {
      expected: negotiation.value,
      received: result.data.negotiatedProtocolVersion,
    });
  }

  if (envelope.protocolVersion !== result.data.negotiatedProtocolVersion) {
    return failure("INVALID_RESPONSE", "Hello response envelope version must match negotiation.", {
      expected: result.data.negotiatedProtocolVersion,
      received: envelope.protocolVersion,
    });
  }

  return {
    ok: true,
    value: {
      protocolVersion: negotiation.value,
      id: envelope.id,
      ok: true,
      result: result.data,
    },
  };
}

function validateHelloNegotiation(options: {
  readonly envelopeProtocolVersion: number;
  readonly local: ProtocolVersionRange;
  readonly peer: ComponentIdentity;
  readonly expectedPeerComponent: Component;
  readonly errorCode: "INVALID_ENVELOPE" | "INVALID_RESPONSE";
}): ParseResult<number> {
  if (options.peer.component !== options.expectedPeerComponent) {
    return failure(options.errorCode, "Unexpected hello peer component.", {
      expected: options.expectedPeerComponent,
      received: options.peer.component,
    });
  }

  if (!isProtocolVersionInRange(options.envelopeProtocolVersion, options.peer)) {
    return failure("VERSION_MISMATCH", "Hello envelope version is outside the peer range.", {
      received: options.envelopeProtocolVersion,
      peer: {
        protocolMin: options.peer.protocolMin,
        protocolMax: options.peer.protocolMax,
      },
    });
  }

  const negotiated = negotiateProtocolVersion(options.local, options.peer);
  if (!negotiated.ok) {
    return negotiated;
  }

  return negotiated;
}
