import type { ModerateActivityTextRequest } from "@orbit/shared/activities";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";

export type ActivityTextModerationTarget = {
  activity_id: string;
  activity_run_id: string;
  revision: number;
};

@Injectable()
export class ActivityTextModerationRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  async lockTarget(
    manager: EntityManager,
    projectId: string,
    sessionId: string,
    entryId: string
  ): Promise<ActivityTextModerationTarget | null> {
    const rows = await manager.query<ActivityTextModerationTarget[]>(
      `
        SELECT runs.activity_run_id, runs.activity_id, runs.revision
        FROM activity_text_entries AS entries
        INNER JOIN activity_responses AS responses
          ON responses.project_id = entries.project_id
         AND responses.response_id = entries.response_id
        INNER JOIN activity_runs AS runs
          ON runs.project_id = responses.project_id
         AND runs.activity_run_id = responses.activity_run_id
        INNER JOIN presentation_sessions AS sessions
          ON sessions.project_id = runs.project_id
         AND sessions.session_id = runs.session_id
        WHERE entries.project_id = $1 AND runs.session_id = $2 AND entries.entry_id = $3
          AND sessions.results_deleted_at IS NULL
        FOR UPDATE OF runs, entries
      `,
      [projectId, sessionId, entryId]
    );
    return rows[0] ?? null;
  }

  async updateEntry(
    manager: EntityManager,
    entryId: string,
    input: ModerateActivityTextRequest,
    now: Date
  ): Promise<void> {
    await manager.query(
      `
        UPDATE activity_text_entries
        SET moderation_status = COALESCE($2, moderation_status),
            answered_at = CASE
              WHEN $3::boolean IS NULL THEN answered_at
              WHEN $3 THEN $4
              ELSE NULL
            END,
            revision = revision + 1,
            updated_at = $4
        WHERE entry_id = $1
      `,
      [entryId, input.moderationStatus ?? null, input.answered ?? null, now]
    );
  }

  async bumpRunRevision(
    manager: EntityManager,
    runId: string,
    now: Date
  ): Promise<number> {
    const rows = await manager.query<Array<{ revision: number }>>(
      `
        WITH updated AS (
          UPDATE activity_runs
          SET revision = revision + 1, updated_at = $2
          WHERE activity_run_id = $1
          RETURNING revision
        )
        SELECT revision FROM updated
      `,
      [runId, now]
    );
    return rows[0]?.revision ?? 0;
  }
}
