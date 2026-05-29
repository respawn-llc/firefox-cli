import { z } from "zod";

import { PROTOCOL_VERSION } from "./constants.js";
import {
  boundarySchema,
  protocolErrorSchema,
  type Boundary,
  type ErrorCode,
  type ParseResult,
  type ProtocolError,
} from "./core.js";
import { commandSchemas, isCommandId, type CommandId } from "./registry/index.js";

export type RequestEnvelope<C extends CommandId = CommandId> = {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly id: string;
  readonly command: C;
  readonly params: z.infer<(typeof commandSchemas)[C]["params"]>;
};

export type ResponseEnvelope<C extends CommandId = CommandId> =
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly id: string;
      readonly ok: true;
      readonly result: z.infer<(typeof commandSchemas)[C]["result"]>;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly id: string;
      readonly ok: false;
      readonly error: ProtocolError;
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

  if (envelope.data.protocolVersion !== PROTOCOL_VERSION) {
    return failure("VERSION_MISMATCH", "Protocol version is not supported.", {
      received: envelope.data.protocolVersion,
      supported: PROTOCOL_VERSION,
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

  return {
    ok: true,
    value: {
      protocolVersion: PROTOCOL_VERSION,
      id: envelope.data.id,
      command: envelope.data.command,
      params: params.data,
    },
  };
}

export function parseBoundaryResponse(
  boundary: Boundary,
  command: CommandId,
  raw: unknown,
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

  if (envelope.data.protocolVersion !== PROTOCOL_VERSION) {
    return failure("VERSION_MISMATCH", "Protocol version is not supported.", {
      received: envelope.data.protocolVersion,
      supported: PROTOCOL_VERSION,
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
      value: {
        protocolVersion: PROTOCOL_VERSION,
        id: envelope.data.id,
        ok: true,
        result: result.data,
      },
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
    value: {
      protocolVersion: PROTOCOL_VERSION,
      id: envelope.data.id,
      ok: false,
      error: error.data,
    },
  };
}

export function createRequest<C extends CommandId>(
  command: C,
  params: z.infer<(typeof commandSchemas)[C]["params"]>,
  id: string = crypto.randomUUID(),
): RequestEnvelope<C> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id,
    command,
    params,
  };
}

export function createOkResponse<C extends CommandId>(
  request: RequestEnvelope<C>,
  result: z.infer<(typeof commandSchemas)[C]["result"]>,
): ResponseEnvelope<C> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: request.id,
    ok: true,
    result,
  };
}

export function createErrorResponse(id: string, error: ProtocolError): ResponseEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id,
    ok: false,
    error,
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
