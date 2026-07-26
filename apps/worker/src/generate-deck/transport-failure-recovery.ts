import {
  aiDeckGenerationStageQueueName,
  generateDeckQueueName,
  generateDeckStagedCoordinatorJobName,
} from "@orbit/job-queue";
import {
  aiDeckGenerationStageMessageSchema,
  jobErrorSchema,
  jobSchema,
  type AiDeckGenerationStageMessage,
  type Job,
  type JobError,
} from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { z } from "zod";

import { AiDeckGenerationStageCheckpointRepository } from "./stage-checkpoint-repository";

const coordinatorPayloadSchema = z
  .object({
    jobId: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
  })
  .strict();
const activeParentRowSchema = z.object({
  job_id: z.string().min(1),
  project_id: z.string().min(1),
  status: z.enum(["queued", "running"]),
});
const timestampSchema = z.union([z.date(), z.string().min(1)]);
const failedParentRowSchema = z.object({
  job_id: z.string().min(1),
  project_id: z.string().min(1),
  type: z.literal("ai-deck-generation"),
  status: z.literal("failed"),
  progress: z.number().int().min(0).max(100),
  message: z.string(),
  result: z.record(z.unknown()).nullable(),
  error: jobErrorSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export type AiDeckBullMqFailureRecoveryOutcome =
  | "coordinator-failed"
  | "stage-dispatch-released"
  | "ignored";

export type AiDeckBullMqFailureRecoveryResult =
  | { outcome: "coordinator-failed"; terminalJob: Job }
  | {
      outcome: "stage-dispatch-released" | "ignored";
      terminalJob: null;
    };

export interface AiDeckBullMqFinalFailureInput {
  queueName: string;
  jobName: string;
  data: unknown;
}

export async function recoverAiDeckBullMqFinalFailure(
  dataSource: DataSource,
  input: AiDeckBullMqFinalFailureInput,
): Promise<AiDeckBullMqFailureRecoveryResult> {
  if (
    input.queueName === generateDeckQueueName &&
    input.jobName === generateDeckStagedCoordinatorJobName
  ) {
    return failCoordinatorParent(dataSource, input.data);
  }
  if (implementedStageNames.has(input.jobName)) {
    const message = aiDeckGenerationStageMessageSchema.parse(input.data);
    if (
      message.stage !== input.jobName ||
      input.queueName !== aiDeckGenerationStageQueueName(message.stage)
    ) {
      return { outcome: "ignored", terminalJob: null };
    }
    return releaseStageDispatch(dataSource, message);
  }
  return { outcome: "ignored", terminalJob: null };
}

const implementedStageNames = new Set([
  "reference-extract-file",
  "source-grounding",
  "content-planning",
  "cover-slide",
  "design-planning",
  "layout-compile",
  "image-slide",
  "semantic-quality",
  "rendered-visual-quality",
  "publication",
]);

async function failCoordinatorParent(
  dataSource: DataSource,
  rawPayload: unknown,
): Promise<AiDeckBullMqFailureRecoveryResult> {
  const payload = coordinatorPayloadSchema.parse(rawPayload);
  const error = coordinatorFailureError();
  return dataSource.transaction(async (manager) => {
    const parent = await lockActiveParent(
      manager,
      payload.jobId,
      payload.projectId,
    );
    if (!parent) return { outcome: "ignored", terminalJob: null };

    await manager.query(
      `
        UPDATE ai_deck_generation_stages stages
        SET status = 'failed',
            result_ref_json = NULL,
            error_json = $2::jsonb,
            lease_owner = NULL,
            lease_expires_at = NULL,
            dispatched_at = NULL,
            updated_at = now()
        WHERE stages.pipeline_job_id = $1
          AND stages.status IN ('queued','running')
      `,
      [payload.jobId, error],
    );
    const rows = await manager.query(
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
      [payload.jobId, payload.projectId, error],
    );
    const row = firstQueryRow(rows);
    if (row === null) return { outcome: "ignored", terminalJob: null };
    return {
      outcome: "coordinator-failed",
      terminalJob: failedParentJob(failedParentRowSchema.parse(row)),
    };
  });
}

async function releaseStageDispatch(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage,
): Promise<AiDeckBullMqFailureRecoveryResult> {
  return dataSource.transaction(async (manager) => {
    const parent = await lockActiveParent(
      manager,
      message.pipelineJobId,
      message.projectId,
    );
    if (!parent) return { outcome: "ignored", terminalJob: null };
    const checkpoint = await new AiDeckGenerationStageCheckpointRepository(
      manager,
    ).releaseDispatchedForTransportRetry(message);
    return checkpoint
      ? { outcome: "stage-dispatch-released", terminalJob: null }
      : { outcome: "ignored", terminalJob: null };
  });
}

async function lockActiveParent(
  dataSource: Pick<DataSource, "query">,
  jobId: string,
  projectId: string,
): Promise<z.infer<typeof activeParentRowSchema> | null> {
  const rows = await dataSource.query(
    `
      SELECT job_id, project_id, status
      FROM jobs
      WHERE job_id = $1
        AND project_id = $2
        AND type = 'ai-deck-generation'
        AND status IN ('queued','running')
      FOR UPDATE
    `,
    [jobId, projectId],
  );
  const row = firstQueryRow(rows);
  return row === null ? null : activeParentRowSchema.parse(row);
}

function coordinatorFailureError(): JobError {
  return jobErrorSchema.parse({
    code: "AI_DECK_COORDINATOR_FAILED",
    message: "AI deck staged coordinator retries were exhausted.",
    failedStage: "reference-extract-file",
    retryable: true,
  });
}

function failedParentJob(row: z.infer<typeof failedParentRowSchema>): Job {
  return jobSchema.parse({
    jobId: row.job_id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    message: row.message,
    result: row.result,
    error: row.error,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  });
}

function isoTimestamp(value: z.infer<typeof timestampSchema>): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function firstQueryRow(queryResult: unknown): unknown | null {
  if (!Array.isArray(queryResult)) return null;
  const first = queryResult[0];
  if (Array.isArray(first)) return first[0] ?? null;
  return first ?? null;
}
