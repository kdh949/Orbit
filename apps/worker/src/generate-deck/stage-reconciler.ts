import {
  jobErrorSchema,
  jobSchema,
  jobStatusSchema,
  type AiDeckGenerationStageMessage,
  type Job,
  type JobError,
} from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { z } from "zod";

import { recoverAiDeckReferenceExtractionJoinInTransaction } from "./reference-extraction-join";
import { AiDeckGenerationStageCheckpointRepository } from "./stage-checkpoint-repository";

type QueryExecutor = Pick<DataSource, "query">;
const timestampSchema = z.union([z.date(), z.string().min(1)]);
const parentJobRowSchema = z.object({
  job_id: z.string().min(1),
  project_id: z.string().min(1),
  type: z.literal("ai-deck-generation"),
  status: jobStatusSchema,
  progress: z.number().int().min(0).max(100),
  message: z.string(),
  result: z.record(z.unknown()).nullable(),
  error: jobErrorSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export interface AiDeckStageReconcilerOptions {
  limit?: number;
  recoverJoin?: (
    db: QueryExecutor,
    message: AiDeckGenerationStageMessage,
  ) => Promise<Job>;
  onError?: (error: unknown, message: AiDeckGenerationStageMessage) => void;
}

export async function reconcileExpiredAiDeckStageLeases(
  dataSource: DataSource,
  options: AiDeckStageReconcilerOptions = {},
): Promise<{
  scanned: number;
  requeued: number;
  failed: number;
  terminalJobs: Job[];
}> {
  const expired = await new AiDeckGenerationStageCheckpointRepository(
    dataSource,
  ).listExpiredLeases(options.limit ?? 100);
  let requeued = 0;
  let failed = 0;
  const terminalJobs: Job[] = [];

  for (const candidate of expired) {
    try {
      const result = await dataSource.transaction(async (manager) => {
        const errors = leaseErrors(candidate.message);
        const parentRows = await manager.query(
          `
            SELECT job_id
            FROM jobs
            WHERE job_id = $1
              AND project_id = $2
              AND type = 'ai-deck-generation'
              AND status IN ('queued','running')
            FOR UPDATE
          `,
          [candidate.message.pipelineJobId, candidate.message.projectId],
        );
        if (!hasQueryRow(parentRows)) return null;

        const checkpoint = await new AiDeckGenerationStageCheckpointRepository(
          manager,
        ).reconcileExpiredLease(
          candidate.message,
          candidate.attempt,
          errors.retry,
          errors.exhausted,
        );
        if (!checkpoint) return null;
        if (checkpoint.status === "failed") {
          const parentJob =
            candidate.message.stage === "reference-extract-file"
              ? await (
                  options.recoverJoin ??
                  recoverAiDeckReferenceExtractionJoinInTransaction
                )(manager, candidate.message)
              : await failPlanningParent(
                  manager,
                  candidate.message,
                  jobErrorSchema.parse({
                    ...errors.exhausted,
                    retryable: true,
                  }),
                );
          return { status: checkpoint.status, parentJob };
        }
        return { status: checkpoint.status, parentJob: null };
      });
      if (result?.status === "queued") requeued += 1;
      if (result?.status === "failed") failed += 1;
      if (
        result?.parentJob?.status === "failed" ||
        result?.parentJob?.status === "succeeded"
      ) {
        terminalJobs.push(result.parentJob);
      }
    } catch (error) {
      options.onError?.(error, candidate.message);
    }
  }

  return { scanned: expired.length, requeued, failed, terminalJobs };
}

function leaseErrors(message: AiDeckGenerationStageMessage): {
  retry: JobError;
  exhausted: JobError;
} {
  const reference = message.stage === "reference-extract-file";
  return {
    retry: jobErrorSchema.parse({
      code: reference
        ? "REFERENCE_EXTRACTION_LEASE_EXPIRED"
        : "AI_DECK_PLANNING_LEASE_EXPIRED",
      message: reference
        ? "Reference extraction lease expired before completion."
        : "AI deck planning lease expired before completion.",
      failedStage: message.stage,
      retryable: true,
    }),
    exhausted: jobErrorSchema.parse({
      code: reference
        ? "REFERENCE_EXTRACTION_LEASE_EXHAUSTED"
        : "AI_DECK_PLANNING_LEASE_EXHAUSTED",
      message: reference
        ? "Reference extraction lease retries were exhausted."
        : "AI deck planning lease retries were exhausted.",
      failedStage: message.stage,
      retryable: false,
    }),
  };
}

async function failPlanningParent(
  db: QueryExecutor,
  message: AiDeckGenerationStageMessage,
  error: JobError,
): Promise<Job | null> {
  const rows = await db.query(
    `
      UPDATE jobs
      SET status = 'failed',
          message = 'AI deck generation failed.',
          error = $3::jsonb,
          updated_at = now()
      WHERE job_id = $1
        AND project_id = $2
        AND type = 'ai-deck-generation'
        AND status IN ('queued','running')
      RETURNING *
    `,
    [message.pipelineJobId, message.projectId, error],
  );
  const raw = firstQueryRow(rows);
  if (!raw) return null;
  const row = parentJobRowSchema.parse(raw);
  return jobSchema.parse({
    jobId: row.job_id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    message: row.message,
    result: row.result,
    error: row.error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function hasQueryRow(queryResult: unknown): boolean {
  if (!Array.isArray(queryResult)) return false;
  const first = queryResult[0];
  return Array.isArray(first) ? first.length > 0 : first !== undefined;
}

function firstQueryRow(queryResult: unknown): unknown | null {
  if (!Array.isArray(queryResult)) return null;
  const first = queryResult[0];
  if (Array.isArray(first)) return first[0] ?? null;
  return first ?? null;
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
