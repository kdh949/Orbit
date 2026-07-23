import { describe, expect, it, vi } from "vitest";

import type { DecksService } from "../decks/decks.service";
import type { PresentationSessionRepository } from "./presentation-session.repository";
import { PresentationPasscodeCipher } from "./presentation-passcode-cipher";
import { PresentationSessionsService } from "./presentation-sessions.service";

const sessionRow = {
  session_id: "session_existing",
  project_id: "project_1",
  deck_id: "deck_1",
  deck_version: 7,
  presenter_user_id: "user_1",
  created_by: "user_1",
  status: "live" as const,
  access_mode: "public" as const,
  session_password_hash: null,
  session_password_display_ciphertext: null,
  session_password_key_version: null,
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
  passcodeCipher?: PresentationPasscodeCipher
) {
  const manager = {} as never;
  const repository = {
    transaction: vi.fn(async (work) => work(manager)),
    closeActive: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue(sessionRow),
    findCurrent: vi.fn().mockResolvedValue(sessionRow),
    findCurrentForUpdate: vi.fn().mockResolvedValue(null),
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
    findByIdForRead: vi.fn().mockResolvedValue(sessionRow),
    ...overrides
  } as unknown as PresentationSessionRepository;
  const decksService = {
    getDeckForUpdate: vi.fn().mockResolvedValue({ deckId: "deck_1", version: 7 }),
    ...deckOverrides
  } as unknown as DecksService;
  const logger = { info: vi.fn(), warn: vi.fn() } as never;
  return {
    decksService,
    repository,
    service: new PresentationSessionsService(
      repository,
      decksService,
      logger,
      audienceRateLimit as never,
      passcodeCipher
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

    expect(repository.findCurrent).toHaveBeenCalledWith("project_1", "deck_1");
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("closes an active session and reads deckVersion from the materialized Deck", async () => {
    const { decksService, repository, service } = createService({
      closeActive: vi.fn().mockResolvedValue(["session_previous"])
    });

    await expect(
      service.create("project_1", "user_1", {
        deckId: "deck_1",
        accessMode: "public"
      })
    ).resolves.toMatchObject({ session: { deckId: "deck_1", deckVersion: 7 } });

    expect(decksService.getDeckForUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "project_1",
      "deck_1"
    );
    expect(repository.closeActive).toHaveBeenCalledWith(expect.anything(), "project_1", expect.any(Date));
    expect(repository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deckId: "deck_1", deckVersion: 7, userId: "user_1" })
    );
  });

  it("stores only encrypted presenter display data beside the Argon2 hash", async () => {
    const passcodeCipher = new PresentationPasscodeCipher({
      key: Buffer.alloc(32, 5),
      version: 4
    });
    const { repository, service } = createService(
      {},
      undefined,
      {},
      passcodeCipher
    );

    await service.create("project_1", "user_1", {
      deckId: "deck_1",
      accessMode: "passcode",
      passcode: "4821"
    });

    expect(repository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        passwordKeyVersion: 4,
        passwordDisplayCiphertext: expect.not.stringContaining("4821"),
        passwordHash: expect.any(String)
      })
    );
  });

  it("returns a decrypted passcode only through presenter access", async () => {
    const passcodeCipher = new PresentationPasscodeCipher({
      key: Buffer.alloc(32, 5),
      version: 4
    });
    const encrypted = passcodeCipher.encrypt("4821", "session_existing");
    const { service } = createService(
      {
        findByIdForRead: vi.fn().mockResolvedValue({
          ...sessionRow,
          access_mode: "passcode",
          session_password_hash: "argon2-hash",
          session_password_display_ciphertext: encrypted.ciphertext,
          session_password_key_version: encrypted.keyVersion
        })
      },
      undefined,
      {},
      passcodeCipher
    );

    await expect(
      service.getPresenterAccess("project_1", "session_existing")
    ).resolves.toEqual({
      accessMode: "passcode",
      displayPasscode: "4821"
    });
  });

  it("reuses the matching live-runtime session without closing audience activity", async () => {
    const { repository, service } = createService({
      findCurrentForUpdate: vi.fn().mockResolvedValue(sessionRow)
    });

    await expect(
      service.create("project_1", "user_1", {
        deckId: "deck_1",
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
      "deck_1"
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
        accessMode: "public"
      })
    ).rejects.toBe(materializationError);

    expect(repository.closeActive).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("returns archived sessions for the requested deck", async () => {
    const { repository, service } = createService();

    await expect(service.list("project_1", "deck_1")).resolves.toMatchObject({
      sessions: [{ sessionId: "session_existing", deckId: "deck_1" }]
    });
    expect(repository.list).toHaveBeenCalledWith("project_1", "deck_1");
  });

  it("closes a session idempotently through the repository transaction", async () => {
    const { repository, service } = createService();

    await expect(service.close("project_1", "session_existing")).resolves.toMatchObject({
      session: { status: "ended", activeActivityRunId: null }
    });
    expect(repository.close).toHaveBeenCalledWith(
      expect.anything(),
      "project_1",
      "session_existing",
      expect.any(Date)
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
