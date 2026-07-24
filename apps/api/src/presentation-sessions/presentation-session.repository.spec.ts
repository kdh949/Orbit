import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { PresentationSessionRepository } from "./presentation-session.repository";

describe("PresentationSessionRepository", () => {
  it("qualifies session columns in the audience project join", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new PresentationSessionRepository({ query } as unknown as DataSource);

    await repository.findAudienceInfo("session_1");

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("sessions.project_id");
    expect(sql).toContain("projects.title AS project_title");
    expect(sql).toContain("WHERE sessions.session_id = $1");
  });

  it("locks the current session while a live runtime is being reused", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new PresentationSessionRepository({} as DataSource);

    await repository.findCurrentForUpdate(
      { query } as never,
      "project_1",
      "deck_1",
      "presentation",
    );

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("status IN ('draft', 'live')");
    expect(sql).toContain("expires_at > now()");
    expect(sql).toContain("session_purpose = $3");
    expect(sql).toContain("FOR UPDATE");
  });

  it("casts the shared close timestamp before adding the retention interval", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ session_id: "session_1" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const repository = new PresentationSessionRepository({} as DataSource);

    await repository.closeActive(
      { query } as never,
      "project_1",
      "presentation",
      new Date("2026-07-17T01:00:00.000Z")
    );

    const closeSql = String(query.mock.calls[2]?.[0]);
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "session_purpose = $2",
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      "project_1",
      "presentation",
    ]);
    expect(closeSql).toContain("raw_responses_delete_after = $2::timestamptz");
    expect(closeSql).toContain("updated_at = $2::timestamptz");
  });

  it("reloads the canonical session row after closing", async () => {
    const live = { session_id: "session_1", status: "live" };
    const ended = { ...live, deck_id: "deck_1", deck_version: 1, status: "ended" };
    const query = vi
      .fn()
      .mockResolvedValueOnce([live])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([ended]);
    const repository = new PresentationSessionRepository({} as DataSource);

    await expect(
      repository.close(
        { query } as never,
        "project_1",
        "session_1",
        new Date("2026-07-17T01:00:00.000Z")
      )
    ).resolves.toEqual(ended);

    expect(String(query.mock.calls[3]?.[0])).toContain(
      "WHERE project_id = $1 AND session_id = $2"
    );
    expect(String(query.mock.calls[3]?.[0])).not.toContain("FOR UPDATE");
  });

  it("registers a successful audience join idempotently", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new PresentationSessionRepository({ query } as unknown as DataSource);

    await repository.registerAudience(
      "project_1",
      "session_1",
      "audience_1",
      new Date("2026-07-17T01:00:00.000Z")
    );

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("INSERT INTO presentation_session_audiences");
    expect(sql).toContain(
      "ON CONFLICT (project_id, session_id, audience_id) DO NOTHING"
    );
  });

  it("atomically promotes a scheduled session when its access window opens", async () => {
    const query = vi.fn().mockResolvedValue([{ session_id: "session_scheduled", status: "live" }]);
    const repository = new PresentationSessionRepository({ query } as unknown as DataSource);
    const now = new Date("2026-07-17T01:00:00.000Z");

    await expect(
      repository.findAccessibleBySessionId("session_scheduled", now)
    ).resolves.toMatchObject({ status: "live" });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("WITH activated AS");
    expect(sql).toContain("status = 'draft'");
    expect(sql).toContain("started_at = COALESCE(started_at, starts_at)");
    expect(sql).toContain("expires_at > $2");
    expect(sql).toContain("audience_access_enabled = true");
    expect(query.mock.calls[0]?.[1]).toEqual(["session_scheduled", now]);
  });

  it("finds an unexpired companion session without requiring audience access", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        session_id: "session_companion",
        audience_access_enabled: false,
        status: "live",
      },
    ]);
    const repository = new PresentationSessionRepository({
      query,
    } as unknown as DataSource);
    const now = new Date("2026-07-17T01:00:00.000Z");

    await expect(
      repository.findActiveCompanionSession("session_companion", now),
    ).resolves.toMatchObject({
      audience_access_enabled: false,
      status: "live",
    });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("status IN ('draft', 'live')");
    expect(sql).toContain("expires_at > $2");
    expect(sql).not.toContain("audience_access_enabled = true");
    expect(query.mock.calls[0]?.[1]).toEqual(["session_companion", now]);
  });

  it("sets the natural-expiry retention deadline when creating and updating sessions", async () => {
    const inserted = { session_id: "session_1", status: "draft" };
    const query = vi.fn().mockResolvedValue([inserted]);
    const repository = new PresentationSessionRepository({} as DataSource);
    const manager = { query } as never;
    const now = new Date("2026-07-17T00:00:00.000Z");
    const expiresAt = new Date("2026-07-18T00:00:00.000Z");

    await repository.insert(manager, {
      sessionId: "session_1",
      projectId: "project_1",
      deckId: "deck_1",
      deckVersion: 1,
      userId: "user_1",
      status: "draft",
      sessionPurpose: "presentation",
      audienceAccessEnabled: true,
      accessMode: "public",
      passwordHash: null,
      startsAt: new Date("2026-07-17T01:00:00.000Z"),
      expiresAt,
      now,
    });
    await repository.updateAccess(manager, "project_1", "session_1", {
      audienceAccessEnabled: true,
      status: "draft",
      accessMode: "public",
      passwordHash: null,
      startsAt: new Date("2026-07-17T02:00:00.000Z"),
      expiresAt,
      now,
    });

    expect(String(query.mock.calls[0]?.[0])).toContain(
      "$6::timestamptz + interval '90 days'",
    );
    expect(String(query.mock.calls[1]?.[0])).toContain(
      "$7::timestamptz + interval '90 days'",
    );
  });

  it("disables audience access without changing the session window", async () => {
    const query = vi.fn().mockResolvedValue([{ session_id: "session_1" }]);
    const repository = new PresentationSessionRepository({} as DataSource);

    await repository.updateAccess(
      { query } as never,
      "project_1",
      "session_1",
      {
        audienceAccessEnabled: false,
        now: new Date("2026-07-17T00:00:00.000Z"),
      },
    );

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("audience_access_enabled = false");
    expect(sql).toContain("session_password_hash = NULL");
    expect(sql).not.toContain("starts_at =");
  });
});
