import type { Job } from "@orbit/shared";
import type { PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobsService } from "./jobs.service";

const validEnv = {
  NODE_ENV: "test",
  APP_ENV: "local",
  WEB_PORT: "5173",
  API_PORT: "3000",
  WORKER_PORT: "3001",
  PYTHON_WORKER_PORT: "8000",
  WEB_ORIGIN: "http://localhost:5173",
  API_BASE_URL: "http://localhost:3000",
  PYTHON_WORKER_URL: "http://localhost:8000",
  DATABASE_URL: "postgres://orbit:orbit@localhost:5432/orbit",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "local-session-secret-change-me",
  COOKIE_SECRET: "local-cookie-secret-change-me",
  STORAGE_DRIVER: "minio",
  S3_ENDPOINT: "http://localhost:9000",
  S3_PUBLIC_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "orbit-local",
  S3_REGION: "ap-northeast-2",
  S3_ACCESS_KEY_ID: "orbit",
  S3_SECRET_ACCESS_KEY: "orbit-password",
  S3_FORCE_PATH_STYLE: "true",
  JOB_QUEUE_DRIVER: "bullmq",
  ASYNC_JOB_ADMISSION_MODE: "accept",
  LIVE_STT_PROVIDER: "sherpa",
  REPORT_STT_PROVIDER: "openai",
  OCR_PROVIDER: "python",
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "gpt-4.1-mini",
  OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-transcribe",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
  AWS_REGION: "ap-northeast-2",
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  TRANSCRIBE_LANGUAGE_CODE: "ko-KR",
  TEXTRACT_ENABLED: "false",
  LOG_LEVEL: "debug",
  LOG_PRETTY: "false",
  DEMO_USER_ID: "user_demo_1",
  DEMO_WORKSPACE_ID: "workspace_demo_1",
  DEMO_PROJECT_ID: "project_demo_1",
  DEMO_DECK_ID: "deck_demo_1",
  DEMO_SESSION_ID: "session_demo_1",
};

const queuedRow = {
  job_id: "job-1",
  project_id: "project-a",
  type: "worker-health-check",
  status: "queued",
  progress: 0,
  message: "Job queued",
  payload: null,
  result: null,
  error: null,
  created_at: "2026-06-27T00:00:00.000Z",
  updated_at: "2026-06-27T00:00:00.000Z",
};

describe("JobsService", () => {
  beforeEach(() => {
    Object.assign(process.env, validEnv);
  });

  it("enqueues ORBIT-94 worker health check jobs after DB creation", async () => {
    const query = vi.fn().mockResolvedValueOnce([queuedRow]);
    const enqueue = vi.fn(async () => undefined);
    const service = new JobsService(
      { query } as unknown as DataSource,
      enqueue,
      createLogger(),
    );

    const job = await service.create({
      projectId: "project-a",
      type: "worker-health-check",
    });

    expect(job).toEqual(jobFromRow(queuedRow));
    expect(enqueue).toHaveBeenCalledWith({
      driver: "bullmq",
      redisUrl: "redis://localhost:6379",
      jobId: "job-1",
      projectId: "project-a",
    });
  });

  it("rejects every new job before a DB row is created while admission drains", async () => {
    process.env.ASYNC_JOB_ADMISSION_MODE = "drain";
    const query = vi.fn();
    const service = new JobsService(
      { query } as unknown as DataSource,
      vi.fn(),
      createLogger(),
    );

    await expect(
      service.create({
        projectId: "project-a",
        type: "reference-extract",
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(query).not.toHaveBeenCalled();
  });

  it("marks worker health check jobs failed when enqueue fails", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([queuedRow])
      .mockResolvedValueOnce([
        {
          ...queuedRow,
          status: "failed",
          message: "Worker health check enqueue failed.",
          error: {
            code: "WORKER_HEALTH_CHECK_ENQUEUE_FAILED",
            message: "redis down",
          },
        },
      ]);
    const enqueue = vi.fn(async () => {
      throw new Error("redis down");
    });
    const service = new JobsService(
      { query } as unknown as DataSource,
      enqueue,
      createLogger(),
    );

    await expect(
      service.create({
        projectId: "project-a",
        type: "worker-health-check",
      }),
    ).rejects.toThrow("redis down");

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1]).toEqual(
      expect.arrayContaining([
        "job-1",
        "failed",
        0,
        "Worker health check enqueue failed.",
        {
          code: "WORKER_HEALTH_CHECK_ENQUEUE_FAILED",
          message: "redis down",
        },
      ]),
    );
  });

  it("loads the latest OOXML sync job for the requested Deck version", async () => {
    const syncRow = {
      ...queuedRow,
      job_id: "job-sync-145",
      type: "pptx-ooxml-sync",
      payload: { deckId: "deck-a", targetDeckVersion: 145 },
    };
    const query = vi.fn().mockResolvedValueOnce([syncRow]);
    const service = new JobsService(
      { query } as unknown as DataSource,
      vi.fn(async () => undefined),
      createLogger(),
    );

    await expect(
      service.getLatestPptxOoxmlSync("project-a", "deck-a", 145),
    ).resolves.toMatchObject({
      jobId: "job-sync-145",
      type: "pptx-ooxml-sync",
      status: "queued",
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("payload ->> 'targetDeckVersion'"),
      ["project-a", "deck-a", 145],
    );
  });

  it("retries only failed image shards and invalidates downstream checkpoints", async () => {
    const failedRow = {
      ...queuedRow,
      type: "ai-deck-generation",
      status: "failed",
      progress: 70,
      error: {
        code: "AI_DECK_EXECUTION_INTERNAL_ERROR",
        message: "AI deck execution stage could not be completed.",
        failedStage: "image-slide",
        retryable: true,
      },
    };
    const runningRow = {
      ...failedRow,
      status: "running",
      progress: 60,
      message: "AI deck generation retry queued.",
      result: null,
      error: null,
    };
    const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
      const compact = sql.replace(/\s+/g, " ");
      if (compact.includes("SELECT * FROM jobs")) return [failedRow];
      if (compact.includes("DELETE FROM ai_deck_generation_stages")) return [];
      if (compact.includes("DELETE FROM ai_deck_execution_artifacts"))
        return [];
      if (compact.includes("UPDATE ai_deck_generation_stages")) {
        return [{ pipeline_job_id: "job-1" }];
      }
      if (compact.includes("UPDATE jobs")) return [runningRow];
      throw new Error(`Unexpected SQL: ${compact}`);
    });
    const dataSource = {
      query,
      transaction: vi.fn(
        async (run: (manager: { query: typeof query }) => unknown) =>
          run({ query }),
      ),
    } as unknown as DataSource;
    const logger = createLogger();
    const service = new JobsService(dataSource, vi.fn(), logger);

    await expect(
      service.retryAiDeckGeneration("project-a", "job-1"),
    ).resolves.toMatchObject({
      job: { status: "running", progress: 60, error: null },
      failedStage: "image-slide",
      restartCoordinator: false,
    });

    const downstreamDelete = query.mock.calls.find(([sql]) =>
      String(sql).includes("DELETE FROM ai_deck_generation_stages"),
    );
    expect(downstreamDelete?.[1]).toEqual([
      "job-1",
      ["semantic-quality", "rendered-visual-quality", "publication"],
    ]);
    const shardReset = query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE ai_deck_generation_stages"),
    );
    expect(shardReset?.[1]).toEqual(["job-1", "image-slide"]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai_deck.retry_queued",
        failedStage: "image-slide",
      }),
      "AI deck generation retry queued.",
    );
  });

  it("rejects AI deck retries before opening a transaction while admission drains", async () => {
    process.env.ASYNC_JOB_ADMISSION_MODE = "drain";
    const transaction = vi.fn();
    const service = new JobsService(
      { transaction } as unknown as DataSource,
      vi.fn(),
      createLogger(),
    );

    await expect(
      service.retryAiDeckGeneration("project-a", "job-1"),
    ).rejects.toMatchObject({ status: 503 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("restarts the coordinator only when no failed reference checkpoint exists", async () => {
    const failedRow = {
      ...queuedRow,
      type: "ai-deck-generation",
      status: "failed",
      error: {
        code: "AI_DECK_COORDINATOR_FAILED",
        message: "AI deck staged coordinator failed.",
        failedStage: "reference-extract-file",
        retryable: true,
      },
    };
    const runningRow = {
      ...failedRow,
      status: "running",
      progress: 5,
      message: "AI deck generation retry queued.",
      result: null,
      error: null,
    };
    const query = vi.fn(async (sql: string) => {
      const compact = sql.replace(/\s+/g, " ");
      if (compact.includes("SELECT * FROM jobs")) return [failedRow];
      if (compact.includes("DELETE FROM ai_deck_generation_stages")) return [];
      if (compact.includes("DELETE FROM ai_deck_execution_artifacts"))
        return [];
      if (compact.includes("UPDATE ai_deck_generation_stages")) return [];
      if (compact.includes("UPDATE jobs")) return [runningRow];
      throw new Error(`Unexpected SQL: ${compact}`);
    });
    const dataSource = {
      query,
      transaction: vi.fn(
        async (run: (manager: { query: typeof query }) => unknown) =>
          run({ query }),
      ),
    } as unknown as DataSource;
    const service = new JobsService(dataSource, vi.fn(), createLogger());

    await expect(
      service.retryAiDeckGeneration("project-a", "job-1"),
    ).resolves.toMatchObject({
      job: { status: "running", progress: 5 },
      failedStage: "reference-extract-file",
      restartCoordinator: true,
    });
  });
});

function jobFromRow(row: typeof queuedRow): Job {
  return {
    jobId: row.job_id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    message: row.message,
    result: row.result,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as Job;
}

function createLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
}
