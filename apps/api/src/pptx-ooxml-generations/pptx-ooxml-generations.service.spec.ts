import type { Job } from "@orbit/shared/jobs";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FilesService } from "../files/files.service";
import type { JobsService } from "../jobs/jobs.service";
import type { ProjectsService } from "../projects/projects.service";
import { PptxOoxmlGenerationsService } from "./pptx-ooxml-generations.service";

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
  STT_PROVIDER: "sherpa",
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
  DEMO_USER_ID: "user_demo_1",
  DEMO_WORKSPACE_ID: "workspace_demo_1",
  DEMO_PROJECT_ID: "project_demo_1",
  DEMO_DECK_ID: "deck_demo_1",
  DEMO_SESSION_ID: "session_demo_1"
};

const pptxMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

describe("PptxOoxmlGenerationsService", () => {
  beforeEach(() => {
    Object.assign(process.env, validEnv);
  });

  it.each([
    {
      expectedPreference: "editability-first" as const,
      label: "legacy default",
      request: { fileId: "file_template" }
    },
    {
      expectedPreference: "appearance-first" as const,
      label: "explicit appearance preference",
      request: {
        fileId: "file_template",
        importPreference: "appearance-first" as const
      }
    }
  ])("creates and enqueues a generation job with $label", async ({
    expectedPreference,
    request
  }) => {
    const job = createJob();
    const services = createServices({
      jobsService: {
        create: vi.fn(async () => job),
        update: vi.fn()
      } as unknown as JobsService,
      filesService: {
        getUploadedAsset: vi.fn(async () => ({
          fileId: "file_template",
          projectId: "project-a",
          mimeType: pptxMimeType,
          purpose: "pptx-import"
        }))
      } as unknown as FilesService
    });
    const enqueueJob = vi.fn(async () => undefined);

    const result = await new PptxOoxmlGenerationsService(
      services.jobsService,
      services.projectsService,
      services.filesService,
      enqueueJob
    ).createGeneration("project-a", request);

    expect(result).toEqual({ job });
    expect(services.filesService.getUploadedAsset).toHaveBeenCalledWith(
      "project-a",
      "file_template",
      "pptx-import"
    );
    expect(services.jobsService.create).toHaveBeenCalledWith({
      projectId: "project-a",
      type: "pptx-ooxml-generation",
      payload: {
        request: {
          fileId: "file_template",
          importPreference: expectedPreference
        }
      }
    });
    expect(enqueueJob).toHaveBeenCalledWith({
      driver: "bullmq",
      redisUrl: "redis://localhost:6379",
      jobId: "job-ooxml",
      projectId: "project-a",
      request: {
        fileId: "file_template",
        importPreference: expectedPreference
      }
    });
  });

  it("rejects unsupported import preferences before job creation", async () => {
    const services = createServices({});
    const enqueueJob = vi.fn(async () => undefined);

    await expect(
      new PptxOoxmlGenerationsService(
        services.jobsService,
        services.projectsService,
        services.filesService,
        enqueueJob
      ).createGeneration("project-a", {
        fileId: "file_template",
        importPreference: "balanced"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(services.filesService.getUploadedAsset).not.toHaveBeenCalled();
    expect(services.jobsService.create).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it.each(["topic", "prompt", "extraField"])(
    "rejects unsupported request field %s before job creation",
    async (field) => {
      const services = createServices({});
      const enqueueJob = vi.fn(async () => undefined);

      await expect(
        new PptxOoxmlGenerationsService(
          services.jobsService,
          services.projectsService,
          services.filesService,
          enqueueJob
        ).createGeneration("project-a", {
          fileId: "file_template",
          [field]: "legacy value"
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(services.filesService.getUploadedAsset).not.toHaveBeenCalled();
      expect(services.jobsService.create).not.toHaveBeenCalled();
      expect(enqueueJob).not.toHaveBeenCalled();
    }
  );

  it("rejects non-PPTX uploaded files", async () => {
    const services = createServices({
      filesService: {
        getUploadedAsset: vi.fn(async () => ({
          fileId: "file_pdf",
          projectId: "project-a",
          mimeType: "application/pdf"
        }))
      } as unknown as FilesService
    });
    const enqueueJob = vi.fn(async () => undefined);

    await expect(
      new PptxOoxmlGenerationsService(
        services.jobsService,
        services.projectsService,
        services.filesService,
        enqueueJob
      ).createGeneration("project-a", { fileId: "file_pdf" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(services.jobsService.create).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("rejects missing file ids before enqueue", async () => {
    const services = createServices({
      filesService: {
        getUploadedAsset: vi.fn(async () => {
          throw new NotFoundException("Asset not found: file_missing");
        })
      } as unknown as FilesService
    });
    const enqueueJob = vi.fn(async () => undefined);

    await expect(
      new PptxOoxmlGenerationsService(
        services.jobsService,
        services.projectsService,
        services.filesService,
        enqueueJob
      ).createGeneration("project-a", { fileId: "file_missing" })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(services.jobsService.create).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it.each([
    ["project mismatch", new ForbiddenException("Project asset access denied")],
    ["pending status", new NotFoundException("Asset is not uploaded")],
    ["purpose mismatch", new ForbiddenException("Asset purpose must be pptx-import")]
  ])("propagates %s asset validation before job creation", async (_case, error) => {
    const services = createServices({
      filesService: {
        getUploadedAsset: vi.fn(async () => {
          throw error;
        })
      } as unknown as FilesService
    });
    const enqueueJob = vi.fn(async () => undefined);

    await expect(
      new PptxOoxmlGenerationsService(
        services.jobsService,
        services.projectsService,
        services.filesService,
        enqueueJob
      ).createGeneration("project-a", { fileId: "file_template" })
    ).rejects.toBe(error);
    expect(services.jobsService.create).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});

function createServices(overrides: {
  filesService?: FilesService;
  jobsService?: JobsService;
  projectsService?: ProjectsService;
}) {
  return {
    filesService: overrides.filesService ?? ({
      getUploadedAsset: vi.fn()
    } as unknown as FilesService),
    jobsService: overrides.jobsService ?? ({
      create: vi.fn(),
      update: vi.fn()
    } as unknown as JobsService),
    projectsService: overrides.projectsService ?? ({
      getAccessibleProject: vi.fn(async () => ({
        projectId: "project-a",
        workspaceId: "workspace_demo_1",
        title: "PPTX OOXML generation",
        createdBy: "user_demo_1",
        createdAt: "2026-07-03T00:00:00.000Z"
      }))
    } as unknown as ProjectsService)
  };
}

function createJob(): Job {
  return {
    jobId: "job-ooxml",
    projectId: "project-a",
    type: "pptx-ooxml-generation",
    status: "queued",
    progress: 0,
    message: "Job queued",
    result: null,
    error: null,
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z"
  };
}
