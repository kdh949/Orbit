import type {
  ActivityDefinition,
  ActivityRuntimeStatus,
  PresentationSessionPurpose,
} from "@orbit/shared";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";

export type ActivityRunRow = {
  activity_run_id: string;
  project_id: string;
  session_id: string;
  activity_id: string;
  source_slide_id: string;
  version: number;
  supersedes_activity_run_id: string | null;
  definition_snapshot: unknown;
  definition_fingerprint: string;
  status: ActivityRuntimeStatus;
  revision: number;
  is_current: boolean;
  response_count: number;
  opened_at: Date | string | null;
  closed_at: Date | string | null;
  revealed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type ActivitySessionIdentityRow = {
  deck_id: string | null;
};

export type ActivitySessionRow = {
  session_id: string;
  project_id: string;
  deck_id: string;
  deck_version: number;
  session_status: "draft" | "live" | "ended";
  session_purpose: PresentationSessionPurpose;
  audience_access_enabled: boolean;
  starts_at: Date | string;
  expires_at: Date | string;
};

const runColumns = `
  activity_run_id, project_id, session_id, activity_id, source_slide_id,
  version, supersedes_activity_run_id, definition_snapshot,
  definition_fingerprint, status, revision, is_current, response_count,
  opened_at, closed_at, revealed_at, created_at, updated_at
`;

@Injectable()
export class ActivityRunRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  async findSessionIdentity(
    manager: EntityManager,
    projectId: string,
    sessionId: string
  ): Promise<ActivitySessionIdentityRow | null> {
    const rows = await manager.query<ActivitySessionIdentityRow[]>(
      `
        SELECT deck_id
        FROM presentation_sessions
        WHERE project_id = $1 AND session_id = $2
        LIMIT 1
      `,
      [projectId, sessionId]
    );
    return rows[0] ?? null;
  }

  async lockSession(
    manager: EntityManager,
    projectId: string,
    sessionId: string
  ): Promise<ActivitySessionRow | null> {
    const rows = await manager.query<ActivitySessionRow[]>(
      `
        SELECT
          session_id,
          project_id,
          deck_id,
          deck_version,
          status AS session_status,
          session_purpose,
          audience_access_enabled,
          starts_at,
          expires_at
        FROM presentation_sessions
        WHERE project_id = $1 AND session_id = $2
        FOR UPDATE
      `,
      [projectId, sessionId]
    );
    return rows[0] ?? null;
  }

  async findCurrent(
    manager: EntityManager,
    projectId: string,
    sessionId: string,
    activityId: string
  ): Promise<ActivityRunRow | null> {
    const rows = await manager.query<ActivityRunRow[]>(
      `
        SELECT ${runColumns}
        FROM activity_runs
        WHERE project_id = $1 AND session_id = $2 AND activity_id = $3 AND is_current
        LIMIT 1
        FOR UPDATE
      `,
      [projectId, sessionId, activityId]
    );
    return rows[0] ?? null;
  }

  async findCurrentForRead(
    projectId: string,
    sessionId: string,
    activityId: string
  ): Promise<ActivityRunRow | null> {
    const rows = await this.dataSource.query<ActivityRunRow[]>(
      `
        SELECT ${runColumns}
        FROM activity_runs
        WHERE project_id = $1 AND session_id = $2 AND activity_id = $3 AND is_current
        LIMIT 1
      `,
      [projectId, sessionId, activityId]
    );
    return rows[0] ?? null;
  }

  async findById(
    manager: EntityManager,
    projectId: string,
    sessionId: string,
    runId: string
  ): Promise<ActivityRunRow | null> {
    const rows = await manager.query<ActivityRunRow[]>(
      `
        SELECT ${runColumns}
        FROM activity_runs
        WHERE project_id = $1 AND session_id = $2 AND activity_run_id = $3
        LIMIT 1
        FOR UPDATE
      `,
      [projectId, sessionId, runId]
    );
    return rows[0] ?? null;
  }

  async insert(
    manager: EntityManager,
    input: {
      runId: string;
      projectId: string;
      sessionId: string;
      activityId: string;
      sourceSlideId: string;
      version: number;
      supersedesRunId: string | null;
      definition: ActivityDefinition;
      fingerprint: string;
      now: Date;
    }
  ): Promise<ActivityRunRow> {
    const rows = await manager.query<ActivityRunRow[]>(
      `
        INSERT INTO activity_runs (
          activity_run_id, project_id, session_id, activity_id, source_slide_id,
          version, supersedes_activity_run_id, definition_snapshot,
          definition_fingerprint, status, revision, is_current, response_count,
          created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 'draft', 0, true, 0, $10, $10)
        RETURNING ${runColumns}
      `,
      [
        input.runId,
        input.projectId,
        input.sessionId,
        input.activityId,
        input.sourceSlideId,
        input.version,
        input.supersedesRunId,
        JSON.stringify(input.definition),
        input.fingerprint,
        input.now
      ]
    );
    return rows[0];
  }

  async updateSnapshot(
    manager: EntityManager,
    runId: string,
    sourceSlideId: string,
    definition: ActivityDefinition,
    fingerprint: string,
    now: Date
  ): Promise<ActivityRunRow> {
    const rows = await manager.query<ActivityRunRow[]>(
      `
        WITH updated AS (
          UPDATE activity_runs
          SET source_slide_id = $2, definition_snapshot = $3::jsonb,
              definition_fingerprint = $4, revision = revision + 1, updated_at = $5
          WHERE activity_run_id = $1 AND response_count = 0
          RETURNING ${runColumns}
        )
        SELECT * FROM updated
      `,
      [runId, sourceSlideId, JSON.stringify(definition), fingerprint, now]
    );
    return rows[0];
  }

  async markSuperseded(
    manager: EntityManager,
    run: ActivityRunRow,
    now: Date
  ): Promise<void> {
    await manager.query(
      `
        UPDATE activity_runs
        SET is_current = false,
            status = CASE WHEN status = 'open' THEN 'closed' ELSE status END,
            closed_at = CASE WHEN status = 'open' THEN COALESCE(closed_at, $2) ELSE closed_at END,
            revision = revision + 1,
            updated_at = $2
        WHERE activity_run_id = $1
      `,
      [run.activity_run_id, now]
    );
    await manager.query(
      `
        UPDATE presentation_sessions
        SET active_activity_run_id = NULL, updated_at = $3
        WHERE project_id = $1 AND session_id = $2 AND active_activity_run_id = $4
      `,
      [run.project_id, run.session_id, now, run.activity_run_id]
    );
  }

  async closeOtherOpenRuns(
    manager: EntityManager,
    projectId: string,
    sessionId: string,
    runId: string,
    now: Date
  ): Promise<string[]> {
    const rows = await manager.query<Array<{ activity_run_id: string }>>(
      `
        UPDATE activity_runs
        SET status = 'closed', closed_at = COALESCE(closed_at, $4),
            revision = revision + 1, updated_at = $4
        WHERE project_id = $1 AND session_id = $2
          AND activity_run_id <> $3 AND status = 'open'
        RETURNING activity_run_id
      `,
      [projectId, sessionId, runId, now]
    );
    return rows.map((row) => row.activity_run_id);
  }

  async updateStatus(
    manager: EntityManager,
    runId: string,
    status: ActivityRuntimeStatus,
    now: Date
  ): Promise<ActivityRunRow> {
    const rows = await manager.query<ActivityRunRow[]>(
      `
        WITH updated AS (
          UPDATE activity_runs
          SET status = $2,
              revision = revision + 1,
              opened_at = CASE WHEN $2 = 'open' THEN COALESCE(opened_at, $3) ELSE opened_at END,
              closed_at = CASE WHEN $2 = 'closed' THEN $3 ELSE closed_at END,
              revealed_at = CASE WHEN $2 = 'results' THEN $3 ELSE revealed_at END,
              updated_at = $3
          WHERE activity_run_id = $1
          RETURNING ${runColumns}
        )
        SELECT * FROM updated
      `,
      [runId, status, now]
    );
    return rows[0];
  }

  async setActiveRun(
    manager: EntityManager,
    projectId: string,
    sessionId: string,
    runId: string | null,
    now: Date
  ): Promise<void> {
    await manager.query(
      `
        UPDATE presentation_sessions
        SET active_activity_run_id = $3, updated_at = $4,
            status = CASE WHEN status = 'draft' AND starts_at <= $4 THEN 'live' ELSE status END,
            started_at = CASE
              WHEN status = 'draft' AND starts_at <= $4 THEN COALESCE(started_at, $4)
              ELSE started_at
            END
        WHERE project_id = $1 AND session_id = $2
      `,
      [projectId, sessionId, runId, now]
    );
  }
}
