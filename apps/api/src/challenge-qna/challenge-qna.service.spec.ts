import { deckSchema } from "@orbit/shared/deck";
import type { EntityManager } from "typeorm";
import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { FilesService } from "../files/files.service";
import type { JobsService } from "../jobs/jobs.service";
import type { ProjectsService } from "../projects/projects.service";
import type { ChallengeQnaEvidenceCache } from "./challenge-qna-evidence-cache";
import { buildChallengeQnaSource, ChallengeQnaService } from "./challenge-qna.service";

const jobQueueMocks = vi.hoisted(() => ({
  enqueueChallengeQnaAnswerAnalysisJob: vi.fn(async () => undefined),
  enqueueChallengeQnaGenerationJob: vi.fn(async () => undefined),
}));

vi.mock("@orbit/job-queue", () => jobQueueMocks);

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({ JOB_QUEUE_DRIVER: "bullmq", REDIS_URL: "redis://localhost:6379", REHEARSAL_AUDIO_MAX_BYTES: 50_000_000, ADAPTIVE_REHEARSAL_COACH_ENABLED: true, CHALLENGE_QNA_ENABLED: true, ADAPTIVE_COACHING_PROJECT_ALLOWLIST: ["*"] }),
  isAdaptiveCoachingProjectAllowed: () => true,
}));

describe("ChallengeQnaService grounding", () => {
  it("freezes only hash-matched approved chunks inside the project", async () => {
    const deck = deckSchema.parse({
      deckId: "deck_a", projectId: "project-a", title: "Deck", version: 2,
      targetDurationMinutes: 5,
      canvas: { preset: "wide-16-9", width: 1920, height: 1080, aspectRatio: "16:9" },
      slides: [{ slideId: "slide_a", order: 1, title: "핵심", elements: [], keywords: [], semanticCues: [] }],
    });
    const query = vi.fn()
      .mockResolvedValueOnce([{ deck_id: "deck_a", goal_set_id: "set-a", evaluation_snapshot_json: { evaluationPlan: {
        briefRef: { mode: "briefed", briefId: "brief-a", revision: 2 },
        evaluatorLensRef: { lensId: "decision-maker", revision: 1 },
        approvedReferences: [{ fileId: "file-approved", fileContentHash: "a".repeat(64) }],
      } } }])
      .mockResolvedValueOnce([{ deck_id: "deck_a", version: 2, deck_json: deck }])
      .mockResolvedValueOnce([{ goal_id: "goal-a", criterion_ref_json: { criterionId: "criterion-a", revision: 1 } }])
      .mockResolvedValueOnce([{ id: "chunk-a", content: "승인된 근거", content_hash: "b".repeat(64), file_content_hash: "a".repeat(64) }]);

    const result = await buildChallengeQnaSource({ query } as unknown as EntityManager, "project-a", {
      mode: "final", sourceFullRunId: "run-a", questionCount: 3,
    });

    expect(result.groundingSnapshot.chunks).toHaveLength(1);
    expect(result.sourceSnapshot.approvedReferences).toEqual([{ fileId: "file-approved", fileContentHash: "a".repeat(64) }]);
    expect(query.mock.calls[3]?.[1]).toEqual(["project-a", "file-approved", "a".repeat(64)]);
  });

  it("does not reveal the full guide before the first answer attempt", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ project_id: "project-a", generation_revision: 1 }])
      .mockResolvedValueOnce([{ question_id: "question-a" }])
      .mockResolvedValueOnce([]);
    const service = new ChallengeQnaService(
      { query } as unknown as DataSource,
      { assertCanWriteProject: vi.fn(async () => ({})) } as unknown as ProjectsService,
      {} as FilesService,
      {} as JobsService,
      {} as ChallengeQnaEvidenceCache,
    );

    await expect(service.revealAssistance("session-a", "question-a", "user-a", {
      questionRevision: 1,
      level: "full-guide",
    })).rejects.toMatchObject({ response: { code: "INVALID_STATE_TRANSITION" } });
    expect(query.mock.calls[2]?.[0]).toContain("status='succeeded'");
  });

  it("reveals the full guide only after a succeeded answer", async () => {
    const question = {
      question_id: "question-a", project_id: "project-a", qna_session_id: "qna-existing", revision: 1,
      question_order: 1, question_type: "goal-linked", difficulty: "medium", question_text: "근거는?",
      linked_goal_ids_json: [], source_refs_json: [], assistance_level: "full-guide",
      succeeded_attempt_count: 0, answer_guide_json: { mustIncludeConcepts: [] }, provenance_json: {},
    };
    const query = vi.fn()
      .mockResolvedValueOnce([challengeSessionRow()])
      .mockResolvedValueOnce([question])
      .mockResolvedValueOnce([]);
    const service = new ChallengeQnaService(
      { query } as unknown as DataSource,
      { assertCanReadProject: vi.fn(async () => ({})) } as unknown as ProjectsService,
      {} as FilesService,
      {} as JobsService,
      {} as ChallengeQnaEvidenceCache,
    );

    const result = await service.getSession("qna-existing", "user-a");

    expect(result.questions[0]?.answerGuide).toBeNull();
    expect(query.mock.calls[1]?.[0]).toContain("FILTER (WHERE attempts.status='succeeded')");
  });

  it("marks generation state failed when queue dispatch fails", async () => {
    jobQueueMocks.enqueueChallengeQnaGenerationJob.mockRejectedValueOnce(new Error("redis down"));
    const current = { ...challengeSessionRow(), status: "failed", error_code: "PROVIDER_UNAVAILABLE" };
    const retrying = { ...current, status: "preparing", generation_revision: 2, generation_job_id: null, error_code: null };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT * FROM challenge_qna_sessions")) return [current];
      if (sql.includes("generation_revision=generation_revision+1")) return [retrying];
      return [];
    });
    const job = { jobId: "job-generation", projectId: "project-a", type: "challenge-qna-generation", status: "queued", progress: 0, message: "Queued", result: null, error: null, createdAt: "2026-07-12T09:00:00.000Z", updatedAt: "2026-07-12T09:00:00.000Z" } as const;
    const jobs = { create: vi.fn(async () => job), update: vi.fn(async () => ({ ...job, status: "failed" })) };
    const service = new ChallengeQnaService(
      { query } as unknown as DataSource,
      { assertCanWriteProject: vi.fn(async () => ({})) } as unknown as ProjectsService,
      {} as FilesService,
      jobs as unknown as JobsService,
      {} as ChallengeQnaEvidenceCache,
    );

    await expect(service.retryGeneration("qna-existing", "user-a", {
      clientRequestId: "retry-generation-a",
      expectedGenerationRevision: 1,
    })).rejects.toThrow("redis down");

    expect(jobs.update).toHaveBeenCalledWith("job-generation", expect.objectContaining({
      status: "failed", error: expect.objectContaining({ code: "QNA_GENERATION_ENQUEUE_FAILED" }),
    }));
    expect(query.mock.calls.some(([sql]) => String(sql).includes("error_code='PROVIDER_UNAVAILABLE'"))).toBe(true);
  });

  it("returns the existing session when concurrent idempotent creation collides", async () => {
    const row = challengeSessionRow();
    const duplicate = Object.assign(new Error("duplicate request"), {
      code: "23505",
      constraint: "uq_qna_session_client",
    });
    const query = vi.fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const createJob = vi.fn();
    const service = new ChallengeQnaService(
      {
        query,
        transaction: vi.fn(async () => { throw duplicate; }),
      } as unknown as DataSource,
      {
        assertCanReadProject: vi.fn(async () => ({})),
        assertCanWriteProject: vi.fn(async () => ({})),
      } as unknown as ProjectsService,
      {} as FilesService,
      { create: createJob } as unknown as JobsService,
      {} as ChallengeQnaEvidenceCache,
    );

    await expect(service.createSession("project-a", "user-a", {
      clientRequestId: "request-concurrent-a",
      source: { mode: "final", sourceFullRunId: "run-a", questionCount: 3 },
    })).resolves.toMatchObject({
      session: { qnaSessionId: "qna-existing" },
      questions: [],
      attempts: [],
    });
    expect(createJob).not.toHaveBeenCalled();
  });
});

function challengeSessionRow() {
  const capturedAt = "2026-07-12T09:00:00.000Z";
  return {
    qna_session_id: "qna-existing",
    project_id: "project-a",
    deck_id: "deck-a",
    client_request_id: "request-concurrent-a",
    source_json: { mode: "final", sourceFullRunId: "run-a", questionCount: 3 },
    source_snapshot_json: {
      snapshotVersion: 1,
      projectId: "project-a",
      deck: {
        deckId: "deck-a",
        deckVersion: 1,
        deckContentHash: "a".repeat(64),
        slides: [{
          slideId: "slide-a",
          order: 1,
          title: "Opening",
          visibleText: "Opening",
          contentHash: "b".repeat(64),
        }],
      },
      briefRef: { mode: "generic" },
      evaluatorLensRef: { lensId: "general-novice", revision: 1 },
      linkedGoalRefs: [],
      approvedReferences: [],
      capturedAt,
    },
    grounding_snapshot_json: { snapshotVersion: 1, chunks: [], capturedAt },
    status: "preparing",
    generation_revision: 1,
    generation_job_id: null,
    active_question_order: null,
    execution_mode: "fixture",
    error_code: null,
    created_by: "user-a",
    created_at: capturedAt,
    completed_at: null,
  };
}
