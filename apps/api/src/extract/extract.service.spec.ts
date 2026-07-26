import type { Job } from "@orbit/shared/jobs";
import type { PinoLogger } from "nestjs-pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobsService } from "../jobs/jobs.service";
import { ExtractService } from "./extract.service";

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
  DEMO_SESSION_ID: "session_demo_1"
};

describe("ExtractService", () => {
  beforeEach(() => {
    Object.assign(process.env, validEnv);
  });

  it("creates a DB job and enqueues the BullMQ reference extraction job", async () => {
    const job: Job = {
      jobId: "job-1",
      projectId: "project-a",
      type: "reference-extract",
      status: "queued",
      progress: 0,
      message: "Job queued",
      result: null,
      error: null,
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z"
    };
    const jobsService = {
      create: vi.fn(async () => job),
      update: vi.fn()
    } as unknown as JobsService;
    const enqueueJob = vi.fn(async () => undefined);

    const logger = createLogger();
    const result = await new ExtractService(jobsService, enqueueJob, logger).extract(
      [
        {
          originalname: "sample.txt",
          mimetype: "text/plain",
          buffer: Buffer.from("hello")
        }
      ],
      "project-a"
    );

    expect(result).toEqual({ files: [], job });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "job.enqueued",
        jobId: "job-1",
        jobType: "reference-extract",
        projectId: "project-a",
        fileCount: 1
      }),
      "Reference extraction job enqueued."
    );
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: "project-a",
      type: "reference-extract",
      payload: {
        files: [
          {
            fileId: expect.stringMatching(/^file_/),
            originalName: "sample.txt",
            mimeType: "text/plain",
            contentBase64: Buffer.from("hello").toString("base64")
          }
        ]
      }
    });
    expect(enqueueJob).toHaveBeenCalledWith({
      driver: "bullmq",
      redisUrl: "redis://localhost:6379",
      jobId: "job-1",
      projectId: "project-a",
      files: [
        {
          fileId: expect.stringMatching(/^file_/),
          originalName: "sample.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("hello").toString("base64")
        }
      ]
    });
  });

  it("keeps multiple project assets and fileIds in one ordered job payload", async () => {
    const job: Job = {
      jobId: "job-2",
      projectId: "project-a",
      type: "reference-extract",
      status: "queued",
      progress: 0,
      message: "Job queued",
      result: null,
      error: null,
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z"
    };
    const jobsService = {
      create: vi.fn(async () => job),
      update: vi.fn()
    } as unknown as JobsService;
    const enqueueJob = vi.fn(async () => undefined);

    await new ExtractService(jobsService, enqueueJob, createLogger()).extract(
      [
        {
          originalname: "design.pptx",
          mimetype:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          buffer: Buffer.from("pptx")
        },
        {
          originalname: "brief.pdf",
          mimetype: "application/pdf",
          buffer: Buffer.from("pdf")
        }
      ],
      "project-a",
      ["file_design_1", "file_brief_2"]
    );

    const files = [
      {
        fileId: "file_design_1",
        originalName: "design.pptx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        contentBase64: Buffer.from("pptx").toString("base64")
      },
      {
        fileId: "file_brief_2",
        originalName: "brief.pdf",
        mimeType: "application/pdf",
        contentBase64: Buffer.from("pdf").toString("base64")
      }
    ];
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: "project-a",
      type: "reference-extract",
      payload: { files }
    });
    expect(enqueueJob).toHaveBeenCalledWith({
      driver: "bullmq",
      redisUrl: "redis://localhost:6379",
      jobId: "job-2",
      projectId: "project-a",
      files
    });
  });
});

function createLogger() {
  return {
    info: vi.fn(),
    error: vi.fn()
  } as unknown as PinoLogger;
}
