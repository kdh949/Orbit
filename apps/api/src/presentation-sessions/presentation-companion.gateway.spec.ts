import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io";

const { configState } = vi.hoisted(() => ({
  configState: { enabled: true },
}));

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({
    COOKIE_SECRET: "companion-gateway-cookie-secret",
    get IPAD_PRESENTER_COMPANION_ENABLED() {
      return configState.enabled;
    },
    SESSION_SECRET: "companion-gateway-session-secret",
    WEB_ORIGIN: "https://present.orbit.example",
  }),
}));

vi.mock("cookie-parser", () => ({
  default: {
    signedCookie: (value: string) =>
      value.startsWith("valid-") ? value.slice("valid-".length) : false,
  },
}));

import { companionAccessCookieName } from "./companion-access-cookie";
import { PresentationCompanionGateway } from "./presentation-companion.gateway";

describe("PresentationCompanionGateway", () => {
  beforeEach(() => {
    configState.enabled = true;
  });
  it("does not accept an ordinary audience cookie for companion join", async () => {
    const fixture = createFixture();
    const client = socket({
      cookie: "orbit_presentation_audience=valid-audience-token",
      id: "socket_audience",
    });

    const result = await fixture.gateway.joinCompanion(client, {
      sessionId: "session_1",
    });

    expect(result).toMatchObject({
      data: {
        payload: { code: "AUTH_REQUIRED" },
      },
    });
    expect(fixture.companion.verifyCredential).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it("relays an authenticated annotation only to the leased authority epoch room", async () => {
    const fixture = createFixture();
    const presenter = socket({
      cookie: "orbit_session=valid-auth-session",
      id: "socket_presenter",
      userAgent: "Desktop Safari",
    });
    const companion = socket({
      cookie: `${companionAccessCookieName}=valid-companion-token`,
      id: "socket_companion",
      userAgent: "iPad Safari",
    });

    await fixture.gateway.claimAuthority(presenter, {
      sessionId: "session_1",
      authorityEpochId: "epoch_1",
    });
    await fixture.gateway.joinCompanion(companion, {
      sessionId: "session_1",
    });
    expect(fixture.companion.recordConnected).toHaveBeenCalledWith({
      companionId: "companion_opaque_1",
      pairingGeneration: 2,
      sessionId: "session_1",
    });
    const command = annotationCommand();
    const result = await fixture.gateway.relayAnnotationCommand(
      companion,
      command,
    );

    expect(result).toMatchObject({
      type: "presentation:companion:annotation-command",
      roomId:
        "presentation:session_1:companion-authority:epoch_1",
      payload: command,
    });
    expect(fixture.server.to).toHaveBeenLastCalledWith(
      "presentation:session_1:companion-authority:epoch_1",
    );
    expect(fixture.server.to).not.toHaveBeenCalledWith(
      "presentation:session_1:presenter",
    );
    expect(fixture.rateLimit.consumeDrawing).toHaveBeenCalledWith(
      "companion_opaque_1",
    );
  });

  it("rejects body session mismatch, stale generation, and oversized point batches before relay", async () => {
    const fixture = createFixture();
    const companion = socket({
      cookie: `${companionAccessCookieName}=valid-companion-token`,
      id: "socket_companion",
      userAgent: "iPad Safari",
    });
    await fixture.gateway.joinCompanion(companion, {
      sessionId: "session_1",
    });
    fixture.server.to.mockClear();

    await expect(
      fixture.gateway.relayAnnotationCommand(companion, {
        ...annotationCommand(),
        sessionId: "session_other",
      }),
    ).resolves.toMatchObject({
      data: { payload: { code: "STALE_GENERATION" } },
    });
    await expect(
      fixture.gateway.relayAnnotationCommand(companion, {
        ...annotationCommand(),
        points: Array.from({ length: 65 }, () => ({
          x: 0.5,
          y: 0.5,
          pressure: 0.5,
          t: 1,
        })),
      }),
    ).resolves.toMatchObject({
      data: { payload: { code: "INVALID_PAYLOAD" } },
    });
    vi.mocked(fixture.companion.verifyCredential).mockResolvedValueOnce(
      null,
    );
    await expect(
      fixture.gateway.relayAnnotationCommand(
        companion,
        annotationCommand(),
      ),
    ).resolves.toMatchObject({
      data: { payload: { code: "STALE_GENERATION" } },
    });
    expect(fixture.server.to).not.toHaveBeenCalled();
  });

  it("routes presenter output to the latest companion generation", async () => {
    const fixture = createFixture();
    const presenter = socket({
      cookie: "orbit_session=valid-auth-session",
      id: "socket_presenter",
    });
    await fixture.gateway.claimAuthority(presenter, {
      sessionId: "session_1",
      authorityEpochId: "epoch_1",
    });
    fixture.server.to.mockClear();

    await fixture.gateway.relayOutputState(presenter, {
      sessionId: "session_1",
      authorityEpochId: "epoch_1",
      outputRevision: 4,
      surfaceRevision: 2,
      surfaceId: "surface_1",
      outputMode: "slide",
      slideId: "slide_1",
      slideIndex: 0,
      animationStep: 1,
    });

    expect(fixture.server.to).toHaveBeenCalledWith(
      "presentation:session_1:companion:2",
    );
    expect(fixture.operator.emit).toHaveBeenCalledWith(
      "presentation:companion:output-state",
      expect.objectContaining({
        payload: expect.objectContaining({ outputRevision: 4 }),
      }),
    );
  });

  it("relays one share-scoped WebRTC negotiation in both directions", async () => {
    const fixture = createFixture();
    const presenter = socket({
      cookie: "orbit_session=valid-auth-session",
      id: "socket_presenter",
    });
    const companion = socket({
      cookie: `${companionAccessCookieName}=valid-companion-token`,
      id: "socket_companion",
    });
    await fixture.gateway.claimAuthority(presenter, {
      sessionId: "session_1",
      authorityEpochId: "epoch_1",
    });
    await fixture.gateway.joinCompanion(companion, {
      sessionId: "session_1",
    });
    fixture.server.to.mockClear();

    const offer = companionSignal("offer");
    await expect(
      fixture.gateway.relaySignal(presenter, offer),
    ).resolves.toMatchObject({
      roomId: "presentation:session_1:companion:2",
      payload: offer,
    });
    expect(fixture.server.to).toHaveBeenLastCalledWith(
      "presentation:session_1:companion:2",
    );

    const answer = companionSignal("answer");
    await expect(
      fixture.gateway.relaySignal(companion, answer),
    ).resolves.toMatchObject({
      roomId:
        "presentation:session_1:companion-authority:epoch_1",
      payload: answer,
    });
    expect(fixture.server.to).toHaveBeenLastCalledWith(
      "presentation:session_1:companion-authority:epoch_1",
    );
    await fixture.gateway.relaySignal(companion, {
      authorityEpochId: answer.authorityEpochId,
      kind: "end",
      reason: "failed",
      sessionId: answer.sessionId,
      shareEpochId: answer.shareEpochId,
      signalId: answer.signalId,
      targetGeneration: answer.targetGeneration,
    });
    expect(fixture.companion.recordWebRtcFailed).toHaveBeenCalledWith({
      pairingGeneration: 2,
      sessionId: "session_1",
    });
  });

  it("clears only matching presence on abrupt disconnect and keeps generation", async () => {
    const fixture = createFixture();
    const companion = socket({
      cookie: `${companionAccessCookieName}=valid-companion-token`,
      id: "socket_companion",
      userAgent: "iPad Safari",
    });
    await fixture.gateway.joinCompanion(companion, {
      sessionId: "session_1",
    });

    await fixture.gateway.handleDisconnect(companion);

    expect(fixture.companion.clearPresence).toHaveBeenCalledWith(
      "session_1",
      2,
    );
    expect(fixture.companion.revokeSession).not.toHaveBeenCalled();
    expect(fixture.companion.recordDisconnected).toHaveBeenCalledWith({
      pairingGeneration: 2,
      sessionId: "session_1",
    });
    expect(fixture.publisher.publishPresence).toHaveBeenLastCalledWith(
      "session_1",
      {
        connected: false,
        pairingGeneration: 2,
        connectedAt: null,
        rttBucket: null,
      },
    );
  });

  it("revokes an active companion on the next heartbeat after flag rollback", async () => {
    const fixture = createFixture();
    const companion = socket({
      cookie: `${companionAccessCookieName}=valid-companion-token`,
      id: "socket_companion",
    });
    await fixture.gateway.joinCompanion(companion, {
      sessionId: "session_1",
    });
    configState.enabled = false;

    await expect(
      fixture.gateway.heartbeatCompanion(companion, {
        sessionId: "session_1",
      }),
    ).resolves.toMatchObject({
      data: { payload: { code: "SESSION_UNAVAILABLE" } },
    });
    expect(fixture.companion.revokeSession).toHaveBeenCalledWith(
      "session_1",
      "disconnected",
    );
  });

  it("revokes a current credential when it reconnects to a flag-off instance", async () => {
    const fixture = createFixture();
    const reconnectingCompanion = socket({
      cookie: `${companionAccessCookieName}=valid-companion-token`,
      id: "socket_reconnecting_companion",
    });
    configState.enabled = false;

    await expect(
      fixture.gateway.joinCompanion(reconnectingCompanion, {
        sessionId: "session_1",
      }),
    ).resolves.toMatchObject({
      data: { payload: { code: "SESSION_UNAVAILABLE" } },
    });
    expect(fixture.companion.verifyCredential).toHaveBeenCalled();
    expect(fixture.companion.revokeSession).toHaveBeenCalledWith(
      "session_1",
      "disconnected",
    );
    expect(reconnectingCompanion.join).not.toHaveBeenCalled();
  });

  it("does not mutate session state for an unauthenticated rollback heartbeat", async () => {
    const fixture = createFixture();
    const audience = socket({
      cookie: "orbit_presentation_audience=valid-audience-token",
      id: "socket_audience",
    });
    configState.enabled = false;

    await expect(
      fixture.gateway.heartbeatCompanion(audience, {
        sessionId: "session_1",
      }),
    ).resolves.toMatchObject({
      data: { payload: { code: "SESSION_UNAVAILABLE" } },
    });
    expect(fixture.companion.revokeSession).not.toHaveBeenCalled();
  });
});

function createFixture() {
  const credential = {
    companionId: "companion_opaque_1",
    sessionId: "session_1",
    projectId: "project_1",
    deckId: "deck_1",
    deckVersion: 1,
    pairingGeneration: 2,
    scopes: ["view-audience-output", "write-annotation"],
    expiresAt: "2099-07-23T04:00:00.000Z",
    uaHash: "opaque-user-agent-hash-value",
  };
  const companion = {
    claimAuthority: vi.fn().mockResolvedValue(true),
    clearPresence: vi.fn().mockResolvedValue(true),
    getAuthority: vi.fn().mockResolvedValue("epoch_1"),
    getLatestGeneration: vi.fn().mockResolvedValue(2),
    heartbeatAuthority: vi.fn().mockResolvedValue(true),
    renewPresence: vi.fn().mockResolvedValue(undefined),
    recordCommandRejected: vi.fn(),
    recordConnected: vi.fn(),
    recordDisconnected: vi.fn(),
    recordWebRtcFailed: vi.fn(),
    revokeSession: vi.fn(),
    verifyCredential: vi.fn(
      async (
        _token: string,
        _userAgent: string,
        sessionId: string,
      ) => (sessionId === "session_1" ? credential : null),
    ),
  };
  const publisher = {
    attach: vi.fn(),
    publishAuthorityChanged: vi.fn().mockResolvedValue(undefined),
    publishPresence: vi.fn(),
  };
  const rateLimit = {
    consumeDrawing: vi.fn().mockResolvedValue(undefined),
    consumeLaser: vi.fn().mockResolvedValue(undefined),
  };
  const operator = {
    emit: vi.fn(),
    disconnectSockets: vi.fn(),
  } as {
    emit: ReturnType<typeof vi.fn>;
    disconnectSockets: ReturnType<typeof vi.fn>;
    volatile?: unknown;
  };
  operator.volatile = operator;
  const server = {
    in: vi.fn().mockReturnValue(operator),
    to: vi.fn().mockReturnValue(operator),
  };
  const gateway = new PresentationCompanionGateway(
    { me: vi.fn().mockResolvedValue({ user: { userId: "user_1" } }) } as never,
    {
      assertCanWriteProject: vi.fn().mockResolvedValue(undefined),
    } as never,
    {
      findActiveCompanionSession: vi.fn().mockResolvedValue({
        session_id: "session_1",
        project_id: "project_1",
      }),
    } as never,
    companion as never,
    publisher as never,
    rateLimit as never,
  );
  gateway.server = server as never;
  return {
    companion,
    gateway,
    operator,
    publisher,
    rateLimit,
    server,
  };
}

function socket(options: {
  cookie: string;
  id: string;
  userAgent?: string;
}) {
  const client = {
    data: {},
    emit: vi.fn(),
    handshake: {
      headers: {
        cookie: options.cookie,
        "user-agent": options.userAgent ?? "Safari",
      },
    },
    id: options.id,
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
  };
  return client as unknown as Socket & typeof client;
}

function annotationCommand() {
  return {
    sessionId: "session_1",
    authorityEpochId: "epoch_1",
    surfaceId: "surface_1",
    clientOperationId: "operation_1",
    baseRevision: 1,
    sequence: 1,
    kind: "stroke-points" as const,
    strokeId: "stroke_1",
    points: [
      {
        x: 0.5,
        y: 0.5,
        pressure: 0.5,
        t: 1,
      },
    ],
  };
}

function companionSignal(kind: "answer" | "offer") {
  return {
    authorityEpochId: "epoch_1",
    kind,
    sdp: `${kind}-sdp`,
    sessionId: "session_1",
    shareEpochId: "share_1",
    signalId: "signal_1",
    targetGeneration: 2,
  };
}
