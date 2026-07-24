import {
  enqueueWorkerHealthCheckJob,
  type EnqueueJobInput,
  type EnqueueWorkerHealthCheckJobInput,
  type UpdateJobInput,
} from "@orbit/job-queue";
import { loadOrbitConfig } from "@orbit/config";
import {
  aiDeckGenerationStageSchema,
  jobErrorSchema,
  jobSchema,
} from "@orbit/shared";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";
import { DbJobQueue } from "./db-job-queue";
import { serializeLogError } from "../logging";
import { assertAsyncJobAdmissionOpen } from "./async-job-admission";

export type WorkerHealthCheckEnqueueJob = (
  input: EnqueueWorkerHealthCheckJobInput,
) => Promise<void>;

export const WORKER_HEALTH_CHECK_ENQUEUE_JOB =
  "WORKER_HEALTH_CHECK_ENQUEUE_JOB";

@Injectable()
export class JobsService {
  private readonly queue: DbJobQueue;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(WORKER_HEALTH_CHECK_ENQUEUE_JOB)
    private readonly enqueueWorkerHealthCheck: WorkerHealthCheckEnqueueJob,
    @InjectPinoLogger(JobsService.name)
    private readonly logger: PinoLogger,
  ) {
    this.queue = new DbJobQueue(dataSource);
  }

  async create(input: EnqueueJobInput) {
    assertAsyncJobAdmissionOpen();
    const queuedJob = await this.queue.enqueue(input);

    if (queuedJob.type !== "worker-health-check") {
      return queuedJob;
    }

    try {
      const config = loadOrbitConfig(process.env, { service: "api" });
      await this.enqueueWorkerHealthCheck({
        driver: config.JOB_QUEUE_DRIVER,
        redisUrl: config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId: queuedJob.projectId,
      });
      this.logger.info(
        {
          event: "job.enqueued",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId: queuedJob.projectId,
          driver: config.JOB_QUEUE_DRIVER,
        },
        "Worker health check job enqueued.",
      );
    } catch (error) {
      await this.queue.update(queuedJob.jobId, {
        status: "failed",
        progress: 0,
        message: "Worker health check enqueue failed.",
        error: {
          code: "WORKER_HEALTH_CHECK_ENQUEUE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Worker health check enqueue failed.",
        },
      });
      this.logger.error(
        {
          event: "job.enqueue_failed",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId: queuedJob.projectId,
          error: serializeLogError(error),
        },
        "Worker health check enqueue failed.",
      );
      throw error;
    }

    return queuedJob;
  }

  get(jobId: string) {
    return this.queue.get(jobId);
  }

  update(jobId: string, patch: UpdateJobInput) {
    return this.queue.update(jobId, patch);
  }

  async getLatestPptxOoxmlSync(
    projectId: string,
    deckId: string,
    targetDeckVersion: number,
  ) {
    const rows = await this.dataSource.query(
      `
        SELECT * FROM jobs
        WHERE project_id = $1
          AND type = 'pptx-ooxml-sync'
          AND payload ->> 'deckId' = $2
          AND (payload ->> 'targetDeckVersion')::integer = $3
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [projectId, deckId, targetDeckVersion],
    );
    const row = firstQueryRow(rows);
    return row ? jobSchema.parse(dbJobRowToJob(row)) : null;
  }

  async retryAiDeckGeneration(projectId: string, jobId: string) {
    assertAsyncJobAdmissionOpen();
    const retried = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `
          SELECT * FROM jobs
          WHERE job_id = $1 AND project_id = $2 AND type = 'ai-deck-generation'
          FOR UPDATE
        `,
        [jobId, projectId],
      );
      const raw = firstQueryRow(rows);
      if (!raw) throw new NotFoundException(`Job not found: ${jobId}`);
      const current = jobSchema.parse(dbJobRowToJob(raw));
      const error = current.error ? jobErrorSchema.parse(current.error) : null;
      if (
        current.status !== "failed" ||
        error?.retryable !== true ||
        !error.failedStage
      ) {
        throw new ConflictException("AI deck generation job is not retryable.");
      }
      const failedStage = aiDeckGenerationStageSchema.parse(error.failedStage);
      const downstream = downstreamStages(failedStage);

      if (downstream.length > 0) {
        await manager.query(
          `
            DELETE FROM ai_deck_generation_stages
            WHERE pipeline_job_id = $1 AND stage = ANY($2::text[])
          `,
          [jobId, downstream],
        );
      }
      await manager.query(
        `
          DELETE FROM ai_deck_execution_artifacts artifacts
          USING ai_deck_generation_stages stages
          WHERE artifacts.pipeline_job_id = $1
            AND artifacts.pipeline_job_id = stages.pipeline_job_id
            AND artifacts.stage = stages.stage
            AND artifacts.shard_key = stages.shard_key
            AND stages.stage = $2
            AND stages.status = 'failed'
        `,
        [jobId, failedStage],
      );
      const resetRows = await manager.query(
        `
          UPDATE ai_deck_generation_stages
          SET status = 'queued', attempt = 0,
              result_ref_json = NULL, error_json = NULL,
              lease_owner = NULL, lease_expires_at = NULL,
              dispatched_at = NULL, updated_at = now()
          WHERE pipeline_job_id = $1 AND stage = $2 AND status = 'failed'
          RETURNING pipeline_job_id
        `,
        [jobId, failedStage],
      );
      const restartCoordinator =
        failedStage === "reference-extract-file" && !hasQueryRow(resetRows);
      if (!hasQueryRow(resetRows) && !restartCoordinator) {
        throw new ConflictException("Failed AI deck checkpoint was not found.");
      }
      const updatedRows = await manager.query(
        `
          UPDATE jobs
          SET status = 'running', progress = $3,
              message = 'AI deck generation retry queued.',
              result = NULL, error = NULL, updated_at = now()
          WHERE job_id = $1 AND project_id = $2
            AND type = 'ai-deck-generation' AND status = 'failed'
          RETURNING *
        `,
        [jobId, projectId, retryProgress(failedStage)],
      );
      const updated = firstQueryRow(updatedRows);
      if (!updated)
        throw new ConflictException("AI deck retry could not be queued.");
      return {
        job: jobSchema.parse(dbJobRowToJob(updated)),
        failedStage,
        restartCoordinator,
      };
    });
    this.logger.info(
      {
        event: "ai_deck.retry_queued",
        jobId,
        projectId,
        failedStage: retried.failedStage,
      },
      "AI deck generation retry queued.",
    );
    return retried;
  }
}

export { enqueueWorkerHealthCheckJob };

const aiDeckStageOrder = aiDeckGenerationStageSchema.options;

function downstreamStages(stage: (typeof aiDeckStageOrder)[number]): string[] {
  const index = aiDeckStageOrder.indexOf(stage);
  return aiDeckStageOrder.slice(index + 1);
}

function retryProgress(stage: (typeof aiDeckStageOrder)[number]): number {
  const progress: Record<(typeof aiDeckStageOrder)[number], number> = {
    "reference-extract-file": 5,
    "source-grounding": 15,
    "content-planning": 25,
    "cover-slide": 40,
    "design-planning": 40,
    "layout-compile": 50,
    "image-slide": 60,
    "semantic-quality": 70,
    "rendered-visual-quality": 80,
    publication: 95,
  };
  return progress[stage];
}

function firstQueryRow(queryResult: unknown): Record<string, unknown> | null {
  if (!Array.isArray(queryResult)) return null;
  const first = queryResult[0];
  const row = Array.isArray(first) ? first[0] : first;
  return row && typeof row === "object"
    ? (row as Record<string, unknown>)
    : null;
}

function hasQueryRow(queryResult: unknown): boolean {
  return firstQueryRow(queryResult) !== null;
}

function dbJobRowToJob(row: Record<string, unknown>) {
  return {
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
  };
}

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString();
}
