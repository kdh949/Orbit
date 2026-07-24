import type {
  PresentationAccessMode,
  PresentationSessionPurpose,
} from "@orbit/shared";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";

export type PresentationSessionStatus = "draft" | "live" | "ended";

export type PresentationSessionRow = {
  session_id: string;
  project_id: string;
  deck_id: string | null;
  deck_version: number | null;
  presenter_user_id: string | null;
  created_by: string | null;
  status: PresentationSessionStatus;
  session_purpose: PresentationSessionPurpose;
  audience_access_enabled: boolean;
  access_mode: PresentationAccessMode;
  session_password_hash: string | null;
  starts_at: Date | string;
  expires_at: Date | string;
  active_activity_run_id: string | null;
  started_at: Date | string | null;
  ended_at: Date | string | null;
  closed_at: Date | string | null;
  raw_responses_delete_after: Date | string | null;
  raw_responses_deleted_at: Date | string | null;
  results_deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type AudiencePresentationSessionRow = PresentationSessionRow & {
  project_title: string;
};

type QueryExecutor = DataSource | EntityManager;

const sessionColumns = `
  session_id, project_id, deck_id, deck_version, presenter_user_id, created_by,
  status, session_purpose, audience_access_enabled, access_mode,
  session_password_hash, starts_at, expires_at,
  active_activity_run_id, started_at, ended_at, closed_at,
  raw_responses_delete_after, raw_responses_deleted_at, results_deleted_at,
  created_at, updated_at
`;

const qualifiedSessionColumns = `
  sessions.session_id, sessions.project_id, sessions.deck_id, sessions.deck_version,
  sessions.presenter_user_id, sessions.created_by, sessions.status,
  sessions.session_purpose, sessions.audience_access_enabled, sessions.access_mode,
  sessions.session_password_hash, sessions.starts_at, sessions.expires_at,
  sessions.active_activity_run_id, sessions.started_at, sessions.ended_at,
  sessions.closed_at, sessions.raw_responses_delete_after,
  sessions.raw_responses_deleted_at, sessions.results_deleted_at,
  sessions.created_at, sessions.updated_at
`;

@Injectable()
export class PresentationSessionRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  async findCurrent(
    projectId: string,
    deckId: string,
    sessionPurpose: PresentationSessionPurpose,
  ): Promise<PresentationSessionRow | null> {
    const rows = await this.dataSource.query<PresentationSessionRow[]>(
      `
        SELECT ${sessionColumns}
        FROM presentation_sessions
        WHERE project_id = $1
          AND deck_id = $2
          AND session_purpose = $3
          AND status IN ('draft', 'live')
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [projectId, deckId, sessionPurpose]
    );
    return rows[0] ?? null;
  }

  async findCurrentForUpdate(
    manager: EntityManager,
    projectId: string,
    deckId: string,
    sessionPurpose: PresentationSessionPurpose,
  ): Promise<PresentationSessionRow | null> {
    const rows = await manager.query<PresentationSessionRow[]>(
      `
        SELECT ${sessionColumns}
        FROM presentation_sessions
        WHERE project_id = $1
          AND deck_id = $2
          AND session_purpose = $3
          AND status IN ('draft', 'live')
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [projectId, deckId, sessionPurpose]
    );
    return rows[0] ?? null;
  }

  async list(projectId: string, deckId: string): Promise<PresentationSessionRow[]> {
    return this.dataSource.query<PresentationSessionRow[]>(
      `
        SELECT ${sessionColumns}
        FROM presentation_sessions
        WHERE project_id = $1 AND deck_id = $2
        ORDER BY created_at DESC
      `,
      [projectId, deckId]
    );
  }

  async findAccessibleBySessionId(
    sessionId: string,
    now = new Date()
  ): Promise<PresentationSessionRow | null> {
    const rows = await this.dataSource.query<PresentationSessionRow[]>(
      `
        WITH activated AS (
          UPDATE presentation_sessions
          SET status = 'live',
              started_at = COALESCE(started_at, starts_at),
              updated_at = $2
          WHERE session_id = $1
            AND audience_access_enabled = true
            AND status = 'draft'
            AND starts_at <= $2
            AND expires_at > $2
          RETURNING ${sessionColumns}
        )
        SELECT * FROM activated
        UNION ALL
        SELECT ${sessionColumns}
        FROM presentation_sessions
        WHERE session_id = $1
          AND audience_access_enabled = true
          AND status = 'live'
          AND starts_at <= $2
          AND expires_at > $2
        LIMIT 1
      `,
      [sessionId, now]
    );
    return rows[0] ?? null;
  }

  async findActiveCompanionSession(
    sessionId: string,
    now = new Date(),
  ): Promise<PresentationSessionRow | null> {
    const rows = await this.dataSource.query<PresentationSessionRow[]>(
      `
        SELECT ${sessionColumns}
        FROM presentation_sessions
        WHERE session_id = $1
          AND status IN ('draft', 'live')
          AND expires_at > $2
          AND deck_id IS NOT NULL
          AND deck_version IS NOT NULL
        LIMIT 1
      `,
      [sessionId, now],
    );
    return rows[0] ?? null;
  }

  async registerAudience(
    projectId: string,
    sessionId: string,
    audienceId: string,
    joinedAt = new Date()
  ): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO presentation_session_audiences (
          project_id, session_id, audience_id, joined_at
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (project_id, session_id, audience_id) DO NOTHING
      `,
      [projectId, sessionId, audienceId, joinedAt]
    );
  }

  async findAudienceInfo(sessionId: string): Promise<AudiencePresentationSessionRow | null> {
    const rows = await this.dataSource.query<AudiencePresentationSessionRow[]>(
      `
        SELECT ${qualifiedSessionColumns}, projects.title AS project_title
        FROM presentation_sessions AS sessions
        INNER JOIN projects ON projects.project_id = sessions.project_id
        WHERE sessions.session_id = $1
        LIMIT 1
      `,
      [sessionId]
    );
    return rows[0] ?? null;
  }

  async findById(
    executor: QueryExecutor,
    projectId: string,
    sessionId: string,
    lock = false
  ): Promise<PresentationSessionRow | null> {
    const rows = await executor.query<PresentationSessionRow[]>(
      `
        SELECT ${sessionColumns}
        FROM presentation_sessions
        WHERE project_id = $1 AND session_id = $2
        LIMIT 1
        ${lock ? "FOR UPDATE" : ""}
      `,
      [projectId, sessionId]
    );
    return rows[0] ?? null;
  }

  findByIdForRead(projectId: string, sessionId: string) {
    return this.findById(this.dataSource, projectId, sessionId, false);
  }

  async closeActive(
    manager: EntityManager,
    projectId: string,
    sessionPurpose: PresentationSessionPurpose,
    now: Date
  ): Promise<string[]> {
    const active = await manager.query<Array<{ session_id: string }>>(
      `
        SELECT session_id
        FROM presentation_sessions
        WHERE project_id = $1
          AND session_purpose = $2
          AND status IN ('draft', 'live')
        FOR UPDATE
      `,
      [projectId, sessionPurpose]
    );
    const sessionIds = active.map((row) => row.session_id);
    if (sessionIds.length === 0) return [];

    await manager.query(
      `
        UPDATE activity_runs
        SET status = 'closed', closed_at = COALESCE(closed_at, $2),
            revision = revision + 1, updated_at = $2
        WHERE session_id = ANY($1::text[]) AND status = 'open'
      `,
      [sessionIds, now]
    );
    await manager.query(
      `
        UPDATE presentation_sessions
        SET status = 'ended', active_activity_run_id = NULL,
            ended_at = $2::timestamptz, closed_at = $2::timestamptz,
            raw_responses_delete_after = $2::timestamptz + interval '90 days',
            updated_at = $2::timestamptz
        WHERE project_id = $1 AND session_id = ANY($3::text[])
      `,
      [projectId, now, sessionIds]
    );
    return sessionIds;
  }

  async insert(
    manager: EntityManager,
    input: {
      sessionId: string;
      projectId: string;
      deckId: string;
      deckVersion: number;
      userId: string;
      status: Exclude<PresentationSessionStatus, "ended">;
      sessionPurpose: PresentationSessionPurpose;
      audienceAccessEnabled: boolean;
      accessMode: PresentationAccessMode;
      passwordHash: string | null;
      startsAt: Date;
      expiresAt: Date;
      now: Date;
    }
  ): Promise<PresentationSessionRow> {
    const rows = await manager.query<PresentationSessionRow[]>(
      `
        INSERT INTO presentation_sessions (
          session_id, session_password_hash, project_id, status, created_at, expires_at,
          deck_id, deck_version, presenter_user_id, created_by, access_mode,
          starts_at, updated_at, started_at, raw_responses_delete_after,
          session_purpose, audience_access_enabled
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $5, $12,
          $6::timestamptz + interval '90 days', $13, $14
        )
        RETURNING ${sessionColumns}
      `,
      [
        input.sessionId,
        input.passwordHash,
        input.projectId,
        input.status,
        input.now,
        input.expiresAt,
        input.deckId,
        input.deckVersion,
        input.userId,
        input.accessMode,
        input.startsAt,
        input.status === "live" ? input.now : null,
        input.sessionPurpose,
        input.audienceAccessEnabled,
      ]
    );
    return rows[0];
  }

  async updateAccess(
    manager: EntityManager,
    projectId: string,
    sessionId: string,
    input:
      | {
          audienceAccessEnabled: false;
          now: Date;
        }
      | {
          audienceAccessEnabled: true;
          status: Exclude<PresentationSessionStatus, "ended">;
          accessMode: PresentationAccessMode;
          passwordHash: string | null;
          startsAt: Date;
          expiresAt: Date;
          now: Date;
        },
  ): Promise<PresentationSessionRow | null> {
    if (!input.audienceAccessEnabled) {
      const rows = await manager.query<PresentationSessionRow[]>(
        `
          UPDATE presentation_sessions
          SET audience_access_enabled = false,
              session_password_hash = NULL,
              updated_at = $3
          WHERE project_id = $1
            AND session_id = $2
            AND status IN ('draft', 'live')
          RETURNING ${sessionColumns}
        `,
        [projectId, sessionId, input.now],
      );
      return rows[0] ?? null;
    }
    const rows = await manager.query<PresentationSessionRow[]>(
      `
        UPDATE presentation_sessions
        SET status = $3, audience_access_enabled = true,
            access_mode = $4, session_password_hash = $5,
            starts_at = $6, expires_at = $7, updated_at = $8,
            raw_responses_delete_after = $7::timestamptz + interval '90 days',
            started_at = CASE WHEN $3 = 'live' THEN COALESCE(started_at, $8) ELSE NULL END
        WHERE project_id = $1 AND session_id = $2 AND status IN ('draft', 'live')
        RETURNING ${sessionColumns}
      `,
      [
        projectId,
        sessionId,
        input.status,
        input.accessMode,
        input.passwordHash,
        input.startsAt,
        input.expiresAt,
        input.now
      ]
    );
    return rows[0] ?? null;
  }

  async close(
    manager: EntityManager,
    projectId: string,
    sessionId: string,
    now: Date
  ): Promise<PresentationSessionRow | null> {
    const row = await this.findById(manager, projectId, sessionId, true);
    if (!row) return null;
    if (row.status === "ended") return row;

    await manager.query(
      `
        UPDATE activity_runs
        SET status = 'closed', closed_at = COALESCE(closed_at, $3),
            revision = revision + 1, updated_at = $3
        WHERE project_id = $1 AND session_id = $2 AND status = 'open'
      `,
      [projectId, sessionId, now]
    );
    await manager.query(
      `
        UPDATE presentation_sessions
        SET status = 'ended', active_activity_run_id = NULL,
            ended_at = $3::timestamptz, closed_at = $3::timestamptz,
            raw_responses_delete_after = $3::timestamptz + interval '90 days',
            updated_at = $3::timestamptz
        WHERE project_id = $1 AND session_id = $2
      `,
      [projectId, sessionId, now]
    );
    return this.findById(manager, projectId, sessionId, false);
  }
}
