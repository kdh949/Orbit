import type { DataSource, EntityManager } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { ActivityResponseRepository } from "./activity-response.repository";
import { ActivityResultsRepository } from "./activity-results.repository";
import { ActivityRunRepository } from "./activity-run.repository";

describe("Activity SQL returning projections", () => {
  it("reads session identity before locking the session without joining raw Deck JSON", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ deck_id: "deck_1" }])
      .mockResolvedValueOnce([{ session_id: "session_1", deck_id: "deck_1" }]);
    const repository = new ActivityRunRepository({} as DataSource);
    const manager = { query } as unknown as EntityManager;

    await repository.findSessionIdentity(manager, "project_1", "session_1");
    await repository.lockSession(manager, "project_1", "session_1");

    const identitySql = String(query.mock.calls[0]?.[0]);
    const lockSql = String(query.mock.calls[1]?.[0]);
    expect(identitySql).not.toContain("FOR UPDATE");
    expect(lockSql).toContain("FOR UPDATE");
    expect(lockSql).not.toContain("JOIN decks");
    expect(lockSql).not.toContain("deck_json");
  });

  it("wraps run status UPDATE RETURNING in a SELECT-shaped CTE", async () => {
    const query = vi.fn().mockResolvedValue([{ activity_run_id: "activity_run_1" }]);
    const repository = new ActivityRunRepository({} as DataSource);

    await repository.updateStatus(
      { query } as unknown as EntityManager,
      "activity_run_1",
      "open",
      new Date("2026-07-17T00:00:00.000Z")
    );

    expect(query.mock.calls[0]?.[0]).toContain("WITH updated AS");
    expect(query.mock.calls[0]?.[0]).toContain("SELECT * FROM updated");
  });

  it("reads a scalar run revision from a SELECT-shaped CTE", async () => {
    const query = vi.fn().mockResolvedValue([{ revision: 3 }]);
    const repository = new ActivityResponseRepository({} as DataSource);

    await expect(
      repository.bumpRunRevision(
        { query } as unknown as EntityManager,
        "activity_run_1",
        true,
        new Date("2026-07-17T00:00:00.000Z")
      )
    ).resolves.toBe(3);
    expect(query.mock.calls[0]?.[0]).toContain("SELECT revision FROM updated");
  });

  it("counts the anonymous participants registered for one session", async () => {
    const query = vi.fn().mockResolvedValue([{ participant_count: 12 }]);
    const repository = new ActivityResultsRepository({ query } as unknown as DataSource);

    await expect(
      repository.countSessionAudiences("project_1", "session_1")
    ).resolves.toBe(12);
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "FROM presentation_session_audiences"
    );
  });

  it("deletes participant identifiers with an owner-requested result deletion", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ results_deleted_at: null }])
      .mockResolvedValue([]);
    const repository = new ActivityResultsRepository({} as DataSource);

    await repository.hardDeleteSessionResults(
      { query } as unknown as EntityManager,
      "project_1",
      "session_1",
      new Date("2026-07-17T00:00:00.000Z")
    );

    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM presentation_session_audiences")
      )
    ).toBe(true);
  });
});
