import type { FocusedPracticeAttempt } from "@orbit/shared/coaching";
import { ConflictException } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";
import type { FilesService } from "../files/files.service";
import type { JobsService } from "../jobs/jobs.service";
import type { ProjectsService } from "../projects/projects.service";
import {
  deriveStabilization,
  focusedPracticeAudioFileName,
  FocusedPracticeService,
} from "./focused-practice.service";
import { focusedPracticeSentenceSnapshotHash } from "./focused-practice-target";

const jobQueueMocks = vi.hoisted(() => ({
  enqueueFocusedPracticeAnalysisJob: vi.fn(async () => undefined),
}));

vi.mock("@orbit/job-queue", () => jobQueueMocks);

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({
    JOB_QUEUE_DRIVER: "bullmq",
    REDIS_URL: "redis://localhost:6379",
    REHEARSAL_AUDIO_MAX_BYTES: 50_000_000,
    ADAPTIVE_REHEARSAL_COACH_ENABLED: true,
    FOCUSED_PRACTICE_ENABLED: true,
    ADAPTIVE_COACHING_PROJECT_ALLOWLIST: ["*"],
  }),
  isAdaptiveCoachingProjectAllowed: () => true,
}));

describe("FocusedPracticeService", () => {
  it("summarizes the current user's attempts and passed outcomes for report goals", async () => {
    const query = vi.fn(async () => [
      { goal_id: "goal-a", passed_count: 2 },
      { goal_id: "goal-b", passed_count: 0 },
    ]);
    const dataSource = { query } as unknown as DataSource;

    await expect(
      createService(dataSource).getAttemptSummary(
        "project-a",
        "run-a",
        "user-a",
      ),
    ).resolves.toEqual({
      sourceFullRunId: "run-a",
      goals: [
        { goalId: "goal-a", passedCount: 2 },
        { goalId: "goal-b", passedCount: 0 },
      ],
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("sessions.created_by = $3"),
      ["project-a", "run-a", "user-a"],
    );
  });

  it("creates an idempotent session only from final goals sharing one target scope", async () => {
    let queryIndex = 0;
    const query = vi.fn(
      async (_sql: string, _parameters?: unknown[]): Promise<unknown[]> => {
        queryIndex += 1;
        if (queryIndex === 1) return [];
        if (queryIndex === 2) return [];
        if (queryIndex === 3)
          return [
            {
              deck_id: "deck_a",
              analysis_state: "final",
              goal_set_id: "goalset-a",
              goal_set_revision: 3,
              evaluation_snapshot_json: evaluationSnapshot(),
              goals: [
                {
                  goal_id: "goal-a",
                  target_scope_json: {
                    type: "slide",
                    scopeId: "scope-a",
                    slideId: "slide_a",
                  },
                  measurement_state: "measured",
                  criterion_ref_json: {
                    criterionId: "criterion-a",
                    revision: 1,
                  },
                },
              ],
            },
          ];
        if (queryIndex === 4) return [{ deck_json: currentDeck() }];
        if (queryIndex === 5) return [];
        if (queryIndex === 6)
          return [{ practice_session_id: "practice-created" }];
        return [];
      },
    );
    const dataSource = {
      transaction: vi.fn(
        async (callback: (manager: { query: typeof query }) => unknown) =>
          callback({ query }),
      ),
    } as unknown as DataSource;
    const service = createService(dataSource);

    const result = await service.createSession("project-a", "user-a", {
      clientRequestId: "request-123",
      sourceFullRunId: "run-a",
      sourceGoalSetId: "goalset-a",
      goalIds: ["goal-a"],
      targetScope: { type: "slide", scopeId: "scope-a", slideId: "slide_a" },
    });

    expect(result.session.status).toBe("active");
    expect(result.session.snapshot.goalSetRef).toEqual({
      goalSetId: "goalset-a",
      revision: 3,
    });
    expect(query.mock.calls[5]?.[0]).toContain(
      "INSERT INTO focused_practice_sessions",
    );
  });

  it("resumes the matching active session when browser storage loses its request ID", async () => {
    let queryIndex = 0;
    const query = vi.fn(
      async (_sql: string, _parameters?: unknown[]): Promise<unknown[]> => {
        queryIndex += 1;
        if (queryIndex === 1) return [];
        if (queryIndex === 2) return [];
        if (queryIndex === 3)
          return [
            {
              deck_id: "deck_a",
              analysis_state: "final",
              goal_set_id: "goalset-a",
              goal_set_revision: 3,
              evaluation_snapshot_json: evaluationSnapshot(),
              goals: [
                {
                  goal_id: "goal-a",
                  target_scope_json: {
                    type: "slide",
                    scopeId: "scope-a",
                    slideId: "slide_a",
                  },
                  measurement_state: "measured",
                  criterion_ref_json: {
                    criterionId: "criterion-a",
                    revision: 1,
                  },
                },
              ],
            },
          ];
        if (queryIndex === 4) return [{ deck_json: currentDeck() }];
        if (queryIndex === 5) return [focusedSessionRow()];
        return [];
      },
    );
    const dataSource = {
      transaction: vi.fn(
        async (callback: (manager: { query: typeof query }) => unknown) =>
          callback({ query }),
      ),
    } as unknown as DataSource;

    await expect(
      createService(dataSource).createSession("project-a", "user-a", {
        clientRequestId: "request-from-a-new-tab",
        sourceFullRunId: "run-a",
        sourceGoalSetId: "goalset-a",
        goalIds: ["goal-a"],
        targetScope: { type: "slide", scopeId: "scope-a", slideId: "slide_a" },
      }),
    ).resolves.toMatchObject({
      session: { practiceSessionId: "practice-existing" },
    });

    expect(query.mock.calls[1]?.[0]).toContain("pg_advisory_xact_lock");
    expect(query.mock.calls[4]?.[0]).toContain("status = 'active'");
    expect(query.mock.calls[4]?.[1]).toEqual([
      "project-a",
      "user-a",
      "run-a",
      "goalset-a",
      '["goal-a"]',
      '{"type":"slide","scopeId":"scope-a","slideId":"slide_a"}',
    ]);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO focused_practice_sessions"),
      ),
    ).toBe(false);
  });

  it("returns the existing session when concurrent idempotent creation collides", async () => {
    let queryIndex = 0;
    const query = vi.fn(
      async (_sql: string, _parameters?: unknown[]): Promise<unknown[]> => {
        queryIndex += 1;
        if (queryIndex === 1) return [];
        if (queryIndex === 2) return [];
        if (queryIndex === 3)
          return [
            {
              deck_id: "deck_a",
              analysis_state: "final",
              goal_set_id: "goalset-a",
              goal_set_revision: 3,
              evaluation_snapshot_json: evaluationSnapshot(),
              goals: [
                {
                  goal_id: "goal-a",
                  target_scope_json: {
                    type: "slide",
                    scopeId: "scope-a",
                    slideId: "slide_a",
                  },
                  measurement_state: "measured",
                  criterion_ref_json: {
                    criterionId: "criterion-a",
                    revision: 1,
                  },
                },
              ],
            },
          ];
        if (queryIndex === 4) return [{ deck_json: currentDeck() }];
        if (queryIndex === 5) return [];
        if (queryIndex === 6) return [];
        return [focusedSessionRow()];
      },
    );
    const dataSource = {
      transaction: vi.fn(
        async (callback: (manager: { query: typeof query }) => unknown) =>
          callback({ query }),
      ),
    } as unknown as DataSource;
    const service = createService(dataSource);

    await expect(
      service.createSession("project-a", "user-a", {
        clientRequestId: "request-concurrent-a",
        sourceFullRunId: "run-a",
        sourceGoalSetId: "goalset-a",
        goalIds: ["goal-a"],
        targetScope: { type: "slide", scopeId: "scope-a", slideId: "slide_a" },
      }),
    ).resolves.toMatchObject({
      session: { practiceSessionId: "practice-existing" },
    });
  });

  it("marks an existing sentence session stale when the current sentence changes", async () => {
    const row = focusedSessionRow() as Record<string, any>;
    row.target_scope_json = {
      type: "sentence",
      scopeId: "scope-sentence",
      slideId: "slide_a",
      sentenceIndex: 0,
      textSnapshotHash: focusedPracticeSentenceSnapshotHash("연습 문장"),
    };
    let queryIndex = 0;
    const query = vi.fn(
      async (_sql: string, _parameters?: unknown[]): Promise<unknown[]> => {
        queryIndex += 1;
        if (queryIndex === 1) return [row];
        if (queryIndex === 2)
          return [
            {
              evaluation_snapshot_json: evaluationSnapshot(),
              deck_json: currentDeck("수정된 문장"),
            },
          ];
        return [];
      },
    );
    const dataSource = { query } as unknown as DataSource;

    await expect(
      createService(dataSource).getSession("practice-existing", "user-a"),
    ).resolves.toMatchObject({ session: { compatibilityState: "stale" } });
    expect(query.mock.calls[2]?.[0]).toContain("compatibility_state = 'stale'");
  });

  it("rejects a new attempt before creating an upload when the target became stale", async () => {
    let queryIndex = 0;
    const query = vi.fn(
      async (_sql: string, _parameters?: unknown[]): Promise<unknown[]> => {
        queryIndex += 1;
        if (queryIndex === 1) return [focusedSessionRow()];
        if (queryIndex === 2)
          return [
            {
              evaluation_snapshot_json: evaluationSnapshot(),
              deck_json: currentDeckWithSlide("slide_replacement"),
            },
          ];
        return [];
      },
    );
    const files = { createUploadUrl: vi.fn() } as unknown as FilesService;

    await expect(
      createService({ query } as unknown as DataSource, files).createAttempt(
        "practice-existing",
        "user-a",
        {
          clientRequestId: "request-stale",
          mimeType: "audio/webm",
          size: 1024,
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(files.createUploadUrl).not.toHaveBeenCalled();
    expect(query.mock.calls[2]?.[0]).toContain("compatibility_state = 'stale'");
  });

  it("rejects upload completion without enqueueing analysis when the target became stale", async () => {
    let queryIndex = 0;
    const query = vi.fn(
      async (_sql: string, _parameters?: unknown[]): Promise<unknown[]> => {
        queryIndex += 1;
        if (queryIndex === 1)
          return [
            {
              attempt_id: "attempt-a",
              project_id: "project-a",
              practice_session_id: "practice-existing",
              status: "uploading",
              audio_file_id: "file-a",
            },
          ];
        if (queryIndex === 2) return [focusedSessionRow()];
        if (queryIndex === 3)
          return [
            {
              evaluation_snapshot_json: evaluationSnapshot(),
              deck_json: currentDeckWithSlide("slide_replacement"),
            },
          ];
        return [];
      },
    );
    const files = { completeUpload: vi.fn() } as unknown as FilesService;
    const jobs = { create: vi.fn() } as unknown as JobsService;

    await expect(
      createService(
        { query } as unknown as DataSource,
        files,
        jobs,
      ).completeAttempt("attempt-a", "user-a", {
        fileId: "file-a",
        durationMs: 1000,
        slideTimeline: [
          { slideId: "slide_a", enteredAtMs: 0, exitedAtMs: 1000 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(files.completeUpload).not.toHaveBeenCalled();
    expect(jobs.create).not.toHaveBeenCalled();
    expect(query.mock.calls[3]?.[0]).toContain("compatibility_state = 'stale'");
  });

  it("marks the attempt and job failed when analysis enqueue fails", async () => {
    jobQueueMocks.enqueueFocusedPracticeAnalysisJob.mockRejectedValueOnce(new Error("redis down"));
    const query = vi.fn(async (sql: string): Promise<unknown[]> => {
      if (sql.includes("SELECT * FROM focused_practice_attempts")) return [{
        attempt_id: "attempt-a", project_id: "project-a", practice_session_id: "practice-existing",
        status: "uploading", audio_file_id: "file-a",
      }];
      if (sql.includes("SELECT * FROM focused_practice_sessions")) return [focusedSessionRow()];
      if (sql.includes("SELECT runs.evaluation_snapshot_json")) return [{
        evaluation_snapshot_json: evaluationSnapshot(), deck_json: currentDeck(),
      }];
      return [];
    });
    const deleteUploadedAsset = vi.fn(async () => "2026-07-12T00:01:00.000Z");
    const files = {
      completeUpload: vi.fn(async () => ({})),
      deleteUploadedAsset,
    } as unknown as FilesService;
    const job = { jobId: "job-focused", projectId: "project-a", type: "focused-practice-analysis", status: "queued", progress: 0, message: "Queued", result: null, error: null, createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z" } as const;
    const jobs = { create: vi.fn(async () => job), update: vi.fn(async () => ({ ...job, status: "failed" })) };

    await expect(createService({ query } as unknown as DataSource, files, jobs as unknown as JobsService).completeAttempt(
      "attempt-a",
      "user-a",
      { fileId: "file-a", durationMs: 1000, slideTimeline: [{ slideId: "slide_a", enteredAtMs: 0, exitedAtMs: 1000 }] },
    )).rejects.toThrow("redis down");

    expect(deleteUploadedAsset).toHaveBeenCalledWith("project-a", "file-a", "focused-practice-audio");
    expect(jobs.update).toHaveBeenCalledWith("job-focused", expect.objectContaining({
      status: "failed", error: expect.objectContaining({ code: "FOCUSED_PRACTICE_ANALYSIS_ENQUEUE_FAILED" }),
    }));
    expect(query.mock.calls.some(([sql]) => String(sql).includes("status='failed',error_code='PROVIDER_UNAVAILABLE'"))).toBe(true);
  });

  it("requires adjacent measured passes for stabilization and does not complete the session", () => {
    const attempts = [
      attempt(1, "passed"),
      attempt(2, "unmeasured"),
      attempt(3, "passed"),
    ];
    expect(deriveStabilization(attempts)).toEqual([
      { goalId: "goal-a", stabilized: false },
    ]);
    expect(
      deriveStabilization([attempt(1, "passed"), attempt(2, "passed")]),
    ).toEqual([{ goalId: "goal-a", stabilized: true }]);
    const failed = attempt(2, "unmeasured");
    failed.status = "failed";
    failed.goalOutcomes = [];
    expect(
      deriveStabilization([attempt(1, "passed"), failed, attempt(3, "passed")]),
    ).toEqual([{ goalId: "goal-a", stabilized: false }]);
  });

  it.each([
    ["audio/webm", "focused-practice-audio.webm"],
    ["audio/mpeg", "focused-practice-audio.mp3"],
    ["audio/x-m4a", "focused-practice-audio.m4a"],
  ])("adds the matching extension to %s uploads", (mimeType, expected) => {
    expect(focusedPracticeAudioFileName(mimeType)).toBe(expected);
  });
});

function createService(
  dataSource: DataSource,
  files = {} as FilesService,
  jobs = {} as JobsService,
) {
  return new FocusedPracticeService(
    dataSource,
    {
      assertCanReadProject: vi.fn(async () => ({})),
      assertCanWriteProject: vi.fn(async () => ({})),
    } as unknown as ProjectsService,
    files,
    jobs,
  );
}

function attempt(
  number: number,
  outcome: "passed" | "unmeasured",
): FocusedPracticeAttempt {
  return {
    attemptId: `attempt-${number}`,
    projectId: "project-a",
    practiceSessionId: "practice-a",
    attemptNumber: number,
    status: "succeeded",
    result: outcome === "passed" ? "passed" : "unmeasured",
    audioFileId: null,
    analysisJobId: null,
    cleanupState: "deleted",
    cleanupGeneration: 1,
    rawAudioDeletedAt: null,
    rawAudioDeleteDeadlineAt: "2026-07-11T00:30:00.000Z",
    durationMs: 1000,
    slideTimeline: [],
    goalOutcomes: [
      {
        goalId: "goal-a",
        criterionRef: { criterionId: "criterion-a", revision: 1 },
        measurementState: outcome === "passed" ? "measured" : "unmeasured",
        outcome,
        observation:
          outcome === "passed"
            ? { kind: "duration-seconds", value: 1 }
            : { kind: "none" },
        threshold:
          outcome === "passed"
            ? { kind: "max-duration-seconds", value: 2 }
            : { kind: "none" },
        reasonCode: outcome === "passed" ? "PASSED" : "EVALUATION_UNAVAILABLE",
      },
    ],
    errorCode: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    completedAt: "2026-07-11T00:01:00.000Z",
  };
}
function focusedSessionRow() {
  return {
    practice_session_id: "practice-existing",
    project_id: "project-a",
    deck_id: "deck_a",
    source_full_run_id: "run-a",
    source_goal_set_id: "goalset-a",
    goal_ids_json: ["goal-a"],
    target_scope_json: {
      type: "slide",
      scopeId: "scope-a",
      slideId: "slide_a",
    },
    snapshot_json: {
      deckVersion: 2,
      briefRef: { mode: "generic" },
      goalSetRef: { goalSetId: "goalset-a", revision: 3 },
      evaluatorLensRef: { lensId: "general-novice", revision: 1 },
      criterionRefs: [{ criterionId: "criterion-a", revision: 1 }],
    },
    compatibility_state: "current",
    status: "active",
    data_origin: "live",
    created_by: "user-a",
    created_at: "2026-07-12T00:00:00.000Z",
    completed_at: null,
  };
}

function currentDeckWithSlide(slideId: string) {
  return {
    ...currentDeck(),
    slides: [
      {
        slideId,
        order: 1,
        title: "Replacement",
        style: {},
        speakerNotes: "Replacement",
      },
    ],
  };
}

function evaluationSnapshot() {
  return {
    deckId: "deck_a",
    deckVersion: 2,
    deckContentHash: null,
    evaluationPlan: {
      planVersion: 1,
      briefRef: { mode: "generic" },
      evaluatorLensRef: { lensId: "general-novice", revision: 1 },
      targetDurationSeconds: 60,
      criteria: [],
      metricDefinitionVersions: {
        timing: 1,
        filler: 1,
        silence: 1,
        semantic: 1,
      },
      approvedReferences: [],
      practiceGoalSetRef: null,
    },
    focusProfileSnapshot: null,
    capturedAt: "2026-07-12T00:00:00.000Z",
    slides: [
      {
        slideId: "slide_a",
        order: 1,
        title: "Slide A",
        estimatedSeconds: 30,
        keywords: [],
        semanticCues: [],
      },
    ],
  };
}

function currentDeck(speakerNotes = "연습 문장") {
  return {
    deckId: "deck_a",
    projectId: "project-a",
    title: "Deck A",
    version: 2,
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    slides: [
      {
        slideId: "slide_a",
        order: 1,
        title: "Slide A",
        style: {},
        speakerNotes,
      },
    ],
  };
}
