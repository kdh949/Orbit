import type { EnqueueGenerateDeckJobInput } from "@orbit/job-queue";
import { createDemoDeck } from "@orbit/editor-core";
import {
  generateDeckRequestSchema,
  type SavedDesignPackSnapshot,
} from "@orbit/shared/deck";
import { type Job } from "@orbit/shared/jobs";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilesService } from "../files/files.service";
import type { JobsService } from "../jobs/jobs.service";
import type { ProjectsService } from "../projects/projects.service";
import type { SavedDesignPacksService } from "../saved-design-packs/saved-design-packs.service";
import { GenerateDeckService } from "./generate-deck.service";

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
  AI_DECK_EXECUTION_MODE: "monolith",
  AI_DECK_WORKER_QUEUE: "all",
  AI_DECK_WORKER_CONCURRENCY: "5",
  AI_DECK_USER_CONCURRENCY: "5",
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
  DEMO_SESSION_ID: "session_demo_1",
  DEMO_AI_DECK_CACHE_ENABLED: "false",
  DEMO_AI_DECK_CACHE_ALLOW_PRODUCTION: "false",
  DEMO_AI_DECK_SOURCE_PROJECT_ID: "",
  DEMO_AI_DECK_TRIGGER_TOPIC: "",
  DEMO_FIXTURE_ENV_ALLOWLIST: ""
};

const productionValidEnv = {
  ...validEnv,
  APP_ENV: "production",
  WEB_ORIGIN: "https://app.example.com",
  API_BASE_URL: "https://api.example.com",
  PYTHON_WORKER_URL: "http://python-worker.internal:8000",
  DATABASE_URL: "postgres://orbit:orbit@prod-rds.example.com:5432/orbit",
  REDIS_URL: "rediss://prod-redis.example.com:6379",
  PRIVATE_EVIDENCE_REDIS_URL:
    "rediss://prod-private-evidence-redis.example.com:6379",
  SESSION_SECRET: "production-session-secret",
  COOKIE_SECRET: "production-cookie-secret",
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "",
  S3_PUBLIC_ENDPOINT: "https://assets.example.com",
  S3_BUCKET: "orbit-production",
  S3_ACCESS_KEY_ID: "",
  S3_SECRET_ACCESS_KEY: "",
  S3_FORCE_PATH_STYLE: "false",
  OPENAI_API_KEY: "test-production-openai-key-placeholder"
};

describe("GenerateDeckService", () => {
  beforeEach(() => {
    Object.assign(process.env, validEnv);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails service startup while the AI Deck SQS adapter is unavailable", () => {
    process.env.AI_DECK_EXECUTION_MODE = "sqs";

    expect(
      () =>
        new GenerateDeckService(
          {} as JobsService,
          {} as ProjectsService,
          vi.fn(),
        ),
    ).toThrow(/SQS.*not implemented/i);
  });

  it("allows a failed PostgreSQL checkpoint to be reset without BullMQ retry", async () => {
    process.env.AI_DECK_EXECUTION_MODE = "pg";
    const retriedJob = {
      jobId: "job-pg-retry",
      projectId: "project_generated_1",
      type: "ai-deck-generation",
      status: "running",
      progress: 40,
      message: "AI deck generation retry queued.",
      result: null,
      error: null,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:01:00.000Z",
    } satisfies Job;
    const jobsService = {
      retryAiDeckGeneration: vi.fn(async () => ({
        job: retriedJob,
        failedStage: "content-planning",
        restartCoordinator: false,
      })),
    } as unknown as JobsService;
    const service = new GenerateDeckService(
      jobsService,
      {} as ProjectsService,
      vi.fn(),
    );

    await expect(
      service.retryJob("project_generated_1", "job-pg-retry"),
    ).resolves.toEqual({ job: retriedJob });
  });

  it("creates a PostgreSQL job with the strict start response contract", async () => {
    process.env.AI_DECK_EXECUTION_MODE = "pg";
    const job = {
      jobId: "job-pg-design",
      projectId: "project_generated_1",
      type: "ai-deck-generation",
      status: "queued",
      progress: 0,
      message: "Job queued",
      result: null,
      error: null,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    } satisfies Job;
    const jobsService = {
      create: vi.fn(async () => job),
      update: vi.fn(),
    } as unknown as JobsService;
    const projectsService = {
      getAccessibleProject: vi.fn(async () => ({ projectId: job.projectId })),
    } as unknown as ProjectsService;

    const result = await new GenerateDeckService(
      jobsService,
      projectsService,
      vi.fn(async () => undefined),
    ).createJob(job.projectId, { topic: "Async design" });

    expect(result).toEqual({ job });
  });

  it("creates an AI deck generation job and enqueues the worker payload", async () => {
    const job: Job = {
      jobId: "job-1",
      projectId: "project_generated_1",
      type: "ai-deck-generation",
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
    const projectsService = {
      getAccessibleProject: vi.fn(async () => ({
        projectId: "project_generated_1",
        workspaceId: "workspace_demo_1",
        title: "AI 생성 덱",
        createdBy: "user_demo_1",
        createdAt: "2026-06-27T00:00:00.000Z"
      }))
    } as unknown as ProjectsService;
    const enqueueJob = vi.fn(async () => undefined);

    const result = await new GenerateDeckService(
      jobsService,
      projectsService,
      enqueueJob
    ).createJob("project_generated_1", {
      topic: "AI 덱 생성",
      designPrompt: "retro pixel palette",
      brief: {
        presentationContext: "internal planning",
        audienceText: "product team",
        presentationType: "planning proposal",
        durationMinutes: 12,
        referencePolicy: "references-first"
      },
      design: {
        stylePackId: "brandlogy-modern",
        paletteOverride: {
          primary: "#0EA5E9",
          text: "#0F172A",
          accentColor: "#0284C7"
        }
      },
      references: [{ fileId: "file_1" }]
    });

    expect(result).toEqual({ job });
    expect(projectsService.getAccessibleProject).toHaveBeenCalledWith(
      "project_generated_1"
    );
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: "project_generated_1",
      type: "ai-deck-generation",
      payload: {
        request: expect.objectContaining({
          topic: "AI 덱 생성",
          designPrompt: "retro pixel palette",
          brief: expect.objectContaining({
            presentationContext: "internal planning",
            referencePolicy: "references-first"
          }),
          design: expect.objectContaining({
            stylePackId: "brandlogy-modern",
            paletteOverride: {
              primary: "#0EA5E9",
              text: "#0F172A",
              accentColor: "#0284C7"
            }
          }),
          references: [{ fileId: "file_1" }]
        })
      }
    });
    expect(enqueueJob).toHaveBeenCalledWith({
      driver: "bullmq",
      executionMode: "monolith",
      redisUrl: "redis://localhost:6379",
      jobId: "job-1",
      projectId: "project_generated_1",
      request: expect.objectContaining({
        topic: "AI 덱 생성",
        designPrompt: "retro pixel palette",
        brief: expect.objectContaining({
          presentationContext: "internal planning"
        }),
        design: expect.objectContaining({
          stylePackId: "brandlogy-modern",
          paletteOverride: expect.objectContaining({
            primary: "#0EA5E9"
          })
        })
      })
    });
  });

  it("keeps a matching demo cache job queued and skips worker enqueue", async () => {
    Object.assign(process.env, {
      ...productionValidEnv,
      DEMO_AI_DECK_CACHE_ENABLED: "true",
      DEMO_AI_DECK_CACHE_ALLOW_PRODUCTION: "true",
      DEMO_AI_DECK_SOURCE_PROJECT_ID: "project-source",
      DEMO_AI_DECK_TRIGGER_TOPIC: "Orbit demo",
      DEMO_FIXTURE_ENV_ALLOWLIST: "production",
    });
    const job = queuedJob("job-demo-cache");
    const jobsService = {
      create: vi.fn(async () => job),
      update: vi.fn(),
    } as unknown as JobsService;
    const projectsService = {
      getAccessibleProject: vi.fn(async () => ({ projectId: job.projectId })),
      assertCanReadProject: vi.fn(async () => ({ projectId: "project-source" })),
    } as unknown as ProjectsService;
    const enqueueJob = vi.fn(async () => undefined);
    const dataSource = {
      query: vi.fn(async () => [{ deck_json: createDemoDeck() }]),
    };

    const result = await new GenerateDeckService(
      jobsService,
      projectsService,
      enqueueJob,
      undefined,
      undefined,
      undefined,
      dataSource as never,
    ).createJob(job.projectId, { topic: "  Orbit   demo  " }, "user_demo_1");

    expect(result).toEqual({ job });
    expect(projectsService.assertCanReadProject).toHaveBeenCalledWith(
      "project-source",
      "user_demo_1",
    );
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled", { DEMO_AI_DECK_CACHE_ENABLED: "false" }, "Orbit demo", "user_demo_1"],
    ["topic mismatch", {}, "Another topic", "user_demo_1"],
    ["user mismatch", {}, "Orbit demo", "user_other"],
    ["environment mismatch", { DEMO_FIXTURE_ENV_ALLOWLIST: "staging" }, "Orbit demo", "user_demo_1"],
  ])("enqueues normally when the demo cache misses by %s", async (_case, override, topic, userId) => {
    Object.assign(process.env, {
      DEMO_AI_DECK_CACHE_ENABLED: "true",
      DEMO_AI_DECK_SOURCE_PROJECT_ID: "project-source",
      DEMO_AI_DECK_TRIGGER_TOPIC: "Orbit demo",
      DEMO_FIXTURE_ENV_ALLOWLIST: "local",
      ...override,
    });
    const job = queuedJob(`job-cache-miss-${_case}`);
    const enqueueJob = vi.fn(async () => undefined);
    const projectsService = {
      getAccessibleProject: vi.fn(async () => ({ projectId: job.projectId })),
      assertCanReadProject: vi.fn(),
    } as unknown as ProjectsService;
    await new GenerateDeckService(
      { create: vi.fn(async () => job), update: vi.fn() } as unknown as JobsService,
      projectsService,
      enqueueJob,
    ).createJob(job.projectId, { topic }, userId);

    expect(enqueueJob).toHaveBeenCalledOnce();
    expect(projectsService.assertCanReadProject).not.toHaveBeenCalled();
  });

  it("returns DEMO_DECK_CACHE_UNAVAILABLE without falling back to AI", async () => {
    Object.assign(process.env, {
      DEMO_AI_DECK_CACHE_ENABLED: "true",
      DEMO_AI_DECK_SOURCE_PROJECT_ID: "project-source",
      DEMO_AI_DECK_TRIGGER_TOPIC: "Orbit demo",
      DEMO_FIXTURE_ENV_ALLOWLIST: "local",
    });
    const create = vi.fn();
    const enqueueJob = vi.fn();
    const service = new GenerateDeckService(
      { create, update: vi.fn() } as unknown as JobsService,
      {
        getAccessibleProject: vi.fn(async () => ({})),
        assertCanReadProject: vi.fn(async () => ({})),
      } as unknown as ProjectsService,
      enqueueJob,
      undefined,
      undefined,
      undefined,
      { query: vi.fn(async () => []) } as never,
    );

    const error = await service
      .createJob("project-target", { topic: "Orbit demo" }, "user_demo_1")
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      code: "DEMO_DECK_CACHE_UNAVAILABLE",
    });
    expect(create).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it.each([
    { generationMode: "legacy" },
    { generationMode: "design-pack" },
    { design: { engineVersion: "recipe-v1" } },
    { design: { engineVersion: "program-v2" } },
    { design: { slidePresetId: "process-cards-horizontal-6" } },
    { designReferences: [{ fileId: "file_design_1" }] },
    { templateBlueprintId: "template_file_design_1" }
  ])("rejects deprecated GenerateDeck fields before enqueue", async (field) => {
    const jobsService = {
      create: vi.fn(),
      update: vi.fn()
    } as unknown as JobsService;
    const projectsService = {
      getAccessibleProject: vi.fn(async () => ({
        projectId: "project_generated_1",
        workspaceId: "workspace_demo_1",
        title: "AI deck",
        createdBy: "user_demo_1",
        createdAt: "2026-06-27T00:00:00.000Z"
      }))
    } as unknown as ProjectsService;
    const enqueueJob = vi.fn();

    await expect(
      new GenerateDeckService(
        jobsService,
        projectsService,
        enqueueJob
      ).createJob("project_generated_1", {
        topic: "AI deck",
        ...field
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(jobsService.create).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("keeps the program-v2-only contract in the DB and worker payloads", async () => {
    const job: Job = {
      jobId: "job-design-pack",
      projectId: "project_generated_1",
      type: "ai-deck-generation",
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
    const projectsService = {
      getAccessibleProject: vi.fn(async () => ({
        projectId: "project_generated_1",
        workspaceId: "workspace_demo_1",
        title: "AI deck",
        createdBy: "user_demo_1",
        createdAt: "2026-06-27T00:00:00.000Z"
      }))
    } as unknown as ProjectsService;
    const enqueueJob = vi.fn(
      async (_input: EnqueueGenerateDeckJobInput) => undefined,
    );

    await new GenerateDeckService(
      jobsService,
      projectsService,
      enqueueJob
    ).createJob("project_generated_1", {
      topic: "AI deck",
      brief: {},
      slideCountRange: { min: 4, max: 4 },
      metadata: {},
      design: {
        stylePackId: "brandlogy-modern"
      }
    });

    expect(jobsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          request: expect.objectContaining({
            slideCountRange: { min: 4, max: 4 },
            design: expect.objectContaining({
              stylePackId: "brandlogy-modern"
            })
          })
        }
      })
    );
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          slideCountRange: { min: 4, max: 4 },
          design: expect.objectContaining({
            stylePackId: "brandlogy-modern"
          })
        })
      })
    );
    const storedRequest = vi.mocked(jobsService.create).mock.calls[0]![0]!
      .payload?.request;
    const queuedRequest = enqueueJob.mock.calls[0]![0].request;
    for (const request of [storedRequest, queuedRequest]) {
      expect(request).not.toHaveProperty("generationMode");
      expect(request).not.toHaveProperty("design.engineVersion");
      expect(request).not.toHaveProperty("design.slidePresetId");
      expect(request).not.toHaveProperty("designReferences");
      expect(request).not.toHaveProperty("templateBlueprintId");
    }
  });

  it("stores and enqueues the resolved Saved Design Pack request and snapshot", async () => {
    const job: Job = {
      jobId: "job-saved-design-pack",
      projectId: "project_generated_1",
      type: "ai-deck-generation",
      status: "queued",
      progress: 0,
      message: "Job queued",
      result: null,
      error: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z"
    };
    const jobsService = {
      create: vi.fn(async () => job),
      update: vi.fn()
    } as unknown as JobsService;
    const projectsService = {
      getAccessibleProject: vi.fn(async () => ({
        projectId: "project_generated_1",
        workspaceId: "workspace_demo_1",
        title: "Saved Design Pack deck",
        createdBy: "user_1",
        createdAt: "2026-07-15T00:00:00.000Z"
      }))
    } as unknown as ProjectsService;
    const resolvedRequest = generateDeckRequestSchema.parse({
      topic: "Saved Design Pack deck",
      savedDesignPack: { id: "design_pack_1", version: 3 },
      metadata: { tone: "confident" },
      design: {
        stylePackId: "brandlogy-modern",
        paletteOverride: {
          primary: "#123456",
          background: "#FFFFFF"
        },
        layoutDiversity: "stable",
        fontOverride: {
          fontId: "pretendard",
          name: "Pretendard",
          headingFontFamily: "Pretendard",
          bodyFontFamily: "Pretendard",
          fallbackFamily: "Arial",
          weights: [400, 700],
          supportsKorean: true,
          pptxEmbeddable: true,
          moodTags: ["professional"],
          license: "SIL Open Font License",
          sourceUrl: "https://github.com/orioncactus/pretendard"
        }
      }
    });
    const snapshot: SavedDesignPackSnapshot = {
      id: "design_pack_1",
      name: "Personal report",
      version: 3,
      baseStylePackId: "brandlogy-modern",
      preferences: {
        palette: { primary: "#123456", background: "#FFFFFF" },
        typography: {
          headingFontFamily: "Pretendard",
          bodyFontFamily: "Pretendard",
          fallbackFamily: "Arial",
          titleSizeScale: 1,
          bodySizeScale: 1,
          lineHeight: 1.24
        },
        tone: "confident",
        density: "low",
        titleStyle: "action",
        layoutPreference: "stable",
        imageDensity: "low",
        mediaPolicy: "minimal",
        referencePolicy: "topic-only",
        qaStrictness: "standard"
      }
    };
    const savedDesignPacksService = {
      resolveGenerationRequest: vi.fn(async () => ({
        request: resolvedRequest,
        snapshot
      }))
    } as unknown as SavedDesignPacksService;
    const enqueueJob = vi.fn(
      async (_input: EnqueueGenerateDeckJobInput) => undefined,
    );
    const rawBody = {
      topic: "Saved Design Pack deck",
      savedDesignPack: { id: "design_pack_1", version: 3 }
    };

    await new GenerateDeckService(
      jobsService,
      projectsService,
      enqueueJob,
      undefined,
      savedDesignPacksService
    ).createJob("project_generated_1", rawBody, "user_1");

    expect(
      savedDesignPacksService.resolveGenerationRequest
    ).toHaveBeenCalledWith(
      expect.objectContaining({ savedDesignPack: rawBody.savedDesignPack }),
      rawBody,
      "user_1"
    );
    const expectedPayload = {
      request: resolvedRequest,
      designPackSnapshot: snapshot,
      imageAssetScope: { userId: "user_1" },
      requestedByUserId: "user_1"
    };
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: "project_generated_1",
      type: "ai-deck-generation",
      payload: expectedPayload
    });
    expect(enqueueJob).toHaveBeenCalledWith({
      driver: "bullmq",
      executionMode: "monolith",
      redisUrl: "redis://localhost:6379",
      jobId: job.jobId,
      projectId: "project_generated_1",
      ...expectedPayload
    });
  });

  it("rejects invalid official assets", async () => {
    const jobsService = {
      create: vi.fn(),
      update: vi.fn()
    } as unknown as JobsService;
    const projectsService = {
      getAccessibleProject: vi.fn(async () => ({
        projectId: "project_generated_1",
        workspaceId: "workspace_demo_1",
        title: "AI deck",
        createdBy: "user_demo_1",
        createdAt: "2026-06-27T00:00:00.000Z"
      }))
    } as unknown as ProjectsService;
    const filesService = {
      getUploadedAsset: vi.fn(async () => ({
        fileId: "file_pdf",
        projectId: "project_generated_1",
        mimeType: "application/pdf"
      }))
    } as unknown as FilesService;

    const service = new GenerateDeckService(
      jobsService,
      projectsService,
      vi.fn(async () => undefined),
      filesService
    );
    await expect(
      service.createJob("project_generated_1", {
        topic: "AI deck",
        officialAssetFileIds: ["file_pdf"]
      })
    ).rejects.toThrow("Official assets must be uploaded image files.");
    expect(jobsService.create).not.toHaveBeenCalled();
  });

  it("accepts a non-demo project id for AI deck generation", async () => {
    const job: Job = {
      jobId: "job-2",
      projectId: "project_custom_1",
      type: "ai-deck-generation",
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
    const projectsService = {
      getAccessibleProject: vi.fn(async () => ({
        projectId: "project_custom_1",
        workspaceId: "workspace_demo_1",
        title: "프로젝트별 AI 덱 생성",
        createdBy: "user_demo_1",
        createdAt: "2026-06-27T00:00:00.000Z"
      }))
    } as unknown as ProjectsService;
    const enqueueJob = vi.fn(async () => undefined);

    const result = await new GenerateDeckService(
      jobsService,
      projectsService,
      enqueueJob
    ).createJob("project_custom_1", {
      topic: "프로젝트별 AI 덱 생성",
      references: []
    });

    expect(result).toEqual({ job });
    expect(projectsService.getAccessibleProject).toHaveBeenCalledWith(
      "project_custom_1"
    );
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: "project_custom_1",
      type: "ai-deck-generation",
      payload: {
        request: expect.objectContaining({
          topic: "프로젝트별 AI 덱 생성"
        })
      }
    });
  });

  it("proxies AI deck color option requests to the Python worker", async () => {
    const jobsService = {
      create: vi.fn(),
      update: vi.fn()
    } as unknown as JobsService;
    const projectsService = {
      getAccessibleProject: vi.fn()
    } as unknown as ProjectsService;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          options: [
            {
              optionId: "resort-blue",
              name: "Resort Blue",
              palette: {
                primary: "#0EA5E9",
                secondary: "#0369A1",
                background: "#F0F9FF",
                surface: "#FFFFFF",
                muted: "#E0F2FE",
                border: "#BAE6FD",
                text: "#0F172A",
                accentColor: "#F472B6"
              },
              rationale: "Relaxed blue."
            },
            {
              optionId: "executive-blue",
              name: "Executive Blue",
              palette: {
                primary: "#1D4ED8",
                secondary: "#334155",
                background: "#F8FAFC",
                surface: "#FFFFFF",
                muted: "#E2E8F0",
                border: "#CBD5E1",
                text: "#0F172A",
                accentColor: "#DB2777"
              },
              rationale: "Professional blue."
            },
            {
              optionId: "modern-violet",
              name: "Modern Violet",
              palette: {
                primary: "#7C3AED",
                secondary: "#4F46E5",
                background: "#FAF5FF",
                surface: "#FFFFFF",
                muted: "#EDE9FE",
                border: "#DDD6FE",
                text: "#18181B",
                accentColor: "#EC4899"
              },
              rationale: "Modern violet."
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GenerateDeckService(
      jobsService,
      projectsService,
      vi.fn(async () => undefined)
    ).createColorOptions({
      topic: "Travel strategy",
      colorMood: "resort blue",
      stylePackId: "brandlogy-modern"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/ai/deck-color-options",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          topic: "Travel strategy",
          colorMood: "resort blue",
          stylePackId: "brandlogy-modern"
        })
      })
    );
    expect(result.options).toHaveLength(3);
    expect(result.options[0]?.palette.primary).toBe("#0EA5E9");
  });

  it("proxies one strict AI palette customization without changing the base", async () => {
    const basePalette = {
      primary: "#6846D8",
      secondary: "#1F1D3D",
      background: "#F7F7F5",
      surface: "#FFFFFF",
      muted: "#F1ECFF",
      border: "#E6E6E6",
      text: "#090909",
      accentColor: "#C5B0F4"
    };
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          option: {
            optionId: "ai-custom",
            name: "따뜻한 라일락",
            palette: { ...basePalette, accentColor: "#D97706" },
            rationale: "포인트 색상만 따뜻하게 조정했습니다."
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GenerateDeckService(
      {} as JobsService,
      {} as ProjectsService,
      vi.fn(async () => undefined)
    ).customizeColorPalette({
      topic: "제품 전략",
      instruction: "포인트 색상만 따뜻하게",
      basePalette,
      stylePackId: "brandlogy-modern",
      tone: "professional"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/ai/deck-color-customization",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          topic: "제품 전략",
          instruction: "포인트 색상만 따뜻하게",
          basePalette,
          stylePackId: "brandlogy-modern",
          tone: "professional"
        })
      })
    );
    expect(result.option.palette.accentColor).toBe("#D97706");
    expect(basePalette.accentColor).toBe("#C5B0F4");
  });
});

function queuedJob(jobId: string): Job {
  return {
    jobId,
    projectId: "project-target",
    type: "ai-deck-generation",
    status: "queued",
    progress: 0,
    message: "Job queued",
    result: null,
    error: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
}
