import {
  aiDeckGenerationStageInputReferenceSchema,
  aiDeckGenerationStageMessageSchema,
  aiDeckGenerationStageReferenceSchema,
  aiDeckGenerationStageResultReferenceSchema,
  aiDeckGenerationStageSchema,
  aiDeckGenerationStageStatusSchema,
  jobErrorSchema,
  type AiDeckGenerationStage,
  type AiDeckGenerationStageMessage,
  type AiDeckGenerationStageStatus,
  type JobError,
} from "@orbit/shared/jobs";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { z } from "zod";

type QueryExecutor = Pick<DataSource, "query">;
type TransactionalQueryExecutor = QueryExecutor & {
  transaction<T>(
    isolationLevel: "READ COMMITTED",
    callback: (manager: QueryExecutor) => Promise<T>,
  ): Promise<T>;
};

const workerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !value.includes(":"), {
    message: "workerId cannot contain colons",
  });
const leaseOwnerSchema = z.string().trim().min(1).max(256);
const checkpointAttemptSchema = z.number().int().min(0).max(5);
const claimedAttemptSchema = checkpointAttemptSchema.min(1);
const retryableErrorSchema = jobErrorSchema.extend({
  retryable: z.literal(true),
});
const exhaustedErrorSchema = jobErrorSchema.extend({
  retryable: z.literal(false),
});
const timestampSchema = z.union([z.date(), z.string().min(1)]);
const dispatchLimitSchema = z.number().int().min(1).max(500);
const userConcurrencySchema = z.number().int().min(1).max(32);

const checkpointRowSchema = z.object({
  pipeline_job_id: z.string().min(1),
  stage: aiDeckGenerationStageSchema,
  shard_key: z.string(),
  status: aiDeckGenerationStageStatusSchema,
  attempt: z.number().int().min(0).max(5),
  input_ref_json: aiDeckGenerationStageReferenceSchema,
  result_ref_json: aiDeckGenerationStageReferenceSchema.nullable(),
  error_json: jobErrorSchema.nullable(),
  lease_owner: z.string().nullable(),
  lease_expires_at: timestampSchema.nullable(),
  dispatched_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

const dispatchableCheckpointRowSchema = checkpointRowSchema.extend({
  project_id: z.string().min(1),
});
const claimCandidateUserRowSchema = z.object({
  requested_by_user_id: z.string().min(1),
  running_count: z.number().int().nonnegative(),
  oldest_created_at: timestampSchema,
});
const advisoryLockRowSchema = z.object({ acquired: z.boolean() });
const userClaimGuardRowSchema = z.object({ user_id: z.string().min(1) });
const runningCountRowSchema = z.object({
  running_count: z.number().int().nonnegative(),
});
const claimedCheckpointRowSchema = checkpointRowSchema.extend({
  project_id: z.string().min(1),
  requested_by_user_id: z.string().min(1),
});

export interface AiDeckGenerationStageCheckpoint {
  pipelineJobId: string;
  stage: AiDeckGenerationStage;
  shardKey: string;
  status: AiDeckGenerationStageStatus;
  attempt: number;
  inputRef: Record<string, unknown>;
  resultRef: Record<string, unknown> | null;
  error: JobError | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  dispatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DispatchableAiDeckGenerationStage {
  message: AiDeckGenerationStageMessage;
  attempt: number;
}

export interface ClaimedAiDeckGenerationStage {
  message: AiDeckGenerationStageMessage;
  checkpoint: AiDeckGenerationStageCheckpoint;
  requestedByUserId: string;
}

export class AiDeckGenerationStageCheckpointRepository {
  constructor(private readonly db: QueryExecutor) {}

  async ensureQueued(
    rawMessage: unknown,
    rawInputRef: unknown = {},
  ): Promise<AiDeckGenerationStageCheckpoint | null> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const inputRef = aiDeckGenerationStageInputReferenceSchema.parse({
      stage: message.stage,
      reference: rawInputRef,
    }).reference;
    const rows = await this.db.query(
      `
        INSERT INTO ai_deck_generation_stages (
          pipeline_job_id,
          stage,
          shard_key,
          input_ref_json
        )
        SELECT jobs.job_id, $3, $4, $5::jsonb
        FROM jobs
        WHERE jobs.job_id = $1
          AND jobs.project_id = $2
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
        ON CONFLICT (pipeline_job_id, stage, shard_key) DO NOTHING
        RETURNING *
      `,
      messageParameters(message, inputRef),
    );
    return checkpointFromQuery(rows) ?? this.get(message);
  }

  async get(
    rawMessage: unknown,
  ): Promise<AiDeckGenerationStageCheckpoint | null> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const rows = await this.db.query(
      `
        SELECT stages.*
        FROM ai_deck_generation_stages stages
        JOIN jobs ON jobs.job_id = stages.pipeline_job_id
        WHERE stages.pipeline_job_id = $1
          AND jobs.project_id = $2
          AND jobs.type = 'ai-deck-generation'
          AND stages.stage = $3
          AND stages.shard_key = $4
      `,
      messageParameters(message),
    );
    return checkpointFromQuery(rows);
  }

  async claim(
    rawMessage: unknown,
    rawWorkerId: unknown,
  ): Promise<AiDeckGenerationStageCheckpoint | null> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const workerId = workerIdSchema.parse(rawWorkerId);
    const leaseOwner = `${workerId}:${randomUUID()}`;
    const rows = await this.db.query(
      `
        UPDATE ai_deck_generation_stages stages
        SET status = 'running',
            attempt = stages.attempt + 1,
            error_json = NULL,
            lease_owner = $5,
            lease_expires_at = now() + interval '10 minutes',
            updated_at = now()
        FROM jobs
        WHERE jobs.job_id = stages.pipeline_job_id
          AND jobs.project_id = $2
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
          AND stages.pipeline_job_id = $1
          AND stages.stage = $3
          AND stages.shard_key = $4
          AND stages.status = 'queued'
          AND stages.attempt < 5
        RETURNING stages.*
      `,
      messageParameters(message, leaseOwner),
    );
    return checkpointFromQuery(rows);
  }

  async claimNext(
    rawWorkerId: unknown,
    rawUserConcurrency: unknown,
  ): Promise<ClaimedAiDeckGenerationStage | null> {
    const workerId = workerIdSchema.parse(rawWorkerId);
    const userConcurrency = userConcurrencySchema.parse(rawUserConcurrency);
    const transactional = this.db as Partial<TransactionalQueryExecutor>;
    if (typeof transactional.transaction !== "function") {
      throw new Error("PostgreSQL stage claim requires a transaction-capable data source.");
    }

    return transactional.transaction("READ COMMITTED", async (manager) => {
      const candidateRows = await manager.query(
        `
          WITH runnable AS (
            SELECT
              COALESCE(NULLIF(jobs.payload->>'requestedByUserId', ''), projects.created_by)
                AS requested_by_user_id,
              stages.created_at
            FROM ai_deck_generation_stages stages
            JOIN jobs ON jobs.job_id = stages.pipeline_job_id
            JOIN projects ON projects.project_id = jobs.project_id
            WHERE jobs.type = 'ai-deck-generation'
              AND jobs.status IN ('queued','running')
              AND stages.stage IN (
                'reference-extract-file','source-grounding','content-planning',
                'cover-slide','design-planning','layout-compile','image-slide',
                'semantic-quality','rendered-visual-quality','publication'
              )
              AND stages.status = 'queued'
              AND stages.attempt < 5
          ),
          running AS (
            SELECT
              COALESCE(NULLIF(jobs.payload->>'requestedByUserId', ''), projects.created_by)
                AS requested_by_user_id,
              COUNT(*)::int AS running_count
            FROM ai_deck_generation_stages stages
            JOIN jobs ON jobs.job_id = stages.pipeline_job_id
            JOIN projects ON projects.project_id = jobs.project_id
            WHERE jobs.type = 'ai-deck-generation'
              AND jobs.status IN ('queued','running')
              AND stages.status = 'running'
            GROUP BY requested_by_user_id
          )
          SELECT runnable.requested_by_user_id,
                 COALESCE(running.running_count, 0)::int AS running_count,
                 MIN(runnable.created_at) AS oldest_created_at
          FROM runnable
          LEFT JOIN running USING (requested_by_user_id)
          WHERE COALESCE(running.running_count, 0) < $1
          GROUP BY runnable.requested_by_user_id, running.running_count
          ORDER BY running_count, oldest_created_at, requested_by_user_id
          LIMIT 100
        `,
        [userConcurrency],
      );
      if (!Array.isArray(candidateRows)) return null;

      for (const rawCandidate of candidateRows) {
        const candidate = claimCandidateUserRowSchema.parse(rawCandidate);
        const lockRows = await manager.query(
          `
            SELECT pg_try_advisory_xact_lock(
              hashtextextended('ai-deck-user:' || $1, 0)
            ) AS acquired
          `,
          [candidate.requested_by_user_id],
        );
        const lock = advisoryLockRowSchema.parse(firstQueryRow(lockRows));
        if (!lock.acquired) continue;

        const guardRows = await manager.query(
          `
            SELECT users.user_id
            FROM users
            WHERE users.user_id = $1
            FOR UPDATE
          `,
          [candidate.requested_by_user_id],
        );
        const guardRow = firstQueryRow(guardRows);
        if (!guardRow) continue;
        userClaimGuardRowSchema.parse(guardRow);

        const runningRows = await manager.query(
          `
            SELECT COUNT(*)::int AS running_count
            FROM ai_deck_generation_stages stages
            JOIN jobs ON jobs.job_id = stages.pipeline_job_id
            JOIN projects ON projects.project_id = jobs.project_id
            WHERE jobs.type = 'ai-deck-generation'
              AND jobs.status IN ('queued','running')
              AND stages.status = 'running'
              AND COALESCE(
                NULLIF(jobs.payload->>'requestedByUserId', ''),
                projects.created_by
              ) = $1
          `,
          [candidate.requested_by_user_id],
        );
        const running = runningCountRowSchema.parse(firstQueryRow(runningRows));
        if (running.running_count >= userConcurrency) continue;

        const leaseOwner = `${workerId}:${randomUUID()}`;
        const claimedRows = await manager.query(
          `
            WITH candidate AS (
              SELECT stages.pipeline_job_id,
                     stages.stage,
                     stages.shard_key,
                     jobs.project_id
              FROM ai_deck_generation_stages stages
              JOIN jobs ON jobs.job_id = stages.pipeline_job_id
              JOIN projects ON projects.project_id = jobs.project_id
              WHERE jobs.type = 'ai-deck-generation'
                AND jobs.status IN ('queued','running')
                AND stages.stage IN (
                  'reference-extract-file','source-grounding','content-planning',
                  'cover-slide','design-planning','layout-compile','image-slide',
                  'semantic-quality','rendered-visual-quality','publication'
                )
                AND stages.status = 'queued'
                AND stages.attempt < 5
                AND COALESCE(
                  NULLIF(jobs.payload->>'requestedByUserId', ''),
                  projects.created_by
                ) = $1
              ORDER BY CASE WHEN stages.stage = 'cover-slide' THEN 0 ELSE 1 END,
                       stages.created_at,
                       stages.pipeline_job_id,
                       stages.stage,
                       stages.shard_key
              LIMIT 1
              FOR UPDATE OF stages SKIP LOCKED
            )
            UPDATE ai_deck_generation_stages stages
            SET status = 'running',
                attempt = stages.attempt + 1,
                error_json = NULL,
                lease_owner = $2,
                lease_expires_at = now() + interval '10 minutes',
                updated_at = now()
            FROM candidate
            WHERE stages.pipeline_job_id = candidate.pipeline_job_id
              AND stages.stage = candidate.stage
              AND stages.shard_key = candidate.shard_key
              AND stages.status = 'queued'
              AND stages.attempt < 5
            RETURNING stages.*,
                      candidate.project_id,
                      $1::text AS requested_by_user_id
          `,
          [candidate.requested_by_user_id, leaseOwner],
        );
        const rawClaimed = firstQueryRow(claimedRows);
        if (!rawClaimed) continue;
        const row = claimedCheckpointRowSchema.parse(rawClaimed);
        const checkpoint = checkpointFromQuery([rawClaimed]);
        if (!checkpoint) continue;
        return {
          requestedByUserId: row.requested_by_user_id,
          message: aiDeckGenerationStageMessageSchema.parse({
            pipelineJobId: row.pipeline_job_id,
            projectId: row.project_id,
            stage: row.stage,
            shardKey: row.shard_key,
          }),
          checkpoint,
        };
      }
      return null;
    });
  }

  async renewLease(
    rawMessage: unknown,
    rawLeaseOwner: unknown,
    rawAttempt: unknown,
  ): Promise<AiDeckGenerationStageCheckpoint | null> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const leaseOwner = leaseOwnerSchema.parse(rawLeaseOwner);
    const attempt = claimedAttemptSchema.parse(rawAttempt);
    const rows = await this.db.query(
      `
        UPDATE ai_deck_generation_stages stages
        SET lease_expires_at = now() + interval '10 minutes',
            updated_at = now()
        FROM jobs
        WHERE jobs.job_id = stages.pipeline_job_id
          AND jobs.project_id = $2
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
          AND stages.pipeline_job_id = $1
          AND stages.stage = $3
          AND stages.shard_key = $4
          AND stages.status = 'running'
          AND stages.lease_owner = $5
          AND stages.attempt = $6
          AND stages.lease_expires_at > now()
        RETURNING stages.*
      `,
      messageParameters(message, leaseOwner, attempt),
    );
    return checkpointFromQuery(rows);
  }

  async succeed(
    rawMessage: unknown,
    rawLeaseOwner: unknown,
    rawAttempt: unknown,
    rawResultRef: unknown,
  ): Promise<AiDeckGenerationStageCheckpoint | null> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const leaseOwner = leaseOwnerSchema.parse(rawLeaseOwner);
    const attempt = claimedAttemptSchema.parse(rawAttempt);
    const resultRef = aiDeckGenerationStageResultReferenceSchema.parse({
      stage: message.stage,
      reference: rawResultRef,
    }).reference;
    const rows = await this.db.query(
      `
        UPDATE ai_deck_generation_stages stages
        SET status = 'succeeded',
            result_ref_json = $7::jsonb,
            error_json = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        FROM jobs
        WHERE jobs.job_id = stages.pipeline_job_id
          AND jobs.project_id = $2
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
          AND stages.pipeline_job_id = $1
          AND stages.stage = $3
          AND stages.shard_key = $4
          AND stages.status = 'running'
          AND stages.lease_owner = $5
          AND stages.attempt = $6
          AND stages.lease_expires_at > now()
        RETURNING stages.*
      `,
      messageParameters(message, leaseOwner, attempt, resultRef),
    );
    return checkpointFromQuery(rows);
  }

  async fail(
    rawMessage: unknown,
    rawLeaseOwner: unknown,
    rawAttempt: unknown,
    rawError: unknown,
  ): Promise<AiDeckGenerationStageCheckpoint | null> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const leaseOwner = leaseOwnerSchema.parse(rawLeaseOwner);
    const attempt = claimedAttemptSchema.parse(rawAttempt);
    const error = jobErrorSchema.parse(rawError);
    const rows = await this.db.query(
      `
        UPDATE ai_deck_generation_stages stages
        SET status = 'failed',
            error_json = $7::jsonb,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        FROM jobs
        WHERE jobs.job_id = stages.pipeline_job_id
          AND jobs.project_id = $2
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
          AND stages.pipeline_job_id = $1
          AND stages.stage = $3
          AND stages.shard_key = $4
          AND stages.status = 'running'
          AND stages.lease_owner = $5
          AND stages.attempt = $6
          AND stages.lease_expires_at > now()
        RETURNING stages.*
      `,
      messageParameters(message, leaseOwner, attempt, error),
    );
    return checkpointFromQuery(rows);
  }

  async releaseForRetry(
    rawMessage: unknown,
    rawLeaseOwner: unknown,
    rawAttempt: unknown,
    rawError: unknown,
  ): Promise<AiDeckGenerationStageCheckpoint | null> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const leaseOwner = leaseOwnerSchema.parse(rawLeaseOwner);
    const attempt = claimedAttemptSchema.parse(rawAttempt);
    const error = retryableErrorSchema.parse(rawError);
    const rows = await this.db.query(
      `
        UPDATE ai_deck_generation_stages stages
        SET status = 'queued',
            result_ref_json = NULL,
            error_json = $7::jsonb,
            lease_owner = NULL,
            lease_expires_at = NULL,
            dispatched_at = NULL,
            updated_at = now()
        FROM jobs
        WHERE jobs.job_id = stages.pipeline_job_id
          AND jobs.project_id = $2
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
          AND stages.pipeline_job_id = $1
          AND stages.stage = $3
          AND stages.shard_key = $4
          AND stages.status = 'running'
          AND stages.lease_owner = $5
          AND stages.attempt = $6
          AND stages.lease_expires_at > now()
          AND stages.attempt < 5
        RETURNING stages.*
      `,
      messageParameters(message, leaseOwner, attempt, error),
    );
    return checkpointFromQuery(rows);
  }

  async markDispatched(
    rawMessage: unknown,
    rawObservedAttempt: unknown,
  ): Promise<AiDeckGenerationStageCheckpoint | null> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const observedAttempt = checkpointAttemptSchema.parse(rawObservedAttempt);
    const rows = await this.db.query(
      `
        UPDATE ai_deck_generation_stages stages
        SET dispatched_at = now(),
            updated_at = now()
        FROM jobs
        WHERE jobs.job_id = stages.pipeline_job_id
          AND jobs.project_id = $2
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
          AND stages.pipeline_job_id = $1
          AND stages.stage = $3
          AND stages.shard_key = $4
          AND stages.status = 'queued'
          AND stages.dispatched_at IS NULL
          AND stages.attempt = $5
        RETURNING stages.*
      `,
      messageParameters(message, observedAttempt),
    );
    return checkpointFromQuery(rows);
  }

  async releaseDispatchedForTransportRetry(
    rawMessage: unknown,
  ): Promise<AiDeckGenerationStageCheckpoint | null> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const rows = await this.db.query(
      `
        UPDATE ai_deck_generation_stages stages
        SET dispatched_at = NULL,
            updated_at = now()
        FROM jobs
        WHERE jobs.job_id = stages.pipeline_job_id
          AND jobs.project_id = $2
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
          AND stages.pipeline_job_id = $1
          AND stages.stage = $3
          AND stages.shard_key = $4
          AND stages.status = 'queued'
          AND stages.dispatched_at IS NOT NULL
        RETURNING stages.*
      `,
      messageParameters(message),
    );
    return checkpointFromQuery(rows);
  }

  async recoverStaleDispatches(rawLimit = 100): Promise<number> {
    const limit = dispatchLimitSchema.parse(rawLimit);
    const rows = await this.db.query(
      `
        WITH stale AS (
          SELECT stages.pipeline_job_id,
                 stages.stage,
                 stages.shard_key
          FROM ai_deck_generation_stages stages
          JOIN jobs ON jobs.job_id = stages.pipeline_job_id
          WHERE jobs.type = 'ai-deck-generation'
            AND jobs.status IN ('queued','running')
            AND stages.stage IN (
              'reference-extract-file','source-grounding','content-planning',
              'cover-slide','design-planning','layout-compile','image-slide',
              'semantic-quality','rendered-visual-quality','publication'
            )
            AND stages.status = 'queued'
            AND stages.dispatched_at <= now() - interval '15 minutes'
          ORDER BY stages.dispatched_at,
                   stages.pipeline_job_id,
                   stages.shard_key
          LIMIT $1
          FOR UPDATE OF stages SKIP LOCKED
        )
        UPDATE ai_deck_generation_stages stages
        SET dispatched_at = NULL,
            updated_at = now()
        FROM stale
        WHERE stages.pipeline_job_id = stale.pipeline_job_id
          AND stages.stage = stale.stage
          AND stages.shard_key = stale.shard_key
        RETURNING stages.*
      `,
      [limit],
    );
    const recoveredRows = queryRows(rows);
    for (const row of recoveredRows) checkpointRowSchema.parse(row);
    return recoveredRows.length;
  }

  async listUndispatched(
    rawLimit = 100,
  ): Promise<DispatchableAiDeckGenerationStage[]> {
    const limit = dispatchLimitSchema.parse(rawLimit);
    const rows = await this.db.query(
      `
        SELECT stages.*, jobs.project_id
        FROM ai_deck_generation_stages stages
        JOIN jobs ON jobs.job_id = stages.pipeline_job_id
        WHERE jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
          AND stages.stage IN (
            'reference-extract-file','source-grounding','content-planning',
            'cover-slide','design-planning','layout-compile','image-slide',
            'semantic-quality','rendered-visual-quality','publication'
          )
          AND stages.status = 'queued'
          AND stages.dispatched_at IS NULL
        ORDER BY CASE WHEN stages.stage = 'cover-slide' THEN 0 ELSE 1 END,
                 stages.created_at, stages.pipeline_job_id, stages.shard_key
        LIMIT $1
      `,
      [limit],
    );
    if (!Array.isArray(rows)) return [];
    return rows.map((rawRow) => {
      const row = dispatchableCheckpointRowSchema.parse(rawRow);
      return {
        message: aiDeckGenerationStageMessageSchema.parse({
          pipelineJobId: row.pipeline_job_id,
          projectId: row.project_id,
          stage: row.stage,
          shardKey: row.shard_key,
        }),
        attempt: row.attempt,
      };
    });
  }

  async listExpiredLeases(
    rawLimit = 100,
  ): Promise<DispatchableAiDeckGenerationStage[]> {
    const limit = dispatchLimitSchema.parse(rawLimit);
    const rows = await this.db.query(
      `
        SELECT stages.*, jobs.project_id
        FROM ai_deck_generation_stages stages
        JOIN jobs ON jobs.job_id = stages.pipeline_job_id
        WHERE jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
          AND stages.stage IN (
            'reference-extract-file','source-grounding','content-planning',
            'cover-slide','design-planning','layout-compile','image-slide',
            'semantic-quality','rendered-visual-quality','publication'
          )
          AND stages.status = 'running'
          AND stages.lease_expires_at <= now()
        ORDER BY stages.lease_expires_at, stages.pipeline_job_id, stages.shard_key
        LIMIT $1
      `,
      [limit],
    );
    if (!Array.isArray(rows)) return [];
    return rows.map((rawRow) => dispatchableFromRow(rawRow));
  }

  async reconcileExpiredLease(
    rawMessage: unknown,
    rawObservedAttempt: unknown,
    rawRetryError: unknown,
    rawExhaustedError: unknown,
  ): Promise<AiDeckGenerationStageCheckpoint | null> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const observedAttempt = claimedAttemptSchema.parse(rawObservedAttempt);
    const retryError = retryableErrorSchema.parse(rawRetryError);
    const exhaustedError = exhaustedErrorSchema.parse(rawExhaustedError);
    const rows = await this.db.query(
      `
        UPDATE ai_deck_generation_stages stages
        SET status = CASE
              WHEN stages.attempt < 5 THEN 'queued'
              ELSE 'failed'
            END,
            result_ref_json = NULL,
            error_json = CASE
              WHEN stages.attempt < 5 THEN $6::jsonb
              ELSE $7::jsonb
            END,
            lease_owner = NULL,
            lease_expires_at = NULL,
            dispatched_at = NULL,
            updated_at = now()
        FROM jobs
        WHERE jobs.job_id = stages.pipeline_job_id
          AND jobs.project_id = $2
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
          AND stages.pipeline_job_id = $1
          AND stages.stage = $3
          AND stages.shard_key = $4
          AND stages.status = 'running'
          AND stages.attempt = $5
          AND stages.lease_expires_at <= now()
        RETURNING stages.*
      `,
      messageParameters(message, observedAttempt, retryError, exhaustedError),
    );
    return checkpointFromQuery(rows);
  }
}

function messageParameters(
  message: AiDeckGenerationStageMessage,
  ...extra: unknown[]
): unknown[] {
  return [
    message.pipelineJobId,
    message.projectId,
    message.stage,
    message.shardKey,
    ...extra,
  ];
}

function checkpointFromQuery(
  queryResult: unknown,
): AiDeckGenerationStageCheckpoint | null {
  const rawRow = firstQueryRow(queryResult);
  if (!rawRow) return null;
  const row = checkpointRowSchema.parse(rawRow);
  aiDeckGenerationStageInputReferenceSchema.parse({
    stage: row.stage,
    reference: row.input_ref_json,
  });
  if (row.result_ref_json !== null) {
    aiDeckGenerationStageResultReferenceSchema.parse({
      stage: row.stage,
      reference: row.result_ref_json,
    });
  }
  return {
    pipelineJobId: row.pipeline_job_id,
    stage: row.stage,
    shardKey: row.shard_key,
    status: row.status,
    attempt: row.attempt,
    inputRef: row.input_ref_json,
    resultRef: row.result_ref_json,
    error: row.error_json,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: optionalIso(row.lease_expires_at),
    dispatchedAt: optionalIso(row.dispatched_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function dispatchableFromRow(
  rawRow: unknown,
): DispatchableAiDeckGenerationStage {
  const row = dispatchableCheckpointRowSchema.parse(rawRow);
  return {
    message: aiDeckGenerationStageMessageSchema.parse({
      pipelineJobId: row.pipeline_job_id,
      projectId: row.project_id,
      stage: row.stage,
      shardKey: row.shard_key,
    }),
    attempt: row.attempt,
  };
}

function firstQueryRow(queryResult: unknown): unknown | null {
  if (!Array.isArray(queryResult)) return null;
  const first = queryResult[0];
  if (Array.isArray(first)) return first[0] ?? null;
  return first ?? null;
}

function queryRows(queryResult: unknown): unknown[] {
  if (!Array.isArray(queryResult)) return [];
  const first = queryResult[0];
  return Array.isArray(first) ? first : queryResult;
}

function optionalIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
