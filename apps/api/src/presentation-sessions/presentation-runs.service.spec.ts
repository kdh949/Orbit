import type { Job } from "@orbit/shared";
import { createDemoDeck } from "@orbit/editor-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";

import type { DecksService } from "../decks/decks.service";
import type { FilesService } from "../files/files.service";
import type { JobsService } from "../jobs/jobs.service";
import type { ActivityResultsService } from "../activities/activity-results.service";
import { PresentationRunEntity } from "./presentation-run.entity";
import type { PresentationSessionsService } from "./presentation-sessions.service";
import {
  PresentationRunsService,
  type PresentationAnalysisEnqueueJob,
} from "./presentation-runs.service";

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({
    JOB_QUEUE_DRIVER: "bullmq",
    REDIS_URL: "redis://localhost:6379",
    REHEARSAL_AUDIO_MAX_BYTES: 25 * 1024 * 1024,
  }),
}));

const now = new Date("2026-07-20T00:00:00.000Z");

function createDeckSnapshot() {
  return {
    ...createDemoDeck(),
    deckId: "deck_1",
    projectId: "project_1",
    version: 4,
  };
}

function makeRun(
  patch: Partial<PresentationRunEntity> = {},
): PresentationRunEntity {
  return Object.assign(new PresentationRunEntity(), {
    runId: "presentation_run_1",
    projectId: "project_1",
    sessionId: "session_1",
    deckId: "deck_1",
    deckVersion: 4,
    deckSnapshot: createDeckSnapshot(),
    recordingMode: "microphone",
    audioFileId: null,
    jobId: null,
    status: "created",
    error: null,
    voiceReport: null,
    detailedReport: null,
    rawAudioDeletedAt: null,
    rawAudioDeleteDeadlineAt: null,
    startedAt: now,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  });
}

function createService(existingRun: PresentationRunEntity | null = null) {
  let storedRun = existingRun;
  const findAndCount = vi.fn(async () =>
    storedRun ? [[storedRun], 1] as const : [[], 0] as const,
  );
  const repository = {
    findOne: vi.fn(async () => storedRun),
    findAndCount,
    create: vi.fn((value) => makeRun(value)),
    save: vi.fn(async (value) => {
      storedRun = value;
      return value;
    }),
    update: vi.fn(async (_criteria, patch) => {
      if (storedRun) Object.assign(storedRun, patch);
      return { affected: storedRun ? 1 : 0 };
    }),
  } as unknown as Repository<PresentationRunEntity>;
  const sessions = {
    getSessionForPresenter: vi.fn().mockResolvedValue({
      sessionId: "session_1",
      projectId: "project_1",
      deckId: "deck_1",
      deckVersion: 4,
      sessionPurpose: "presentation",
    }),
  } as unknown as PresentationSessionsService;
  const decks = {
    getDeck: vi.fn().mockResolvedValue({
      deck: createDeckSnapshot(),
    }),
  } as unknown as DecksService;
  const files = {
    createPresentationAudioUploadUrl: vi.fn(),
    completeUpload: vi.fn(),
    getUploadedAsset: vi.fn(),
  } as unknown as FilesService;
  const queuedJob: Job = {
    jobId: "job_1",
    projectId: "project_1",
    type: "presentation-analysis",
    status: "queued",
    progress: 0,
    message: "Job queued",
    result: null,
    error: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const jobs = {
    create: vi.fn().mockResolvedValue(queuedJob),
    get: vi.fn().mockResolvedValue(queuedJob),
    update: vi.fn(),
  } as unknown as JobsService;
  const enqueue = vi
    .fn()
    .mockResolvedValue(undefined) as unknown as PresentationAnalysisEnqueueJob;
  const activityResults = {
    getSessionArchive: vi.fn().mockResolvedValue({ activities: [] }),
  } as unknown as ActivityResultsService;
  const logger = { info: vi.fn(), error: vi.fn() } as never;

  return {
    decks,
    activityResults,
    enqueue,
    files,
    findAndCount,
    jobs,
    repository,
    sessions,
    service: new PresentationRunsService(
      repository,
      sessions,
      decks,
      files,
      jobs,
      activityResults,
      enqueue,
      logger,
    ),
  };
}

describe("PresentationRunsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates one run per presentation session and reuses it", async () => {
    const fixture = createService();

    const first = await fixture.service.createRun("project_1", "session_1", {
      expectedDeckVersion: 4,
      recordingMode: "microphone",
    });
    const second = await fixture.service.createRun("project_1", "session_1", {
      expectedDeckVersion: 4,
      recordingMode: "microphone",
    });

    expect(first.run.runId).toMatch(/^presentation_run_/);
    expect(second.run.runId).toBe(first.run.runId);
    expect(fixture.repository.save).toHaveBeenCalledTimes(1);
    expect(fixture.decks.getDeck).toHaveBeenCalledTimes(1);
  });

  it("rejects a presentation run for a rehearsal-purpose session", async () => {
    const fixture = createService();
    vi.mocked(fixture.sessions.getSessionForPresenter).mockResolvedValue({
      sessionId: "session_1",
      projectId: "project_1",
      deckId: "deck_1",
      deckVersion: 4,
      sessionPurpose: "rehearsal",
    } as never);

    await expect(
      fixture.service.createRun("project_1", "session_1", {
        expectedDeckVersion: 4,
        recordingMode: "none",
      }),
    ).rejects.toMatchObject({
      message:
        "Presentation runs cannot be created for rehearsal sessions.",
    });
    expect(fixture.repository.save).not.toHaveBeenCalled();
  });

  it("allows a not-yet-started run to fall back to no-microphone mode", async () => {
    const fixture = createService(makeRun({ recordingMode: "microphone" }));

    const result = await fixture.service.createRun("project_1", "session_1", {
      expectedDeckVersion: 4,
      recordingMode: "none",
    });

    expect(result.run).toMatchObject({
      runId: "presentation_run_1",
      recordingMode: "none",
      status: "created",
    });
    expect(fixture.repository.save).toHaveBeenCalledOnce();
    expect(fixture.decks.getDeck).not.toHaveBeenCalled();
  });

  it("does not change recording mode after audio upload has started", async () => {
    const fixture = createService(
      makeRun({
        recordingMode: "microphone",
        status: "uploading",
        audioFileId: "file_1",
      }),
    );

    const result = await fixture.service.createRun("project_1", "session_1", {
      expectedDeckVersion: 4,
      recordingMode: "none",
    });

    expect(result.run.recordingMode).toBe("microphone");
    expect(fixture.repository.save).not.toHaveBeenCalled();
  });

  it("finds the single presentation run by session for report routing", async () => {
    const fixture = createService(makeRun({ status: "succeeded" }));

    const result = await fixture.service.getSessionRun(
      "project_1",
      "session_1",
    );

    expect(result.run).toMatchObject({
      runId: "presentation_run_1",
      sessionId: "session_1",
      status: "succeeded",
    });
    expect(fixture.repository.findOne).toHaveBeenCalledWith({
      where: { projectId: "project_1", sessionId: "session_1" },
    });
  });

  it("lists completed presentation runs for the report hub", async () => {
    const fixture = createService(
      makeRun({ status: "succeeded", endedAt: now }),
    );

    const result = await fixture.service.listProjectRuns("project_1", {
      page: "1",
      pageSize: "20",
    });

    expect(result).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      runs: [{ runId: "presentation_run_1", status: "succeeded" }],
    });
    expect(fixture.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { createdAt: "DESC" },
        skip: 0,
        take: 20,
      }),
    );
  });

  it("finishes a no-microphone run without creating an analysis job", async () => {
    const fixture = createService(
      makeRun({ recordingMode: "none", status: "created" }),
    );

    const result = await fixture.service.completeAudio(
      "project_1",
      "session_1",
      "presentation_run_1",
      { withoutAudio: true },
    );

    expect(result).toMatchObject({
      run: { status: "succeeded", recordingMode: "none" },
      job: null,
    });
    expect(fixture.jobs.create).not.toHaveBeenCalled();
    expect(fixture.enqueue).not.toHaveBeenCalled();
  });

  it("enqueues the presentation-only analysis job after audio upload", async () => {
    const fixture = createService(
      makeRun({
        status: "uploading",
        audioFileId: "file_1",
      }),
    );

    const result = await fixture.service.completeAudio(
      "project_1",
      "session_1",
      "presentation_run_1",
      { fileId: "file_1" },
    );

    expect(result.job).toMatchObject({
      jobId: "job_1",
      type: "presentation-analysis",
    });
    expect(fixture.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        sessionId: "session_1",
        runId: "presentation_run_1",
        audioFileId: "file_1",
      }),
    );
  });

  it("returns the existing analysis job for a duplicate audio completion", async () => {
    const fixture = createService(
      makeRun({
        status: "processing",
        audioFileId: "file_1",
        jobId: "job_1",
      }),
    );

    const result = await fixture.service.completeAudio(
      "project_1",
      "session_1",
      "presentation_run_1",
      { fileId: "file_1" },
    );

    expect(result).toMatchObject({
      run: { status: "processing", audioFileId: "file_1" },
      job: { jobId: "job_1" },
    });
    expect(fixture.files.completeUpload).not.toHaveBeenCalled();
    expect(fixture.jobs.create).not.toHaveBeenCalled();
    expect(fixture.enqueue).not.toHaveBeenCalled();
  });

  it("retries a failed analysis without touching rehearsal data", async () => {
    const fixture = createService(
      makeRun({
        status: "failed",
        audioFileId: "file_1",
        error: { code: "PRESENTATION_AUDIO_ANALYSIS_FAILED", message: "fail" },
      }),
    );

    const result = await fixture.service.retryAnalysis(
      "project_1",
      "session_1",
      "presentation_run_1",
    );

    expect(result).toMatchObject({
      run: { status: "processing", jobId: "job_1" },
      job: { type: "presentation-analysis" },
    });
    expect(fixture.files.getUploadedAsset).toHaveBeenCalledWith(
      "project_1",
      "file_1",
      "presentation-audio",
    );
    expect(fixture.enqueue).toHaveBeenCalledTimes(1);
  });

  it("combines audience activity results with the presentation voice report", async () => {
    const activity = {
      availability: "raw-retained",
      result: null,
      run: {
        activityRunId: "activity_run_1",
        presentationSessionId: "session_1",
        activityId: "activity_1",
        sourceSlideId: "slide_1",
        version: 1,
        supersedesActivityRunId: null,
        definitionSnapshot: {
          activityId: "activity_1",
          template: "poll",
          title: "실시간 투표",
          description: "한 가지를 선택해 주세요.",
          questions: [
            {
              questionId: "question_1",
              type: "single-choice",
              prompt: "어떤 선택이 가장 적합한가요?",
              required: true,
              options: [
                { optionId: "option_1", label: "선택 1" },
                { optionId: "option_2", label: "선택 2" },
              ],
            },
          ],
          allowDisplayName: false,
        },
        definitionFingerprint: "fingerprint_1",
        status: "closed",
        revision: 1,
        isCurrent: true,
        responseCount: 0,
        openedAt: now.toISOString(),
        closedAt: now.toISOString(),
        revealedAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    };
    const fixture = createService(makeRun({ status: "succeeded" }));
    vi.mocked(fixture.activityResults.getSessionArchive).mockResolvedValue({
      activities: [activity],
    } as never);

    const result = await fixture.service.getReport(
      "project_1",
      "session_1",
      "presentation_run_1",
    );

    expect(result.report.audienceSummary?.activities).toMatchObject([activity]);
    expect(fixture.activityResults.getSessionArchive).toHaveBeenCalledWith(
      "project_1",
      "session_1",
    );
  });
});
