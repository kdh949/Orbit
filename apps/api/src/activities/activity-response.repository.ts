import type { ActivityAnswer } from "@orbit/shared/activities";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";

export type ActivityResponseTargetRow = {
  activity_run_id: string;
  project_id: string;
  session_id: string;
  activity_id: string;
  definition_snapshot: unknown;
  status: "open";
  revision: number;
};

export type ActivityResponseCommitTargetRow = Pick<
  ActivityResponseTargetRow,
  "activity_run_id" | "revision"
>;

export type ActivityResponseRow = {
  response_id: string;
  project_id: string;
  activity_run_id: string;
  audience_id: string;
  answers_json: unknown;
  display_name: string | null;
  last_client_mutation_id: string;
  revision: number;
  submitted_at: Date | string;
  updated_at: Date | string;
};

export type ActivityTextEntryRow = {
  entry_id: string;
  question_id: string;
  text_value: string;
};

const responseColumns = `
  response_id, project_id, activity_run_id, audience_id, answers_json,
  display_name, last_client_mutation_id, revision, submitted_at, updated_at
`;

@Injectable()
export class ActivityResponseRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  async findTarget(
    manager: EntityManager,
    projectId: string,
    sessionId: string,
    activityId: string
  ): Promise<ActivityResponseTargetRow | null> {
    const rows = await manager.query<ActivityResponseTargetRow[]>(
      `
        SELECT runs.activity_run_id, runs.project_id, runs.session_id, runs.activity_id,
               runs.definition_snapshot, runs.status, runs.revision
        FROM activity_runs AS runs
        INNER JOIN presentation_sessions AS sessions
          ON sessions.project_id = runs.project_id AND sessions.session_id = runs.session_id
        WHERE runs.project_id = $1 AND runs.session_id = $2 AND runs.activity_id = $3
          AND runs.is_current AND runs.status = 'open'
          AND sessions.status = 'live'
          AND sessions.results_deleted_at IS NULL
          AND sessions.starts_at <= now() AND sessions.expires_at > now()
      `,
      [projectId, sessionId, activityId]
    );
    return rows[0] ?? null;
  }

  async lockAudienceMutation(
    manager: EntityManager,
    runId: string,
    audienceId: string
  ): Promise<void> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`, [
      runId,
      audienceId
    ]);
  }

  async lockTargetForCommit(
    manager: EntityManager,
    projectId: string,
    sessionId: string,
    activityId: string,
    runId: string
  ): Promise<ActivityResponseCommitTargetRow | null> {
    const rows = await manager.query<ActivityResponseCommitTargetRow[]>(
      `
        SELECT runs.activity_run_id, runs.revision
        FROM activity_runs AS runs
        INNER JOIN presentation_sessions AS sessions
          ON sessions.project_id = runs.project_id AND sessions.session_id = runs.session_id
        WHERE runs.project_id = $1 AND runs.session_id = $2 AND runs.activity_id = $3
          AND runs.activity_run_id = $4
          AND runs.is_current AND runs.status = 'open'
          AND sessions.status = 'live'
          AND sessions.results_deleted_at IS NULL
          AND sessions.starts_at <= now() AND sessions.expires_at > now()
        FOR UPDATE OF runs
      `,
      [projectId, sessionId, activityId, runId]
    );
    return rows[0] ?? null;
  }

  async findForAudience(
    manager: EntityManager,
    projectId: string,
    runId: string,
    audienceId: string
  ): Promise<ActivityResponseRow | null> {
    const rows = await manager.query<ActivityResponseRow[]>(
      `
        SELECT ${responseColumns}
        FROM activity_responses
        WHERE project_id = $1 AND activity_run_id = $2 AND audience_id = $3
        LIMIT 1
      `,
      [projectId, runId, audienceId]
    );
    return rows[0] ?? null;
  }

  async insert(
    manager: EntityManager,
    input: {
      responseId: string;
      projectId: string;
      runId: string;
      audienceId: string;
      answers: ActivityAnswer[];
      displayName: string | null;
      mutationId: string;
      now: Date;
    }
  ): Promise<ActivityResponseRow> {
    const rows = await manager.query<ActivityResponseRow[]>(
      `
        INSERT INTO activity_responses (
          response_id, project_id, activity_run_id, audience_id, answers_json,
          display_name, last_client_mutation_id, revision, submitted_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 1, $8, $8)
        RETURNING ${responseColumns}
      `,
      [
        input.responseId,
        input.projectId,
        input.runId,
        input.audienceId,
        JSON.stringify(input.answers),
        input.displayName,
        input.mutationId,
        input.now
      ]
    );
    return rows[0];
  }

  async update(
    manager: EntityManager,
    responseId: string,
    answers: ActivityAnswer[],
    displayName: string | null,
    mutationId: string,
    now: Date
  ): Promise<ActivityResponseRow> {
    const rows = await manager.query<ActivityResponseRow[]>(
      `
        WITH updated AS (
          UPDATE activity_responses
          SET answers_json = $2::jsonb, display_name = $3,
              last_client_mutation_id = $4, revision = revision + 1, updated_at = $5
          WHERE response_id = $1
          RETURNING ${responseColumns}
        )
        SELECT * FROM updated
      `,
      [responseId, JSON.stringify(answers), displayName, mutationId, now]
    );
    return rows[0];
  }

  listTextEntries(manager: EntityManager, responseId: string) {
    return manager.query<ActivityTextEntryRow[]>(
      `SELECT entry_id, question_id, text_value FROM activity_text_entries WHERE response_id = $1`,
      [responseId]
    );
  }

  async upsertTextEntry(
    manager: EntityManager,
    input: {
      entryId: string;
      projectId: string;
      responseId: string;
      questionId: string;
      text: string;
      now: Date;
    }
  ): Promise<void> {
    await manager.query(
      `
        INSERT INTO activity_text_entries (
          entry_id, project_id, response_id, question_id, text_value,
          moderation_status, answered_at, revision, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'pending', NULL, 1, $6, $6)
        ON CONFLICT (response_id, question_id) DO UPDATE
        SET text_value = EXCLUDED.text_value, moderation_status = 'pending',
            answered_at = NULL, revision = activity_text_entries.revision + 1,
            updated_at = EXCLUDED.updated_at
      `,
      [input.entryId, input.projectId, input.responseId, input.questionId, input.text, input.now]
    );
  }

  async deleteTextEntries(
    manager: EntityManager,
    responseId: string,
    questionIds: string[]
  ): Promise<void> {
    if (questionIds.length === 0) return;
    await manager.query(
      `DELETE FROM activity_text_entries WHERE response_id = $1 AND question_id = ANY($2::text[])`,
      [responseId, questionIds]
    );
  }

  async bumpRunRevision(
    manager: EntityManager,
    runId: string,
    incrementResponseCount: boolean,
    now: Date
  ): Promise<number> {
    const rows = await manager.query<Array<{ revision: number }>>(
      `
        WITH updated AS (
          UPDATE activity_runs
          SET revision = revision + 1,
              response_count = response_count + CASE WHEN $2 THEN 1 ELSE 0 END,
              updated_at = $3
          WHERE activity_run_id = $1
          RETURNING revision
        )
        SELECT revision FROM updated
      `,
      [runId, incrementResponseCount, now]
    );
    return rows[0]?.revision ?? 0;
  }
}
