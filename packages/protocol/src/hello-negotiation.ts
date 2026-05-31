import {
  createProtocolVersionMismatchError,
  isProtocolVersionInRange,
  negotiateProtocolVersion,
  protocolErrorSchema,
  type Component,
  type ComponentIdentity,
  type ParseResult,
  type ProtocolVersionRange,
} from "./core.js";
import type { RequestEnvelope, ResponseEnvelope } from "./envelopes.js";
import { failure } from "./parse-failure.js";
import { commandSchemas } from "./registry/index.js";

export interface HelloRequestNegotiationOptions {
  readonly local: ProtocolVersionRange;
  readonly expectedPeerComponent: Component;
}

export interface HelloResponseNegotiationOptions {
  readonly local: ProtocolVersionRange;
  readonly expectedPeerComponent: Component;
}

export interface RawRequestEnvelope {
  readonly protocolVersion: number;
  readonly id: string;
  readonly command: string;
  readonly params: unknown;
}

export type RawResponseEnvelope =
  | {
      readonly protocolVersion: number;
      readonly id: string;
      readonly ok: true;
      readonly result: unknown;
    }
  | {
      readonly protocolVersion: number;
      readonly id: string;
      readonly ok: false;
      readonly error: unknown;
    };

export function parseNegotiatedHelloRequest(envelope: RawRequestEnvelope, options: HelloRequestNegotiationOptions): ParseResult<RequestEnvelope<"hello">> {
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

export function parseNegotiatedHelloResponse(envelope: RawResponseEnvelope, options: HelloResponseNegotiationOptions): ParseResult<ResponseEnvelope<"hello">> {
  if (!envelope.ok) {
    const error = protocolErrorSchema.safeParse(envelope.error);
    if (!error.success) {
      return failure("INVALID_RESPONSE", "Error response is invalid.", {
        issues: error.error.issues,
      });
    }

    if (!isProtocolVersionInRange(envelope.protocolVersion, options.local) && error.data.code !== "VERSION_MISMATCH") {
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
