import type { ActivityResponseRetentionJobPayload } from "@orbit/shared/activities";
import type { DataSource, EntityManager } from "typeorm";

type DueSessionRow = {
  project_id: string;
  session_id: string;
};

type ExpiredSessionRow = DueSessionRow & {
  expires_at: Date | string;
};

export type ActivityRetentionEnqueue = (
  payload: ActivityResponseRetentionJobPayload,
) => Promise<void>;

export async function dispatchDueActivityRetentionJobs(
  dataSource: DataSource,
  enqueue: ActivityRetentionEnqueue,
  now = new Date(),
  batchSize = 100,
): Promise<{
  scanned: number;
  dispatched: number;
  failed: number;
  normalizedExpired: number;
}> {
  const { normalizedExpired, payloads } = await dataSource.transaction(async (manager) => {
    const expiredSessions = readQueryRows<ExpiredSessionRow>(
      await manager.query(
        `
          WITH expired_sessions AS (
            SELECT project_id, session_id
            FROM presentation_sessions
            WHERE status IN ('draft', 'live')
              AND expires_at <= $1
            ORDER BY expires_at ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED
          )
          UPDATE presentation_sessions AS sessions
          SET status = 'ended', active_activity_run_id = NULL,
              ended_at = COALESCE(sessions.ended_at, sessions.expires_at),
              closed_at = COALESCE(sessions.closed_at, sessions.expires_at),
              raw_responses_delete_after = COALESCE(
                sessions.raw_responses_delete_after,
                sessions.expires_at + interval '90 days'
              ),
              updated_at = $1
          FROM expired_sessions
          WHERE sessions.project_id = expired_sessions.project_id
            AND sessions.session_id = expired_sessions.session_id
          RETURNING sessions.project_id, sessions.session_id, sessions.expires_at
        `,
        [now, Math.max(1, batchSize)],
      ),
    );
    if (expiredSessions.length > 0) {
      await manager.query(
        `
          UPDATE activity_runs AS runs
          SET status = 'closed',
              closed_at = COALESCE(runs.closed_at, sessions.expires_at),
              revision = runs.revision + 1,
              updated_at = $2
          FROM presentation_sessions AS sessions
          WHERE runs.project_id = sessions.project_id
            AND runs.session_id = sessions.session_id
            AND runs.status = 'open'
            AND runs.session_id = ANY($1::text[])
        `,
        [expiredSessions.map((session) => session.session_id), now],
      );
    }
    const sessions = readQueryRows<DueSessionRow>(
      await manager.query(
        `
          SELECT project_id, session_id
          FROM presentation_sessions
          WHERE raw_responses_delete_after <= $1
            AND raw_responses_deleted_at IS NULL
            AND results_deleted_at IS NULL
          ORDER BY raw_responses_delete_after ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        `,
        [now, Math.max(1, batchSize)],
      ),
    );
    const queued: ActivityResponseRetentionJobPayload[] = [];
    for (const session of sessions) {
      const payload = {
        jobId: retentionJobId(session.session_id),
        projectId: session.project_id,
        presentationSessionId: session.session_id,
      } satisfies ActivityResponseRetentionJobPayload;
      await upsertRetentionJob(manager, payload, now);
      queued.push(payload);
    }
    return { normalizedExpired: expiredSessions.length, payloads: queued };
  });

  let dispatched = 0;
  let failed = 0;
  for (const payload of payloads) {
    try {
      await enqueue(payload);
      dispatched += 1;
    } catch (error) {
      failed += 1;
      await dataSource.query(
        `
          UPDATE jobs
          SET status = 'failed', progress = 0,
              message = 'Activity response retention enqueue failed.',
              error = $2, updated_at = $3
          WHERE job_id = $1 AND status = 'queued'
        `,
        [
          payload.jobId,
          {
            code: "ACTIVITY_RETENTION_ENQUEUE_FAILED",
            message:
              error instanceof Error
                ? error.message
                : "Activity response retention enqueue failed.",
            retryable: true,
          },
          now,
        ],
      );
    }
  }
  return { scanned: payloads.length, dispatched, failed, normalizedExpired };
}

export function retentionJobId(sessionId: string): string {
  return `job_activity_retention_${sessionId}`;
}

async function upsertRetentionJob(
  manager: EntityManager,
  payload: ActivityResponseRetentionJobPayload,
  now: Date,
): Promise<void> {
  await manager.query(
    `
      INSERT INTO jobs (
        job_id, project_id, type, status, progress, message,
        payload, result, error, created_at, updated_at
      )
      VALUES ($1, $2, 'activity-response-retention', 'queued', 0,
              'Activity response retention queued.', $3, NULL, NULL, $4, $4)
      ON CONFLICT (job_id) DO UPDATE
      SET status = CASE WHEN jobs.status = 'failed' THEN 'queued' ELSE jobs.status END,
          progress = CASE WHEN jobs.status = 'failed' THEN 0 ELSE jobs.progress END,
          message = CASE WHEN jobs.status = 'failed'
            THEN 'Activity response retention queued.' ELSE jobs.message END,
          error = CASE WHEN jobs.status = 'failed' THEN NULL ELSE jobs.error END,
          updated_at = CASE WHEN jobs.status = 'failed' THEN EXCLUDED.updated_at ELSE jobs.updated_at END
    `,
    [payload.jobId, payload.projectId, payload, now],
  );
}

function readQueryRows<T>(queryResult: unknown): T[] {
  if (!Array.isArray(queryResult)) return [];
  if (Array.isArray(queryResult[0])) return queryResult[0] as T[];
  return queryResult as T[];
}
