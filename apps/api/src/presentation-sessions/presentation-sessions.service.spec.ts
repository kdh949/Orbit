import { describe, expect, it, vi } from "vitest";

import type { DecksService } from "../decks/decks.service";
import type { PresentationSessionRepository } from "./presentation-session.repository";
import { PresentationSessionsService } from "./presentation-sessions.service";
import type { PresentationCompanionStore } from "./presentation-companion.store";
import type { PresentationCompanionPublisher } from "./presentation-companion.publisher";

const sessionRow = {
  session_id: "session_existing",
  project_id: "project_1",
  deck_id: "deck_1",
  deck_version: 7,
  presenter_user_id: "user_1",
  created_by: "user_1",
  status: "live" as const,
  session_purpose: "presentation" as const,
  audience_access_enabled: true,
  access_mode: "public" as const,
  session_password_hash: null,
  starts_at: "2026-07-17T00:00:00.000Z",
  expires_at: "2026-07-31T00:00:00.000Z",
  active_activity_run_id: null,
  started_at: "2026-07-17T00:00:00.000Z",
  ended_at: null,
  closed_at: null,
  raw_responses_delete_after: null,
  raw_responses_deleted_at: null,
  results_deleted_at: null,
  created_at: "2026-07-17T00:00:00.000Z",
  updated_at: "2026-07-17T00:00:00.000Z"
};

function createService(
  overrides: Partial<PresentationSessionRepository> = {},
  audienceRateLimit?: { consumeJoin: ReturnType<typeof vi.fn> },
  deckOverrides: Partial<DecksService> = {},
  companionStore?: Partial<PresentationCompanionStore>,
  companionPublisher?: Partial<PresentationCompanionPublisher>,
) {
  const manager = {} as never;
  const repository = {
    transaction: vi.fn(async (work) => work(manager)),
    closeActive: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue(sessionRow),
    findCurrent: vi.fn().mockResolvedValue(sessionRow),
    findCurrentForUpdate: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(sessionRow),
    list: vi.fn().mockResolvedValue([sessionRow]),
    updateAccess: vi.fn().mockResolvedValue(sessionRow),
    close: vi.fn().mockResolvedValue({
      ...sessionRow,
      status: "ended",
      ended_at: "2026-07-17T01:00:00.000Z",
      closed_at: "2026-07-17T01:00:00.000Z",
      raw_responses_delete_after: "2026-10-15T01:00:00.000Z"
    }),
    findAccessibleBySessionId: vi.fn().mockResolvedValue(sessionRow),
    registerAudience: vi.fn().mockResolvedValue(undefined),
    findAudienceInfo: vi.fn().mockResolvedValue({
      ...sessionRow,
      project_title: "ORBIT 발표"
    }),
    ...overrides
  } as unknown as PresentationSessionRepository;
  const decksService = {
    getDeckForUpdate: vi.fn().mockResolvedValue({ deckId: "deck_1", version: 7 }),
    ...deckOverrides
  } as unknown as DecksService;
  const logger = { info: vi.fn() } as never;
  return {
    decksService,
    repository,
    service: new PresentationSessionsService(
      repository,
      decksService,
      logger,
      audienceRateLimit as never,
      companionStore as PresentationCompanionStore,
      companionPublisher as PresentationCompanionPublisher,
    )
  };
}

describe("PresentationSessionsService", () => {
  it("reuses the current session without creating a new row", async () => {
    const { repository, service } = createService();

    await expect(service.getCurrent("project_1", "deck_1")).resolves.toMatchObject({
      session: { sessionId: "session_existing", deckVersion: 7 },
      audienceUrl: "/audience/session_existing"
    });

    expect(repository.findCurrent).toHaveBeenCalledWith(
      "project_1",
      "deck_1",
      "presentation",
    );
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("closes an active session and reads deckVersion from the materialized Deck", async () => {
    const companionStore = { revokeSession: vi.fn() };
    const companionPublisher = { revokeCurrent: vi.fn() };
    const { decksService, repository, service } = createService(
      {
        closeActive: vi.fn().mockResolvedValue(["session_previous"]),
      },
      undefined,
      {},
      companionStore,
      companionPublisher,
    );

    await expect(
      service.create("project_1", "user_1", {
        deckId: "deck_1",
        sessionPurpose: "presentation",
        audienceAccessEnabled: true,
        accessMode: "public"
      })
    ).resolves.toMatchObject({ session: { deckId: "deck_1", deckVersion: 7 } });

    expect(decksService.getDeckForUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "project_1",
      "deck_1"
    );
    expect(repository.closeActive).toHaveBeenCalledWith(
      expect.anything(),
      "project_1",
      "presentation",
      expect.any(Date),
    );
    expect(companionStore.revokeSession).toHaveBeenCalledWith(
      "session_previous",
    );
    expect(companionPublisher.revokeCurrent).toHaveBeenCalledWith(
      "session_previous",
      "session-ended",
    );
    expect(repository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deckId: "deck_1", deckVersion: 7, userId: "user_1" })
    );
  });

  it("reuses the matching live-runtime session without closing audience activity", async () => {
    const { repository, service } = createService({
      findCurrentForUpdate: vi.fn().mockResolvedValue(sessionRow)
    });

    await expect(
      service.create("project_1", "user_1", {
        deckId: "deck_1",
        sessionPurpose: "presentation",
        audienceAccessEnabled: true,
        accessMode: "public",
        reuseCurrent: true
      })
    ).resolves.toMatchObject({
      audienceUrl: "/audience/session_existing",
      session: { sessionId: "session_existing", deckVersion: 7 }
    });

    expect(repository.findCurrentForUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "project_1",
      "deck_1",
      "presentation",
    );
    expect(repository.closeActive).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("does not reuse a session from another deck version", async () => {
    const { repository, service } = createService({
      findCurrentForUpdate: vi.fn().mockResolvedValue({
        ...sessionRow,
        deck_version: 6
      })
    });

    await service.create("project_1", "user_1", {
      deckId: "deck_1",
      sessionPurpose: "presentation",
      audienceAccessEnabled: true,
      accessMode: "public",
      reuseCurrent: true
    });

    expect(repository.closeActive).toHaveBeenCalledOnce();
    expect(repository.insert).toHaveBeenCalledOnce();
  });

  it("keeps the active session when Deck materialization fails", async () => {
    const materializationError = new Error("Stored patch chain is invalid");
    const { repository, service } = createService(
      {},
      undefined,
      { getDeckForUpdate: vi.fn().mockRejectedValue(materializationError) }
    );

    await expect(
      service.create("project_1", "user_1", {
        deckId: "deck_1",
        sessionPurpose: "presentation",
        audienceAccessEnabled: true,
        accessMode: "public"
      })
    ).rejects.toBe(materializationError);

    expect(repository.closeActive).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("creates a companion-only rehearsal session without closing presentation purpose", async () => {
    const rehearsalRow = {
      ...sessionRow,
      session_id: "session_rehearsal",
      session_purpose: "rehearsal" as const,
      audience_access_enabled: false,
    };
    const { repository, service } = createService({
      insert: vi.fn().mockResolvedValue(rehearsalRow),
    });

    await expect(
      service.create("project_1", "user_1", {
        deckId: "deck_1",
        sessionPurpose: "rehearsal",
        audienceAccessEnabled: false,
        reuseCurrent: true,
      }),
    ).resolves.toMatchObject({
      session: {
        sessionPurpose: "rehearsal",
        audienceAccessEnabled: false,
      },
      audienceUrl: null,
    });

    expect(repository.closeActive).toHaveBeenCalledWith(
      expect.anything(),
      "project_1",
      "rehearsal",
      expect.any(Date),
    );
    expect(repository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionPurpose: "rehearsal",
        audienceAccessEnabled: false,
        accessMode: "public",
        passwordHash: null,
      }),
    );
  });

  it("preserves an enabled presentation session during companion-only reuse", async () => {
    const { repository, service } = createService({
      findCurrentForUpdate: vi.fn().mockResolvedValue(sessionRow),
    });

    await expect(
      service.create("project_1", "user_1", {
        deckId: "deck_1",
        sessionPurpose: "presentation",
        audienceAccessEnabled: false,
        reuseCurrent: true,
      }),
    ).resolves.toMatchObject({
      session: { audienceAccessEnabled: true },
      audienceUrl: "/audience/session_existing",
    });

    expect(repository.closeActive).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("returns a current companion-only session without an audience URL", async () => {
    const { service } = createService({
      findCurrent: vi.fn().mockResolvedValue({
        ...sessionRow,
        audience_access_enabled: false,
      }),
    });

    await expect(
      service.getCurrent("project_1", "deck_1", "presentation"),
    ).resolves.toMatchObject({
      session: { audienceAccessEnabled: false },
      audienceUrl: null,
    });
  });

  it("returns archived sessions for the requested deck", async () => {
    const { repository, service } = createService();

    await expect(service.list("project_1", "deck_1")).resolves.toMatchObject({
      sessions: [{ sessionId: "session_existing", deckId: "deck_1" }]
    });
    expect(repository.list).toHaveBeenCalledWith("project_1", "deck_1");
  });

  it("closes a session idempotently through the repository transaction", async () => {
    const companionStore = { revokeSession: vi.fn() };
    const companionPublisher = { revokeCurrent: vi.fn() };
    const { repository, service } = createService(
      {},
      undefined,
      {},
      companionStore,
      companionPublisher,
    );

    await expect(service.close("project_1", "session_existing")).resolves.toMatchObject({
      session: { status: "ended", activeActivityRunId: null }
    });
    expect(repository.close).toHaveBeenCalledWith(
      expect.anything(),
      "project_1",
      "session_existing",
      expect.any(Date)
    );
    expect(companionStore.revokeSession).toHaveBeenCalledWith(
      "session_existing",
    );
    expect(companionPublisher.revokeCurrent).toHaveBeenCalledWith(
      "session_existing",
      "session-ended",
    );
  });

  it("allows a public audience session to join without a passcode", async () => {
    const audienceRateLimit = { consumeJoin: vi.fn() };
    const { repository, service } = createService({}, audienceRateLimit);

    await expect(
      service.joinAudience(
        "session_existing",
        {},
        "audience_1",
        "203.0.113.10"
      )
    ).resolves.toMatchObject({
      verified: true,
      session: {
        sessionId: "session_existing",
        deckId: "deck_1",
        accessMode: "public"
      }
    });
    expect(audienceRateLimit.consumeJoin).not.toHaveBeenCalled();
    expect(repository.registerAudience).toHaveBeenCalledWith(
      "project_1",
      "session_existing",
      "audience_1"
    );
  });

  it("returns the fixed 429 before verifying an excessive passcode attempt", async () => {
    const limitError = Object.assign(new Error("Too many audience requests"), {
      status: 429
    });
    const audienceRateLimit = {
      consumeJoin: vi.fn().mockRejectedValue(limitError)
    };
    const { service } = createService(
      {
        findAccessibleBySessionId: vi.fn().mockResolvedValue({
          ...sessionRow,
          access_mode: "passcode",
          session_password_hash: "hash"
        })
      },
      audienceRateLimit
    );

    await expect(
      service.joinAudience(
        "session_existing",
        { passcode: "wrong-passcode" },
        "audience_1",
        "203.0.113.10"
      )
    ).rejects.toBe(limitError);
    expect(audienceRateLimit.consumeJoin).toHaveBeenCalledWith(
      "session_existing",
      "203.0.113.10"
    );
  });

  it("uses one generalized error for a closed session or invalid access", async () => {
    const { service } = createService({
      findAccessibleBySessionId: vi.fn().mockResolvedValue(null)
    });

    await expect(
      service.joinAudience("session_closed", {}, "audience_1")
    ).rejects.toMatchObject({
      message: "Invalid audience session or passcode"
    });
  });

  it("does not expose public info for a companion-only session", async () => {
    const { service } = createService({
      findAudienceInfo: vi.fn().mockResolvedValue({
        ...sessionRow,
        audience_access_enabled: false,
        project_title: "비공개 발표",
      }),
    });

    await expect(
      service.getAudiencePublicInfo("session_existing"),
    ).rejects.toMatchObject({ message: "Audience session unavailable" });
  });

  it("rejects enabling audience access on a rehearsal session", async () => {
    const { repository, service } = createService({
      findById: vi.fn().mockResolvedValue({
        ...sessionRow,
        session_purpose: "rehearsal",
        audience_access_enabled: false,
      }),
    });

    await expect(
      service.updateAccess("project_1", "session_existing", {
        audienceAccessEnabled: true,
        accessMode: "public",
        startsAt: "2026-07-17T00:00:00.000Z",
        expiresAt: "2026-07-18T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      message: "Rehearsal sessions cannot enable audience access",
    });
    expect(repository.updateAccess).not.toHaveBeenCalled();
  });

  it("reports a future session as scheduled without exposing project identity", async () => {
    const { service } = createService({
      findAudienceInfo: vi.fn().mockResolvedValue({
        ...sessionRow,
        status: "draft",
        project_title: "ORBIT 발표",
        starts_at: "2026-07-18T00:00:00.000Z"
      })
    });

    await expect(
      service.getAudiencePublicInfo("session_existing", new Date("2026-07-17T00:00:00.000Z"))
    ).resolves.toEqual({
      session: {
        sessionId: "session_existing",
        title: "ORBIT 발표",
        accessMode: "public",
        startsAt: "2026-07-18T00:00:00.000Z",
        expiresAt: "2026-07-31T00:00:00.000Z",
        availability: "scheduled"
      }
    });
  });

  it("rejects an access cookie bound to another project", async () => {
    const { service } = createService();

    await expect(
      service.getAudienceAccess("session_existing", "project_other")
    ).rejects.toMatchObject({ message: "Audience access required" });
  });
});
