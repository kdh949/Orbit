import { describe, expect, it, vi } from "vitest";

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({
    SESSION_SECRET: "presentation-companion-service-secret",
  }),
}));

import type { PresentationCompanionProjectionService } from "./presentation-companion-projection.service";
import { PresentationCompanionService } from "./presentation-companion.service";
import type { PresentationSessionRepository } from "./presentation-session.repository";
import type { PresentationCompanionStore } from "./presentation-companion.store";

const now = new Date("2026-07-23T00:00:00.000Z");
const sessionRow = {
  session_id: "session_1",
  project_id: "project_1",
  deck_id: "deck_1",
  deck_version: 4,
  presenter_user_id: "user_1",
  created_by: "user_1",
  status: "live" as const,
  session_purpose: "presentation" as const,
  audience_access_enabled: false,
  access_mode: "public" as const,
  session_password_hash: null,
  starts_at: now.toISOString(),
  expires_at: "2026-07-23T08:00:00.000Z",
  active_activity_run_id: null,
  started_at: now.toISOString(),
  ended_at: null,
  closed_at: null,
  raw_responses_delete_after: null,
  raw_responses_deleted_at: null,
  results_deleted_at: null,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
};

function createFixture() {
  let generation = 0;
  const pairings = new Map<string, typeof sessionRow>();
  const store = {
    putPairing: vi.fn(async (code: string) => {
      pairings.set(code, sessionRow);
    }),
    consumePairing: vi.fn(async (code: string) => {
      if (!pairings.has(code)) return null;
      pairings.delete(code);
      return {
        sessionId: sessionRow.session_id,
        projectId: sessionRow.project_id,
        deckId: sessionRow.deck_id,
        deckVersion: sessionRow.deck_version,
        sessionExpiresAt: sessionRow.expires_at,
      };
    }),
    issueGeneration: vi.fn(async () => {
      const previousGeneration = generation > 0 ? generation : null;
      generation += 1;
      return { generation, previousGeneration };
    }),
    getLatestGeneration: vi.fn(async () =>
      generation > 0 ? generation : null,
    ),
    revokeSession: vi.fn(async () => {
      generation = 0;
    }),
    getAuthority: vi.fn().mockResolvedValue(null),
    getPresence: vi.fn().mockResolvedValue(null),
    claimAuthority: vi.fn().mockResolvedValue(true),
    heartbeatAuthority: vi.fn().mockResolvedValue(true),
    renewPresence: vi.fn().mockResolvedValue(undefined),
    clearPresence: vi.fn().mockResolvedValue(undefined),
  } as unknown as PresentationCompanionStore;
  const sessions = {
    findActiveCompanionSession: vi.fn().mockResolvedValue(sessionRow),
  } as unknown as PresentationSessionRepository;
  const projection = {
    getDeckProjection: vi.fn().mockResolvedValue({
      deck: {
        deckId: "deck_1",
        projectId: "project_1",
        version: 4,
        canvas: {
          preset: "wide-16-9",
          width: 1920,
          height: 1080,
          aspectRatio: "16:9",
        },
        theme: {},
        slides: [
          {
            slideId: "slide_1",
            kind: "content",
            order: 1,
            style: {},
            elements: [],
            animations: [],
            triggerAnimationIds: [],
          },
        ],
      },
      referencedAssetIds: new Set(),
    }),
  } as unknown as PresentationCompanionProjectionService;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  };
  const publisher = {
    revokeCurrent: vi.fn().mockResolvedValue(undefined),
    revokeGeneration: vi.fn().mockResolvedValue(undefined),
  };
  return {
    logger,
    publisher,
    projection,
    service: new PresentationCompanionService(
      store,
      sessions,
      projection,
      logger as never,
      publisher as never,
    ),
    sessions,
    store,
  };
}

describe("PresentationCompanionService", () => {
  it("creates a 256-bit single-use pairing without exposing it to Redis keys", async () => {
    const fixture = createFixture();
    const result = await fixture.service.createPairing(
      "project_1",
      "session_1",
      now,
    );

    expect(Buffer.from(result.code, "base64url")).toHaveLength(32);
    expect(result.expiresAt).toBe("2026-07-23T00:02:00.000Z");
    expect(fixture.store.putPairing).toHaveBeenCalledWith(
      result.code,
      {
        sessionId: "session_1",
        projectId: "project_1",
        deckId: "deck_1",
        deckVersion: 4,
        sessionExpiresAt: "2026-07-23T08:00:00.000Z",
      },
      120,
    );
    expect(fixture.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "presentation_companion.pairing_created",
        presentationSessionId: "session_1",
      }),
      expect.any(String),
    );
    expect(JSON.stringify(fixture.logger.info.mock.calls)).not.toContain(
      result.code,
    );
  });

  it("returns only safe bootstrap fields and fail-closed status", async () => {
    const fixture = createFixture();
    const pairing = await fixture.service.createPairing(
      "project_1",
      "session_1",
      now,
    );
    const exchange = await fixture.service.exchangePairing(
      pairing.code,
      "iPad Safari",
      now,
    );

    await expect(
      fixture.service.getBootstrap(
        exchange.token,
        "iPad Safari",
        "session_1",
        now,
      ),
    ).resolves.toMatchObject({
      sessionId: "session_1",
      sessionPurpose: "presentation",
      scopes: ["view-audience-output", "write-annotation"],
      deck: { deckId: "deck_1", version: 4 },
    });
    await expect(
      fixture.service.getStatus("project_1", "session_1", now),
    ).resolves.toEqual({
      connected: false,
      pairingGeneration: 1,
      connectedAt: null,
      rttBucket: null,
    });
    await expect(
      fixture.service.getStatus("project_other", "session_1", now),
    ).rejects.toMatchObject({
      message: "Presentation companion unavailable",
    });
  });

  it("consumes a pairing once and caps credential expiry at four hours", async () => {
    const fixture = createFixture();
    const { code } = await fixture.service.createPairing(
      "project_1",
      "session_1",
      now,
    );

    const exchange = await fixture.service.exchangePairing(
      code,
      "iPad Safari",
      now,
    );
    expect(exchange.credential).toMatchObject({
      sessionId: "session_1",
      pairingGeneration: 1,
      expiresAt: "2026-07-23T04:00:00.000Z",
    });
    const serializedLogs = JSON.stringify(fixture.logger.info.mock.calls);
    expect(serializedLogs).not.toContain(code);
    expect(serializedLogs).not.toContain(exchange.token);
    expect(serializedLogs).not.toContain("iPad Safari");
    await expect(
      fixture.service.exchangePairing(code, "iPad Safari", now),
    ).rejects.toMatchObject({
      message: "Presentation companion unavailable",
    });
  });

  it("invalidates the previous credential when a replacement exchange increments generation", async () => {
    const fixture = createFixture();
    const firstPairing = await fixture.service.createPairing(
      "project_1",
      "session_1",
      now,
    );
    const first = await fixture.service.exchangePairing(
      firstPairing.code,
      "iPad Safari",
      now,
    );
    const secondPairing = await fixture.service.createPairing(
      "project_1",
      "session_1",
      now,
    );
    const second = await fixture.service.exchangePairing(
      secondPairing.code,
      "iPad Safari",
      now,
    );
    expect(fixture.publisher.revokeGeneration).toHaveBeenCalledWith(
      "session_1",
      1,
      "replaced",
    );
    expect(fixture.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "presentation_companion.replaced",
        presentationSessionId: "session_1",
        previousGeneration: 1,
        pairingGeneration: 2,
      }),
      expect.any(String),
    );

    await expect(
      fixture.service.verifyCredential(
        first.token,
        "iPad Safari",
        "session_1",
        now,
      ),
    ).resolves.toBeNull();
    await expect(
      fixture.service.verifyCredential(
        second.token,
        "iPad Safari",
        "session_1",
        now,
      ),
    ).resolves.toMatchObject({ pairingGeneration: 2 });
  });

  it("revokes the preceding generation when pairing exchanges race", async () => {
    const fixture = createFixture();
    const firstPairing = await fixture.service.createPairing(
      "project_1",
      "session_1",
      now,
    );
    const secondPairing = await fixture.service.createPairing(
      "project_1",
      "session_1",
      now,
    );

    const exchanges = await Promise.all([
      fixture.service.exchangePairing(
        firstPairing.code,
        "iPad Safari",
        now,
      ),
      fixture.service.exchangePairing(
        secondPairing.code,
        "iPad Safari",
        now,
      ),
    ]);

    expect(
      exchanges.map(({ credential }) => credential.pairingGeneration),
    ).toEqual([1, 2]);
    expect(fixture.publisher.revokeGeneration).toHaveBeenCalledTimes(1);
    expect(fixture.publisher.revokeGeneration).toHaveBeenCalledWith(
      "session_1",
      1,
      "replaced",
    );
  });

  it("records only bounded identifiers and reason enums for operations", () => {
    const fixture = createFixture();

    fixture.service.recordConnected({
      companionId: "companion_opaque_1",
      pairingGeneration: 2,
      sessionId: "session_1",
    });
    fixture.service.recordDisconnected({
      pairingGeneration: 2,
      sessionId: "session_1",
    });
    fixture.service.recordCommandRejected({
      reasonCode: "RATE_LIMITED",
      sessionId: "session_1",
    });
    fixture.service.recordWebRtcFailed({
      pairingGeneration: 2,
      sessionId: "session_1",
    });

    const serialized = JSON.stringify({
      info: fixture.logger.info.mock.calls,
      warn: fixture.logger.warn.mock.calls,
    });
    expect(serialized).toContain("presentation_companion.connected");
    expect(serialized).toContain(
      "presentation_companion.command_rejected",
    );
    expect(serialized).toContain(
      "presentation_companion.webrtc_failed",
    );
    expect(serialized).not.toMatch(
      /cookie|token|sdp|candidate|points|speakerNotes|transcript/i,
    );
  });

  it("fails closed for another user-agent, ended session, and revoke", async () => {
    const fixture = createFixture();
    const pairing = await fixture.service.createPairing(
      "project_1",
      "session_1",
      now,
    );
    const exchange = await fixture.service.exchangePairing(
      pairing.code,
      "iPad Safari",
      now,
    );

    await expect(
      fixture.service.verifyCredential(
        exchange.token,
        "Desktop Safari",
        "session_1",
        now,
      ),
    ).resolves.toBeNull();

    vi.mocked(
      fixture.sessions.findActiveCompanionSession,
    ).mockResolvedValueOnce(null);
    await expect(
      fixture.service.verifyCredential(
        exchange.token,
        "iPad Safari",
        "session_1",
        now,
      ),
    ).resolves.toBeNull();

    await fixture.service.revokeSession("session_1");
    expect(fixture.publisher.revokeCurrent).toHaveBeenCalledWith(
      "session_1",
      "disconnected",
    );
    await expect(
      fixture.service.verifyCredential(
        exchange.token,
        "iPad Safari",
        "session_1",
        now,
      ),
    ).resolves.toBeNull();
  });

  it("keeps Deck projection validation out of realtime credential checks", async () => {
    const fixture = createFixture();
    const pairing = await fixture.service.createPairing(
      "project_1",
      "session_1",
      now,
    );
    const exchange = await fixture.service.exchangePairing(
      pairing.code,
      "iPad Safari",
      now,
    );
    vi.mocked(fixture.projection.getDeckProjection).mockClear();

    await expect(
      fixture.service.verifyCredential(
        exchange.token,
        "iPad Safari",
        "session_1",
        now,
      ),
    ).resolves.toMatchObject({
      deckId: "deck_1",
      deckVersion: 4,
      pairingGeneration: 1,
    });
    expect(fixture.projection.getDeckProjection).not.toHaveBeenCalled();

    await fixture.service.getBootstrap(
      exchange.token,
      "iPad Safari",
      "session_1",
      now,
    );
    expect(fixture.projection.getDeckProjection).toHaveBeenCalledTimes(1);
  });
});
