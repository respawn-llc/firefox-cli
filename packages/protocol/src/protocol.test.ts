import { describe, expect, it } from "vitest";
import {
  PROTOCOL_MAX_VERSION,
  PROTOCOL_MIN_VERSION,
  createErrorResponseForRequest,
  createOkResponse,
  createProtocolSession,
  createLocalComponentIdentity,
  createRequest,
  localProtocolVersionRange,
  negotiateProtocolVersion,
  parseBoundaryRequest,
  parseBoundaryResponse,
  type ProtocolSession,
} from "./index.js";
import { cliIdentity } from "./protocol-test-support.js";

describe("protocol negotiation", () => {
  it("defines the local supported range from protocol constants", () => {
    expect(localProtocolVersionRange).toEqual({
      protocolMin: PROTOCOL_MIN_VERSION,
      protocolMax: PROTOCOL_MAX_VERSION,
    });
    expect(createLocalComponentIdentity("cli", "0.0.0")).toMatchObject({
      component: "cli",
      protocolMin: PROTOCOL_MIN_VERSION,
      protocolMax: PROTOCOL_MAX_VERSION,
    });
  });

  it("chooses the highest overlapping protocol version", () => {
    expect(negotiateProtocolVersion({ protocolMin: 1, protocolMax: 3 }, { protocolMin: 1, protocolMax: 2 })).toEqual({ ok: true, value: 2 });

    expect(negotiateProtocolVersion({ protocolMin: 1, protocolMax: 1 }, { protocolMin: 2, protocolMax: 3 })).toMatchObject({
      ok: false,
      error: {
        code: "VERSION_MISMATCH",
      },
    });
  });

  it("validates component identity ranges", () => {
    expect(
      parseBoundaryRequest(
        "cli-to-host",
        createRequest(
          "hello",
          {
            ...cliIdentity,
            protocolMin: 2,
            protocolMax: 1,
          },
          "hello-invalid-range",
        ),
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ENVELOPE" } });
  });

  it("normalizes compatible hello requests to the negotiated version", () => {
    const parsed = parseBoundaryRequest(
      "cli-to-host",
      createRequest(
        "hello",
        {
          ...cliIdentity,
          protocolMin: 1,
          protocolMax: 2,
        },
        "hello-new-cli",
        2,
      ),
      {
        hello: {
          local: { protocolMin: 1, protocolMax: 1 },
          expectedPeerComponent: "cli",
        },
      },
    );

    expect(parsed).toMatchObject({
      ok: true,
      value: {
        protocolVersion: 1,
      },
    });
  });

  it("validates hello response negotiation and peer components", () => {
    const request = createRequest("hello", cliIdentity, "hello-response", 1);
    const session: ProtocolSession = createProtocolSession(1);

    expect(
      parseBoundaryResponse(
        "cli-to-host",
        "hello",
        createOkResponse(
          request,
          {
            accepted: true,
            negotiatedProtocolVersion: 1,
            peer: {
              ...createLocalComponentIdentity("native-host", "0.0.0"),
              protocolMin: 1,
              protocolMax: 1,
            },
          },
          1,
        ),
        {
          hello: {
            local: { protocolMin: 1, protocolMax: 2 },
            expectedPeerComponent: "native-host",
          },
        },
      ),
    ).toMatchObject({ ok: true, value: { protocolVersion: 1 } });

    expect(session.withRequestVersion(createRequest("noop", {}, "session-noop", 2))).toEqual(createRequest("noop", {}, "session-noop", 1));

    const error = {
      code: "TIMEOUT" as const,
      message: "Timed out.",
    };
    expect(session.createErrorResponseForRequest(request, error)).toEqual(createErrorResponseForRequest(request, error, 1));
    expect(
      session.parseResponseForRequest(
        "cli-to-host",
        request,
        createOkResponse(request, {
          accepted: true,
          negotiatedProtocolVersion: 1,
          peer: {
            ...createLocalComponentIdentity("native-host", "0.0.0"),
            protocolMin: 1,
            protocolMax: 1,
          },
        }),
      ),
    ).toMatchObject({ ok: true, value: { id: request.id, ok: true } });
    expect(session.withResponseVersion(request, createErrorResponseForRequest(request, error))).toEqual(createErrorResponseForRequest(request, error, 1));

    expect(
      parseBoundaryResponse(
        "cli-to-host",
        "hello",
        createOkResponse(
          request,
          {
            accepted: true,
            negotiatedProtocolVersion: 1,
            peer: createLocalComponentIdentity("extension", "0.0.0"),
          },
          1,
        ),
        {
          hello: {
            local: { protocolMin: 1, protocolMax: 2 },
            expectedPeerComponent: "native-host",
          },
        },
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_RESPONSE" } });
  });
});
