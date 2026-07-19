import {
  deckSchema,
  type AssetUploadUrlResponse,
  type Deck,
  type Job,
  type PresentationBrief,
  type RehearsalFocusProfile,
} from "@orbit/shared";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { PinoLogger } from "nestjs-pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import type { DecksService } from "../decks/decks.service";
import type { FilesService } from "../files/files.service";
import type { ProjectAssetEntity } from "../files/project-asset.entity";
import type { JobsService } from "../jobs/jobs.service";
import type { ProjectsService } from "../projects/projects.service";
import type { PresentationBriefsService } from "../presentation-briefs/presentation-briefs.service";
import { RehearsalRunEntity } from "./rehearsal-run.entity";
import type { ProjectEntity } from "../projects/project.entity";
import type {
  RehearsalTranscriptCache,
  RedisRehearsalTranscriptCache,
} from "./rehearsal-transcript-cache";
import {
  RehearsalsService,
  type RehearsalSemanticEvaluationEnqueueJob,
  type RehearsalSttEnqueueJob,
} from "./rehearsals.service";

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
  DEMO_SESSION_ID: "session_demo_1",
};

const createdAt = new Date("2026-06-27T00:00:00.000Z");
const rawAudioDeletedAt = "2026-06-27T00:00:05.000Z";

const job: Job = {
  jobId: "job-1",
  projectId: "project-a",
  type: "rehearsal-stt",
  status: "queued",
  progress: 0,
  message: "Job queued",
  result: null,
  error: null,
  createdAt: createdAt.toISOString(),
  updatedAt: createdAt.toISOString(),
};

const semanticRetryJob: Job = {
  ...job,
  jobId: "job-semantic-retry",
  type: "rehearsal-semantic-evaluation",
};

const upload: AssetUploadUrlResponse = {
  fileId: "file-audio",
  projectId: "project-a",
  uploadUrl:
    "http://localhost:5173/api/v1/projects/project-a/assets/file-audio/content",
  method: "PUT",
  headers: { "content-type": "audio/webm" },
  expiresAt: "2026-06-27T00:15:00.000Z",
  purpose: "rehearsal-audio",
};

const rehearsalReport = {
  reportId: "report_run-1",
  runId: "run-1",
  projectId: "project-a",
  deckId: "deck-a",
  transcriptRetained: false,
  transcript: null,
  metrics: {
    durationSeconds: 30,
    wordsPerMinute: 120,
    fillerWordCount: 1,
    pauseCount: 0,
    keywordCoverage: 1,
  },
  coaching: {
    status: "succeeded",
    summary: "clear",
    strengths: ["키워드를 언급했습니다."],
    improvements: ["불필요한 filler를 줄이세요."],
    nextPracticeFocus: "도입부를 더 짧게 연습하세요.",
    message: "",
  },
  generatedAt: rawAudioDeletedAt,
};

describe("RehearsalsService", () => {
  beforeEach(() => {
    delete process.env.REHEARSAL_AUDIO_MAX_BYTES;
    Object.assign(process.env, validEnv);
  });

  it("creates a rehearsal run for the project deck", async () => {
    const service = createService();

    const result = await service.createRun("project-a", { deckId: "deck-a" });

    expect(result.run).toMatchObject({
      projectId: "project-a",
      deckId: "deck-a",
      audioFileId: null,
      jobId: null,
      status: "created",
      deckVersion: 3,
      semanticEvaluationMode: "full",
    });
    expect(result.run.runId).toMatch(/^run_/);
    expect(result.run.evaluationSnapshot).toMatchObject({
      deckId: "deck-a",
      deckVersion: 3,
      slides: [
        {
          slideId: "slide_1",
          semanticCues: [
            { cueId: "scue_approved", reviewStatus: "approved", revision: 2 },
            { cueId: "scue_excluded", reviewStatus: "excluded", revision: 1 },
          ],
        },
      ],
    });
    expect(JSON.stringify(result.run.evaluationSnapshot)).not.toContain(
      "민감한 발표자 노트",
    );
    expect(service.testLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "rehearsal.evaluation_snapshot.created",
        projectId: "project-a",
        deckId: "deck-a",
        deckVersion: 3,
        slideCount: 1,
        cueCount: 2,
      }),
      "Rehearsal evaluation snapshot created.",
    );
  });

  it("creates a rehearsal snapshot when a slide title and script are blank", async () => {
    const deck = createDeck();
    deck.slides[0]!.title = "   ";
    deck.slides[0]!.speakerNotes = "";
    const service = createService({ deck });

    const result = await service.createRun("project-a", { deckId: "deck-a" });

    expect(result.run.evaluationSnapshot?.slides[0]?.title).toBe("슬라이드 1");
  });

  it("binds uploaded slide snapshot assets to the immutable run snapshot", async () => {
    const getUploadedAsset = vi.fn(
      async () =>
        ({
          fileId: "file-slide-1",
          projectId: "project-a",
          purpose: "rehearsal-slide-snapshot",
          status: "uploaded",
          mimeType: "image/png",
        }) as ProjectAssetEntity,
    );
    const service = createService({ filesServicePatch: { getUploadedAsset } });

    const result = await service.createRun("project-a", {
      deckId: "deck-a",
      slideSnapshots: [{ slideId: "slide_1", fileId: "file-slide-1" }],
    });

    expect(getUploadedAsset).toHaveBeenCalledWith(
      "project-a",
      "file-slide-1",
      "rehearsal-slide-snapshot",
    );
    expect(result.run.evaluationSnapshot?.slides[0]?.thumbnailUrl).toBe(
      "/api/v1/projects/project-a/assets/file-slide-1/content",
    );
  });

  it("keeps the evaluation snapshot immutable after the live deck changes", async () => {
    const mutableDeck = createDeck();
    const service = createService({ deck: mutableDeck });
    const created = await service.createRun("project-a", {
      deckId: "deck-a",
      expectedDeckVersion: 3,
    });

    mutableDeck.version = 4;
    mutableDeck.slides[0]!.semanticCues[0]!.meaning = "편집 후 의미";

    const stored = await service.getRun(created.run.runId);
    expect(stored.run.deckVersion).toBe(3);
    expect(
      stored.run.evaluationSnapshot?.slides[0]?.semanticCues[0]?.meaning,
    ).toBe("승인된 원래 의미");
  });

  it("rejects a full run when the expected deck version is stale", async () => {
    const service = createService();

    await expect(
      service.createRun("project-a", {
        deckId: "deck-a",
        expectedDeckVersion: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("creates a delivery-only run without a semantic snapshot", async () => {
    const service = createService();

    const result = await service.createRun("project-a", {
      deckId: "deck-a",
      expectedDeckVersion: 2,
      semanticEvaluationMode: "delivery-only",
    });

    expect(result.run).toMatchObject({
      deckVersion: null,
      evaluationSnapshot: null,
      semanticEvaluationMode: "delivery-only",
    });
  });

  it("freezes adaptive Brief, Lens, deck hash, and evaluation criteria", async () => {
    const brief = {
      briefId: "brief_1",
      projectId: "project-a",
      revision: 1,
      audience: "decision-maker",
      purpose: "persuade",
      evaluatorLensRef: { lensId: "decision-maker", revision: 1 },
      targetDurationMinutes: 8,
      desiredOutcome: "승인을 얻는다.",
      requirements: [],
      terminology: [],
      challengeTopics: [],
      approvedReferences: [],
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    } as PresentationBrief;
    const focusProfile = {
      profileId: "focus_profile_1",
      projectId: "project-a",
      revision: 2,
      items: [
        {
          focusItemId: "focus_item_1",
          priority: 1,
          kind: "semantic-coverage",
          label: "고객 가치를 우선 확인한다.",
          targetScope: {
            type: "slide",
            scopeId: "focus_scope_slide_1",
            slideId: "slide_1",
          },
        },
      ],
      createdBy: "user-a",
      updatedBy: "user-a",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    } as RehearsalFocusProfile;
    const currentDeck = createDeck();
    const service = createService({
      presentationBrief: brief,
      focusProfile,
      deck: currentDeck,
    });

    const response = await service.createRun("project-a", {
      deckId: currentDeck.deckId,
      expectedDeckVersion: currentDeck.version,
      briefRef: {
        mode: "briefed",
        briefId: brief.briefId,
        expectedRevision: 1,
      },
      evaluatorLensRef: brief.evaluatorLensRef,
      sourceGoalSetId: null,
    });

    expect(response.run.evaluationSnapshot?.deckContentHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(response.run.evaluationSnapshot?.evaluationPlan?.briefRef).toEqual({
      mode: "briefed",
      briefId: "brief_1",
      revision: 1,
    });
    expect(
      response.run.evaluationSnapshot?.evaluationPlan?.criteria.length,
    ).toBeGreaterThan(0);
    expect(response.run.evaluationSnapshot?.focusProfileSnapshot).toEqual({
      profileRef: { profileId: "focus_profile_1", revision: 2 },
      items: focusProfile.items,
    });

    focusProfile.revision = 3;
    focusProfile.items[0]!.label = "변경된 목표";
    expect(response.run.evaluationSnapshot?.focusProfileSnapshot).toEqual({
      profileRef: { profileId: "focus_profile_1", revision: 2 },
      items: [expect.objectContaining({ label: "고객 가치를 우선 확인한다." })],
    });
  });

  it("rejects run creation when the deckId does not match the project deck", async () => {
    const service = createService();

    await expect(
      service.createRun("project-a", { deckId: "deck-other" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("creates an upload URL and pins the audio file to the run", async () => {
    const service = createService();
    const run = await createRun(service);

    const result = await service.createAudioUploadUrl(run.runId, {
      originalName: "rehearsal.webm",
      mimeType: "audio/webm",
      size: 1024,
    });

    expect(result.upload).toEqual(upload);
    expect(result.run).toMatchObject({
      runId: run.runId,
      audioFileId: "file-audio",
      status: "uploading",
    });
    expect(
      service.testFilesService.createRehearsalAudioUploadUrl,
    ).toHaveBeenCalledWith(
      "project-a",
      expect.objectContaining({
        originalName: "rehearsal.webm",
        mimeType: "audio/webm",
        size: 1024,
        purpose: "rehearsal-audio",
      }),
      expect.objectContaining({
        runId: run.runId,
        createdAt: expect.any(Date),
      }),
    );
  });

  it("uses REHEARSAL_AUDIO_MAX_BYTES when validating rehearsal uploads", async () => {
    Object.assign(process.env, {
      ...validEnv,
      REHEARSAL_AUDIO_MAX_BYTES: "1024",
    });
    const service = createService();
    const run = await createRun(service);

    await expect(
      service.createAudioUploadUrl(run.runId, {
        originalName: "rehearsal.flac",
        mimeType: "audio/flac",
        size: 1025,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(
      service.testFilesService.createRehearsalAudioUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it("rejects rehearsal uploads above the implemented OpenAI report STT limit", async () => {
    Object.assign(process.env, {
      ...validEnv,
      REHEARSAL_AUDIO_MAX_BYTES: "25000001",
    });

    expect(() => createService()).toThrow(/REHEARSAL_AUDIO_MAX_BYTES/);
  });

  it("completes upload, enqueues STT work, and marks the run processing", async () => {
    const enqueueJob = vi.fn(async () => undefined);
    const service = createService({ enqueueJob });
    const run = await createRun(service);
    await service.createAudioUploadUrl(run.runId, {
      originalName: "rehearsal.webm",
      mimeType: "audio/webm",
      size: 1024,
    });

    const result = await service.completeAudioUpload(run.runId, {
      fileId: "file-audio",
    });

    expect(result.run).toMatchObject({
      runId: run.runId,
      status: "processing",
      audioFileId: "file-audio",
      jobId: "job-1",
      rawAudioDeleteDeadlineAt: expect.any(String),
    });
    expect(
      Date.parse(result.run.rawAudioDeleteDeadlineAt ?? "") - Date.now(),
    ).toBeGreaterThan(13 * 24 * 60 * 60 * 1000);
    expect(result.job).toEqual(job);
    expect(enqueueJob).toHaveBeenCalledWith({
      driver: "bullmq",
      redisUrl: "redis://localhost:6379",
      jobId: "job-1",
      projectId: "project-a",
      runId: run.runId,
      deckId: "deck-a",
      audioFileId: "file-audio",
    });
  });

  it("does not create a job when audio upload verification fails", async () => {
    const jobsService = {
      create: vi.fn(async () => job),
      update: vi.fn(),
    } as unknown as JobsService;
    const service = createService({
      jobsService,
      filesServicePatch: {
        completeUpload: vi.fn(async () => {
          throw new BadRequestException("Asset size mismatch");
        }),
      },
    });
    const run = await createRun(service);
    await service.createAudioUploadUrl(run.runId, {
      originalName: "rehearsal.webm",
      mimeType: "audio/webm",
      size: 1024,
    });

    await expect(
      service.completeAudioUpload(run.runId, { fileId: "file-audio" }),
    ).rejects.toThrow("Asset size mismatch");

    expect(jobsService.create).not.toHaveBeenCalled();
    expect((await service.getRun(run.runId)).run).toMatchObject({
      status: "uploading",
      audioFileId: "file-audio",
      jobId: null,
    });
  });

  it("stores strict rehearsal run meta before audio completion", async () => {
    const service = createService();
    const run = await createRun(service);

    const result = await service.updateRunMeta(run.runId, {
      slideTimeline: [
        { slideId: "slide_1", enteredAt: "2026-07-02T00:00:00.000Z" },
      ],
      missedKeywords: [{ slideId: "slide_1", keywordId: "kw_1" }],
      adviceEvents: [{ type: "pace-too-fast", at: "2026-07-02T00:00:30.000Z" }],
    });

    expect(result.run.runId).toBe(run.runId);
    expect(
      (await service.testRehearsalRuns.findOne({ where: { runId: run.runId } }))
        ?.metaJson,
    ).toEqual({
        recordingDurationSeconds: null,
      slideTimeline: [
        { slideId: "slide_1", enteredAt: "2026-07-02T00:00:00.000Z" },
      ],
        missedKeywords: [{ slideId: "slide_1", keywordId: "kw_1" }],
        adviceEvents: [{ type: "pace-too-fast", at: "2026-07-02T00:00:30.000Z" }],
        utteranceOutcomes: [],
        semanticCueDecisions: [],
      semanticCapabilityEvents: [],
      });
  });

  it("preserves measured recording duration in rehearsal run meta", async () => {
    const service = createService();
    const run = await createRun(service);

    await service.updateRunMeta(run.runId, {
      recordingDurationSeconds: 90.25,
    });

    expect(
      (await service.testRehearsalRuns.findOne({ where: { runId: run.runId } }))
        ?.metaJson?.recordingDurationSeconds,
    ).toBe(90.25);
  });

  it("cancels an unprocessed run and excludes it from default run lists", async () => {
    const service = createService();
    const first = await createRun(service);
    const second = await createRun(service);

    const cancelled = await service.cancelRun(first.runId);
    const listed = await service.listRuns("project-a");

    expect(cancelled.run.status).toBe("cancelled");
    expect(listed.runs.map((run: { runId: string }) => run.runId)).toEqual([
      second.runId,
    ]);
  });

  it("rejects cancellation after audio processing starts", async () => {
    const service = createService();
    const run = await createRun(service);
    await service.createAudioUploadUrl(run.runId, {
      originalName: "rehearsal.webm",
      mimeType: "audio/webm",
      size: 1024,
    });
    await service.completeAudioUpload(run.runId, { fileId: "file-audio" });

    await expect(service.cancelRun(run.runId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects rehearsal run meta updates after processing starts", async () => {
    const service = createService();
    const run = await createRun(service);
    await service.createAudioUploadUrl(run.runId, {
      originalName: "rehearsal.webm",
      mimeType: "audio/webm",
      size: 1024,
    });
    await service.completeAudioUpload(run.runId, { fileId: "file-audio" });

    await expect(
      service.updateRunMeta(run.runId, {
        slideTimeline: [
          { slideId: "slide_1", enteredAt: "2026-07-02T00:00:00.000Z" },
        ],
        missedKeywords: [],
        adviceEvents: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects sensitive rehearsal run meta fields", async () => {
    const service = createService();
    const run = await createRun(service);

    await expect(
      service.updateRunMeta(run.runId, {
        slideTimeline: [],
        missedKeywords: [],
        adviceEvents: [],
        transcript: "민감한 전사 원문",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("marks the run and job failed when enqueue fails", async () => {
    const deleteUploadedAsset = vi.fn(async () => rawAudioDeletedAt);
    const jobsService = {
      create: vi.fn(async () => job),
      update: vi.fn(async () => ({ ...job, status: "failed" })),
    } as unknown as JobsService;
    const service = createService({
      enqueueJob: vi.fn(async () => {
        throw new Error("redis down");
      }),
      jobsService,
      filesServicePatch: { deleteUploadedAsset },
    });
    const run = await createRun(service);
    await service.createAudioUploadUrl(run.runId, {
      originalName: "rehearsal.webm",
      mimeType: "audio/webm",
      size: 1024,
    });

    await expect(
      service.completeAudioUpload(run.runId, { fileId: "file-audio" }),
    ).rejects.toThrow("redis down");

    expect(deleteUploadedAsset).toHaveBeenCalledWith(
      "project-a",
      "file-audio",
      "rehearsal-audio",
    );
    expect(jobsService.update).toHaveBeenCalledWith("job-1", {
      status: "failed",
      progress: 0,
      message: "Rehearsal STT enqueue failed.",
      error: {
        code: "REHEARSAL_STT_ENQUEUE_FAILED",
        message: "redis down",
      },
    });
    expect((await service.getRun(run.runId)).run).toMatchObject({
      status: "failed",
      rawAudioDeletedAt,
      error: {
        code: "REHEARSAL_STT_ENQUEUE_FAILED",
        message: "redis down",
      },
    });
  });

  it("marks raw audio cleanup failure when enqueue cleanup fails", async () => {
    const jobsService = {
      create: vi.fn(async () => job),
      update: vi.fn(async () => ({ ...job, status: "failed" })),
    } as unknown as JobsService;
    const service = createService({
      enqueueJob: vi.fn(async () => {
        throw new Error("redis down");
      }),
      jobsService,
      filesServicePatch: {
        deleteUploadedAsset: vi.fn(async () => {
          throw new Error("delete down");
        }),
      },
    });
    const run = await createRun(service);
    await service.createAudioUploadUrl(run.runId, {
      originalName: "rehearsal.webm",
      mimeType: "audio/webm",
      size: 1024,
    });

    await expect(
      service.completeAudioUpload(run.runId, { fileId: "file-audio" }),
    ).rejects.toThrow("redis down");

    expect(jobsService.update).toHaveBeenCalledWith("job-1", {
      status: "failed",
      progress: 0,
      message: "Rehearsal raw audio cleanup failed.",
      error: {
        code: "RAW_AUDIO_DELETE_FAILED",
        message: "delete down",
      },
    });
    expect((await service.getRun(run.runId)).run).toMatchObject({
      status: "failed",
      rawAudioDeletedAt: null,
      error: {
        code: "RAW_AUDIO_DELETE_FAILED",
        message: "delete down",
      },
    });
  });

  it("does not create another job when audio complete is repeated", async () => {
    const jobsService = {
      create: vi.fn(async () => job),
      update: vi.fn(),
    } as unknown as JobsService;
    const service = createService({ jobsService });
    const run = await createRun(service);
    await service.createAudioUploadUrl(run.runId, {
      originalName: "rehearsal.webm",
      mimeType: "audio/webm",
      size: 1024,
    });

    await service.completeAudioUpload(run.runId, { fileId: "file-audio" });
    await expect(
      service.completeAudioUpload(run.runId, { fileId: "file-audio" }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(jobsService.create).toHaveBeenCalledTimes(1);
  });

  it("returns a null report while the rehearsal is still processing", async () => {
    const service = createService();
    const run = await createRun(service);
    await service.createAudioUploadUrl(run.runId, {
      originalName: "rehearsal.webm",
      mimeType: "audio/webm",
      size: 1024,
    });
    await service.completeAudioUpload(run.runId, { fileId: "file-audio" });

    const result = await service.getReport(run.runId);

    expect(result.run.status).toBe("processing");
    expect(result.report).toBeNull();
    expect(
      service.testProjectsService.getAccessibleProject,
    ).toHaveBeenCalledWith("project-a");
  });

  it("returns the saved report JSON for a succeeded rehearsal", async () => {
    const service = createService();
    const run = await createRun(service);
    await saveRunPatch(service, run.runId, {
      status: "succeeded",
      rehearsalReport,
      transcriptRetained: false,
      rawAudioDeletedAt: new Date(rawAudioDeletedAt),
    });

    const result = await service.getReport(run.runId);

    expect(result.run.status).toBe("succeeded");
    expect(result.report).toMatchObject({
      reportId: "report_run-1",
      transcriptRetained: false,
      transcript: null,
      metrics: {
        wordsPerMinute: 120,
        keywordCoverage: 1,
      },
    });
  });

  it("reports audio playback as available when the retained object exists", async () => {
    const isPrivateAudioAvailable = vi.fn(async () => true);
    const service = createService({
      filesServicePatch: { isPrivateAudioAvailable },
    });
    const run = await createRun(service);
    await saveRunPatch(service, run.runId, {
      audioFileId: "file-audio",
      status: "succeeded",
      rehearsalReport,
      rawAudioDeletedAt: null,
      rawAudioDeleteDeadlineAt: new Date("2099-07-30T00:00:00.000Z"),
    });

    const result = await service.getReport(run.runId);

    expect(result.audioPlaybackAvailable).toBe(true);
    expect(isPrivateAudioAvailable).toHaveBeenCalledWith(
      "project-a",
      "file-audio",
      "rehearsal-audio",
    );
  });

  it("compares a succeeded run with the previous succeeded run", async () => {
    const service = createService();
    const previous = await createRun(service);
    await saveRunPatch(service, previous.runId, {
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
      status: "succeeded",
      rehearsalReport: comparisonReport(previous.runId, "missed"),
    });
    const cancelled = await createRun(service);
    await saveRunPatch(service, cancelled.runId, {
      createdAt: new Date("2026-07-10T00:05:00.000Z"),
      status: "cancelled",
    });
    const current = await createRun(service);
    await saveRunPatch(service, current.runId, {
      createdAt: new Date("2026-07-10T00:10:00.000Z"),
      status: "succeeded",
      rehearsalReport: comparisonReport(current.runId, "covered"),
    });

    const comparison = await service.getComparison("project-a", current.runId);

    expect(comparison.currentRunId).toBe(current.runId);
    expect(comparison.previousRunId).toBe(previous.runId);
    expect(comparison.improved).toMatchObject([
      { category: "semantic-cue", cueId: "scue_compare", cueRevision: 2 },
    ]);
    expect(comparison.repeated).toEqual([]);
  });

  it("does not return a comparison for a run outside the requested project", async () => {
    const service = createService();
    const current = await createRun(service);
    await saveRunPatch(service, current.runId, {
      status: "succeeded",
      rehearsalReport: comparisonReport(current.runId, "covered"),
    });

    await expect(
      service.getComparison("project-other", current.runId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("never exposes the private transcript cache through report GET", async () => {
    const service = createService();
    const run = await createRun(service);
    await saveRunPatch(service, run.runId, {
      status: "succeeded",
      rehearsalReport,
      transcriptRetained: false,
      rawAudioDeletedAt: new Date(rawAudioDeletedAt),
    });

    const result = await service.getReport(run.runId);

    expect(result.report).toMatchObject({
      transcriptRetained: false,
      transcript: null,
    });
  });

  it("generates and returns a cached same-folder audio clip", async () => {
    const getOrCreatePrivateAudioDerivative = vi.fn(
      async (
        _projectId: string,
        _fileId: string,
        _purpose: string,
        storageFileName: string,
        createDerivative: (source: {
          body: Uint8Array;
          contentType: string;
        }) => Promise<Uint8Array>,
      ) => ({
        body: await createDerivative({
          body: new Uint8Array([1, 2, 3]),
          contentType: "audio/webm",
        }),
        contentType: "audio/wav",
        storageKey: `rehearsals/2026-07-18/project-a/run-1/${storageFileName}`,
        created: true,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([4, 5, 6]), {
            status: 200,
            headers: { "content-type": "audio/wav" },
          }),
      ),
    );
    const service = createService({
      filesServicePatch: { getOrCreatePrivateAudioDerivative },
    });
    const run = await createRun(service);
    await saveRunPatch(service, run.runId, {
      audioFileId: "file-audio",
      status: "succeeded",
      rawAudioDeletedAt: null,
      rawAudioDeleteDeadlineAt: new Date("2099-07-30T00:00:00.000Z"),
  });

    const result = await service.getAudioClip(run.runId, {
      startSeconds: 10,
      endSeconds: 12.5,
    });

    expect(result).toEqual({
      body: Buffer.from([4, 5, 6]),
      contentType: "audio/wav",
    });
    expect(getOrCreatePrivateAudioDerivative).toHaveBeenCalledWith(
      "project-a",
      "file-audio",
      "rehearsal-audio",
      "volume-10000-12500.wav",
      expect.any(Function),
    );
    expect(fetch).toHaveBeenCalledWith(
      new URL("http://localhost:8000/audio/clip"),
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
  });
  it("creates a bounded playback URL without logging it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T00:00:00.000Z"));
    try {
      const createPrivateAudioReadUrl = vi.fn(
        async () => "https://storage.example.com/audio?signature=short-lived",
      );
      const service = createService({
        filesServicePatch: { createPrivateAudioReadUrl },
      });
      const run = await createRun(service);
      await saveRunPatch(service, run.runId, {
        audioFileId: "file-audio",
        status: "succeeded",
        rawAudioDeletedAt: null,
        rawAudioDeleteDeadlineAt: new Date("2026-07-30T00:00:00.000Z"),
      });

      const result = await service.getAudioPlaybackUrl(run.runId);

      expect(result).toEqual({
        playbackUrl: "https://storage.example.com/audio?signature=short-lived",
        expiresAt: "2026-07-16T00:15:00.000Z",
        retentionExpiresAt: "2026-07-30T00:00:00.000Z",
      });
      expect(createPrivateAudioReadUrl).toHaveBeenCalledWith(
        "project-a",
        "file-audio",
        "rehearsal-audio",
        900,
      );
      const infoCalls = (service.testLogger.info as ReturnType<typeof vi.fn>)
        .mock.calls;
      expect(JSON.stringify(infoCalls)).not.toContain("signature=short-lived");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects expired rehearsal audio before issuing a signed URL", async () => {
    const createPrivateAudioReadUrl = vi.fn();
    const service = createService({
      filesServicePatch: { createPrivateAudioReadUrl },
    });
    const run = await createRun(service);
    await saveRunPatch(service, run.runId, {
      audioFileId: "file-audio",
      status: "succeeded",
      rawAudioDeletedAt: null,
      rawAudioDeleteDeadlineAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    await expect(service.getAudioPlaybackUrl(run.runId)).rejects.toMatchObject({
      status: 410,
      response: { code: "REHEARSAL_AUDIO_EXPIRED" },
    });
    expect(createPrivateAudioReadUrl).not.toHaveBeenCalled();
  });

  it("creates an ID-only semantic evaluation retry job when cached evidence exists", async () => {
    const enqueueSemanticEvaluationJob = vi.fn(async () => undefined);
    const jobsService = {
      create: vi.fn(async () => semanticRetryJob),
      update: vi.fn(),
    } as unknown as JobsService;
    const service = createService({
      jobsService,
      enqueueSemanticEvaluationJob,
      transcriptCache: {
        hasSemanticEvidence: vi.fn(async () => true),
      },
    });
    const run = await createRun(service);
    await saveRunPatch(service, run.runId, {
      status: "succeeded",
      rehearsalReport: {
        ...rehearsalReport,
        semanticEvaluation: {
          state: "partial",
          measurementMode: "none",
          reasons: ["timeout"],
          retryable: true,
        },
        semanticCueOutcomes: [],
        },
    });

    const result = await service.retrySemanticEvaluation(run.runId);

    expect(result.job).toEqual(semanticRetryJob);
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: "project-a",
      type: "rehearsal-semantic-evaluation",
      payload: { runId: run.runId },
    });
    expect(enqueueSemanticEvaluationJob).toHaveBeenCalledWith({
      driver: "bullmq",
      redisUrl: "redis://localhost:6379",
      jobId: "job-semantic-retry",
      projectId: "project-a",
      runId: run.runId,
    });
    expect(
      JSON.stringify(enqueueSemanticEvaluationJob.mock.calls),
    ).not.toContain("transcript");
  });

  it("returns non-retryable evidence expired conflict without creating a job", async () => {
    const jobsService = {
      create: vi.fn(async () => semanticRetryJob),
      update: vi.fn(),
    } as unknown as JobsService;
    const service = createService({ jobsService });
    const run = await createRun(service);
    await saveRunPatch(service, run.runId, {
      status: "succeeded",
      rehearsalReport: retryableReport(),
    });

    await expect(
      service.retrySemanticEvaluation(run.runId),
    ).rejects.toMatchObject({
      response: {
        code: "REHEARSAL_SEMANTIC_EVIDENCE_EXPIRED",
        retryable: false,
      },
    });
    expect(jobsService.create).not.toHaveBeenCalled();
  });

  it("does not retry a delivery-only run without an evaluation snapshot", async () => {
    const jobsService = {
      create: vi.fn(async () => semanticRetryJob),
      update: vi.fn(),
    } as unknown as JobsService;
    const service = createService({
      jobsService,
      transcriptCache: {
        hasSemanticEvidence: vi.fn(async () => true),
      },
    });
    const run = (
      await service.createRun("project-a", {
        deckId: "deck-a",
        semanticEvaluationMode: "delivery-only",
      })
    ).run;
    await saveRunPatch(service, run.runId, {
      status: "succeeded",
      rehearsalReport,
    });

    await expect(
      service.retrySemanticEvaluation(run.runId),
    ).rejects.toMatchObject({
      response: {
        code: "REHEARSAL_SEMANTIC_EVALUATION_NOT_READY",
        retryable: false,
      },
    });
    expect(jobsService.create).not.toHaveBeenCalled();
  });

  it("marks the retry job failed and logs a safe event when enqueue fails", async () => {
    const jobsService = {
      create: vi.fn(async () => semanticRetryJob),
      update: vi.fn(async () => ({ ...semanticRetryJob, status: "failed" })),
    } as unknown as JobsService;
    const service = createService({
      jobsService,
      enqueueSemanticEvaluationJob: vi.fn(async () => {
        throw new Error("redis down");
      }),
      transcriptCache: {
        hasSemanticEvidence: vi.fn(async () => true),
      },
    });
    const run = await createRun(service);
    await saveRunPatch(service, run.runId, {
      status: "succeeded",
      rehearsalReport: retryableReport(),
    });

    await expect(service.retrySemanticEvaluation(run.runId)).rejects.toThrow(
      "redis down",
    );

    expect(jobsService.update).toHaveBeenCalledWith("job-semantic-retry", {
      status: "failed",
      progress: 0,
      message: "Rehearsal semantic evaluation retry enqueue failed.",
      error: {
        code: "REHEARSAL_SEMANTIC_EVALUATION_ENQUEUE_FAILED",
        message: "redis down",
      },
    });
    expect(service.testLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "rehearsal.semantic_evaluation.retry_failed",
        projectId: "project-a",
        runId: run.runId,
        jobId: "job-semantic-retry",
        reason: "REHEARSAL_SEMANTIC_EVALUATION_ENQUEUE_FAILED",
      }),
      "Rehearsal semantic evaluation retry enqueue failed.",
    );
    expect(
      JSON.stringify(vi.mocked(service.testLogger.error).mock.calls),
    ).not.toContain("민감한");
  });
});

async function createRun(service: ReturnType<typeof createService>) {
  return (await service.createRun("project-a", { deckId: "deck-a" })).run;
}

function retryableReport() {
  return {
    ...rehearsalReport,
    semanticEvaluation: {
      state: "partial",
      measurementMode: "none",
      reasons: ["timeout"],
      retryable: true,
    },
    semanticCueOutcomes: [],
  };
}

function comparisonReport(
  runId: string,
  status: "covered" | "partial" | "missed",
) {
  return {
    ...rehearsalReport,
    runId,
    semanticEvaluation: {
      state: "succeeded",
      measurementMode: "full",
      reasons: [],
      retryable: false,
    },
    semanticCueOutcomes: [
      {
        slideId: "slide_1",
        cueId: "scue_compare",
        cueRevision: 2,
        cueMeaningSnapshot: "고객이 얻는 가치를 설명한다.",
        reportLabelSnapshot: "고객 가치",
        importance: "core",
        status,
        measurementMode: "full",
        fallbackUsed: false,
        coveredConcepts: status === "covered" ? ["고객 가치"] : [],
        missingConcepts: status === "covered" ? [] : ["고객 가치"],
      },
    ],
  };
}

async function saveRunPatch(
  service: ReturnType<typeof createService>,
  runId: string,
  patch: Partial<RehearsalRunEntity>,
) {
  const run = await service.testRehearsalRuns.findOne({ where: { runId } });
  if (!run) {
    throw new Error(`Missing test run: ${runId}`);
  }

  await service.testRehearsalRuns.save({ ...run, ...patch });
}

function createService(
  options: {
    enqueueJob?: RehearsalSttEnqueueJob;
    enqueueSemanticEvaluationJob?: RehearsalSemanticEvaluationEnqueueJob;
    jobsService?: JobsService;
    filesServicePatch?: Partial<FilesService>;
    transcriptCache?: RehearsalTranscriptCache;
    deck?: Deck;
    presentationBrief?: PresentationBrief | null;
    focusProfile?: RehearsalFocusProfile | null;
  } = {},
) {
  const logger = createLogger();
  const repository = createRunRepository(options.focusProfile ?? null);
  const transcriptCache = options.transcriptCache ?? {
    hasSemanticEvidence: vi.fn(async () => false),
  };
  const filesService = {
    createUploadUrl: vi.fn(async () => upload),
    createRehearsalAudioUploadUrl: vi.fn(async () => upload),
    completeUpload: vi.fn(async () => ({
      fileId: "file-audio",
      projectId: "project-a",
      originalName: "rehearsal.webm",
      mimeType: "audio/webm",
      size: 1024,
      url: "http://localhost:9000/rehearsal.webm",
      purpose: "rehearsal-audio",
      createdAt: createdAt.toISOString(),
    })),
    getUploadedAsset: vi.fn(async () => ({
      fileId: "file-audio",
      projectId: "project-a",
      purpose: "rehearsal-audio",
      status: "uploaded",
    })),
    deleteUploadedAsset: vi.fn(async () => rawAudioDeletedAt),
    createPrivateAudioReadUrl: vi.fn(
      async () => "https://storage.example.com/audio?signature=short-lived",
    ),
    isPrivateAudioAvailable: vi.fn(async () => true),
    ...options.filesServicePatch,
  } as unknown as FilesService;
  const projectsService = {
    getAccessibleProject: vi.fn(async (projectId: string) => ({
      projectId,
      workspaceId: "workspace-a",
      title: "Project A",
      createdBy: "user-a",
      createdAt: createdAt.toISOString(),
    })),
  } as unknown as ProjectsService;
  const deck = options.deck ?? createDeck();
  const service = new RehearsalsService(
    repository,
    {
      findOne: vi.fn(async () => null),
    } as unknown as Repository<ProjectEntity>,
    {
      getDeck: vi.fn(async () => ({
        projectId: "project-a",
        deck,
        updatedAt: createdAt.toISOString(),
      })),
    } as unknown as DecksService,
    projectsService,
    {
      getCurrent: vi.fn(async () => options.presentationBrief ?? null),
    } as unknown as PresentationBriefsService,
    filesService,
    options.jobsService ??
      ({
        create: vi.fn(async () => job),
        update: vi.fn(),
      } as unknown as JobsService),
    options.enqueueJob ?? vi.fn(async () => undefined),
    options.enqueueSemanticEvaluationJob ?? vi.fn(async () => undefined),
    transcriptCache as unknown as RedisRehearsalTranscriptCache,
    logger,
  );
  return Object.assign(service, {
    testRehearsalRuns: repository,
    testProjectsService: projectsService as ProjectsService & {
      getAccessibleProject: ReturnType<typeof vi.fn>;
    },
    testFilesService: filesService as FilesService & {
      createUploadUrl: ReturnType<typeof vi.fn>;
      createRehearsalAudioUploadUrl: ReturnType<typeof vi.fn>;
    },
    testLogger: logger,
    testTranscriptCache: transcriptCache,
  });
}

function createRunRepository(
  focusProfile: RehearsalFocusProfile | null = null,
) {
  const runs = new Map<string, RehearsalRunEntity>();

  return {
    create(input: Partial<RehearsalRunEntity>) {
      return input as RehearsalRunEntity;
    },
    async save(run: RehearsalRunEntity) {
      runs.set(run.runId, { ...run });
      return runs.get(run.runId) as RehearsalRunEntity;
    },
    async findOne(options: {
      where: {
        runId?: string;
        projectId?: string;
        status?: string;
        createdAt?: { _type?: string; _value?: Date };
      };
      order?: { createdAt?: "ASC" | "DESC" };
    }) {
      if (options.where.runId) {
        return runs.get(options.where.runId) ?? null;
      }

      const matching = [...runs.values()]
        .filter(
          (run) =>
            !options.where.projectId ||
            run.projectId === options.where.projectId,
        )
        .filter(
          (run) => !options.where.status || run.status === options.where.status,
        )
        .filter((run) => {
          const createdAt = options.where.createdAt;
          return createdAt?._type === "lessThan" && createdAt._value
            ? run.createdAt < createdAt._value
            : true;
        })
        .sort((left, right) =>
          options.order?.createdAt === "ASC"
            ? left.createdAt.getTime() - right.createdAt.getTime()
            : right.createdAt.getTime() - left.createdAt.getTime(),
        );

      return matching[0] ?? null;
    },
    async update(
      criteria: Partial<RehearsalRunEntity>,
      patch: Partial<RehearsalRunEntity>,
    ) {
      const run = [...runs.values()].find((candidate) =>
        Object.entries(criteria).every(
          ([key, value]) =>
            candidate[key as keyof RehearsalRunEntity] === value,
        ),
      );

      if (!run) {
        return { affected: 0 };
      }

      Object.assign(run, patch);
      runs.set(run.runId, { ...run });
      return { affected: 1 };
    },
    async findAndCount(options: {
      where: { projectId: string; status?: unknown };
      take: number;
      skip: number;
    }) {
      const status = options.where.status as
        | string
        | { _type?: string; _value?: string }
        | undefined;
      const matching = [...runs.values()]
        .filter((run) => run.projectId === options.where.projectId)
        .filter((run) => {
          if (typeof status === "string") {
            return run.status === status;
          }
          if (status?._type === "not") {
            return run.status !== status._value;
          }
          return true;
        })
        .sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
        );

      return [
        matching.slice(options.skip, options.skip + options.take),
        matching.length,
      ];
    },
    async query(sql: string) {
      if (!sql.includes("FROM rehearsal_focus_profiles") || !focusProfile) {
        return [];
      }
      return [
        {
        profile_id: focusProfile.profileId,
        project_id: focusProfile.projectId,
        revision: focusProfile.revision,
        items_json: structuredClone(focusProfile.items),
        created_by: focusProfile.createdBy,
        updated_by: focusProfile.updatedBy,
        created_at: focusProfile.createdAt,
          updated_at: focusProfile.updatedAt,
        },
      ];
    },
  } as unknown as Repository<RehearsalRunEntity>;
}

function createDeck(): Deck {
  const deck = deckSchema.parse({
    deckId: "deck_a",
    projectId: "project-a",
    title: "Rehearsal deck",
    version: 3,
    targetDurationMinutes: 10,
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "Opening",
        speakerNotes: "민감한 발표자 노트",
        keywords: [
          {
            keywordId: "kw_1",
            text: "ORBIT",
            synonyms: ["발표 도우미"],
            abbreviations: [],
            required: true,
          },
        ],
        elements: [],
        semanticCues: [
          semanticCue("scue_approved", "approved", 2, "승인된 원래 의미"),
          semanticCue("scue_excluded", "excluded", 1, "제외된 의미"),
          semanticCue("scue_suggested", "suggested", 1, "검토 전 의미"),
        ],
      },
    ],
  });
  deck.deckId = "deck-a";
  return deck;
}

function semanticCue(
  cueId: string,
  reviewStatus: "suggested" | "approved" | "excluded",
  revision: number,
  meaning: string,
) {
  return {
    cueId,
    slideId: "slide_1",
    meaning,
    importance: "core",
    reviewStatus,
    freshness: "current",
    origin: "ai",
    revision,
    required: true,
    priority: 1,
    candidateKeywords: ["ORBIT"],
    aliases: {},
    requiredConcepts: ["발표 도우미"],
    nliHypotheses: ["발표자는 ORBIT이 발표를 돕는다고 설명했다"],
    negativeHints: [],
    targetElementIds: [],
    triggerActionIds: [],
  };
}

function createLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as PinoLogger;
}
