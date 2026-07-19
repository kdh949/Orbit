import { deckSchema, type Job } from "@orbit/shared";
import { ForbiddenException } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {
    SLIDE_QUESTION_GUIDES_ENABLED: true,
    JOB_QUEUE_DRIVER: "memory",
    REDIS_URL: "redis://unused",
  },
  enqueue: vi.fn(),
}));

vi.mock("@orbit/config", () => ({ loadOrbitConfig: () => mocks.config }));
vi.mock("@orbit/job-queue", () => ({
  enqueueSlideQuestionGuideGenerationJob: mocks.enqueue,
}));

import { SlideQuestionGuidesService } from "./slide-question-guides.service";

describe("SlideQuestionGuidesService auto batch", () => {
  beforeEach(() => {
    mocks.config.SLIDE_QUESTION_GUIDES_ENABLED = true;
    mocks.enqueue.mockReset().mockResolvedValue(undefined);
  });

  it("enqueues every slide once with one frozen snapshot and deterministic idempotency", async () => {
    const harness = createHarness();
    const request = {
      clientRequestId: "auto-batch-1",
      deckId: harness.deck.deckId,
      expectedDeckVersion: harness.deck.version,
      questionCount: 3,
    };

    const first = await harness.service.autoCreate("project-1", "user-1", request);
    const clientRequestIds = [...harness.clientRequestIds];
    const second = await harness.service.autoCreate("project-1", "user-1", request);

    expect(first.slides).toHaveLength(3);
    expect(first.slides.every((slide) => slide.status === "accepted")).toBe(true);
    expect(second.slides).toHaveLength(3);
    expect(harness.jobsService.create).toHaveBeenCalledTimes(3);
    expect(mocks.enqueue).toHaveBeenCalledTimes(3);
    expect(harness.decksService.getDeck).toHaveBeenCalledTimes(2);
    expect(harness.decksService.getOrCreateSnapshot).toHaveBeenCalledTimes(2);
    expect(harness.clientRequestIds).toEqual(clientRequestIds);
    expect(clientRequestIds).toHaveLength(3);
    expect(clientRequestIds.every((value) => /^slide-guide-auto_[a-f0-9]{64}$/.test(value))).toBe(true);
    expect(harness.sourceSnapshots).toHaveLength(3);
    expect(harness.sourceSnapshots.every(
      (snapshot) => snapshot.contentHashVersion === "slide-text-v1",
    )).toBe(true);
  });

  it("reuses active and successful guides with the current slide hash", async () => {
    const harness = createHarness({
      reusableBySlideId: {
        slide_1: jobFixture("job-existing-1", "running"),
        slide_2: jobFixture("job-existing-2", "succeeded"),
      },
    });

    const response = await harness.service.autoCreate("project-1", "user-1", {
      clientRequestId: "auto-batch-reuse",
      deckId: harness.deck.deckId,
      expectedDeckVersion: harness.deck.version,
      questionCount: 3,
    });

    expect(response.slides).toHaveLength(3);
    expect(harness.jobsService.create).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(harness.decksService.getOrCreateSnapshot).toHaveBeenCalledTimes(1);
  });

  it("returns a bounded failure without blocking later slide enqueue", async () => {
    mocks.enqueue
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("private provider detail"))
      .mockResolvedValueOnce(undefined);
    const harness = createHarness();

    const response = await harness.service.autoCreate("project-1", "user-1", {
      clientRequestId: "auto-batch-partial",
      deckId: harness.deck.deckId,
      expectedDeckVersion: harness.deck.version,
      questionCount: 3,
    });

    expect(response.slides.map((slide) => slide.status)).toEqual(["accepted", "failed", "accepted"]);
    expect(response.slides[1]).toEqual({
      status: "failed",
      slideId: "slide_2",
      errorCode: "SLIDE_QUESTION_GUIDE_ENQUEUE_FAILED",
    });
    expect(JSON.stringify(response)).not.toContain("private provider detail");
    expect(mocks.enqueue).toHaveBeenCalledTimes(3);
  });

  it("rejects the batch before loading a deck when the runtime flag is disabled", async () => {
    mocks.config.SLIDE_QUESTION_GUIDES_ENABLED = false;
    const harness = createHarness();

    await expect(harness.service.autoCreate("project-1", "user-1", {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.decksService.getDeck).not.toHaveBeenCalled();
  });
});

function createHarness(
  options: {
    reusableBySlideId?: Record<string, Job>;
  } = {},
) {
  const deck = deckSchema.parse(deckFixture());
  const guidesByClientRequest = new Map<string, { guideId: string; jobId: string | null }>();
  const jobs = new Map<string, Job>();
  const clientRequestIds: string[] = [];
  const sourceSnapshots: Array<Record<string, unknown>> = [];
  let jobSequence = 0;
  const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.includes("created_by = $2 AND client_request_id = $3")) {
      const existing = guidesByClientRequest.get(String(parameters[2]));
      return existing ? [{ guide_id: existing.guideId, generation_job_id: existing.jobId }] : [];
    }
    if (normalized.includes("status IN ('queued','running','succeeded')")) {
      const slideId = String(parameters[2]);
      const job = options.reusableBySlideId?.[slideId];
      if (!job) return [];
      jobs.set(job.jobId, job);
      return [{ guide_id: `guide-${slideId}`, generation_job_id: job.jobId }];
    }
    if (normalized.startsWith("INSERT INTO slide_question_guides")) {
      const clientRequestId = String(parameters[7]);
      clientRequestIds.push(clientRequestId);
      sourceSnapshots.push(parameters[6] as Record<string, unknown>);
      guidesByClientRequest.set(clientRequestId, {
        guideId: String(parameters[0]),
        jobId: null,
      });
      return [];
    }
    if (normalized.startsWith("UPDATE slide_question_guides SET generation_job_id")) {
      const guideId = String(parameters[0]);
      const existing = [...guidesByClientRequest.values()].find((guide) => guide.guideId === guideId);
      if (existing) existing.jobId = String(parameters[1]);
      return [];
    }
    return [];
  });
  const jobsService = {
    create: vi.fn(async ({ projectId }: { projectId: string }) => {
      jobSequence += 1;
      const job = jobFixture(`job-${jobSequence}`, "queued", projectId);
      jobs.set(job.jobId, job);
      return job;
    }),
    get: vi.fn(async (jobId: string) => jobs.get(jobId) ?? null),
    update: vi.fn(async (jobId: string, patch: Partial<Job>) => {
      const current = jobs.get(jobId);
      if (current) jobs.set(jobId, { ...current, ...patch });
      return jobs.get(jobId) ?? null;
    }),
  };
  const decksService = {
    getDeck: vi.fn(async () => ({
      projectId: deck.projectId,
      deck,
      updatedAt: "2026-07-19T00:00:00.000Z",
    })),
    getOrCreateSnapshot: vi.fn(async () => ({
      snapshotId: "snapshot_1",
      projectId: deck.projectId,
      deckId: deck.deckId,
      version: deck.version,
      reason: "auto-save",
      createdAt: "2026-07-19T00:00:00.000Z",
    })),
  };
  const logger = { info: vi.fn() };
  const service = new SlideQuestionGuidesService(
    { query } as unknown as DataSource,
    decksService as never,
    jobsService as never,
    logger as never,
  );
  return { service, deck, decksService, jobsService, clientRequestIds, sourceSnapshots };
}

function jobFixture(jobId: string, status: Job["status"], projectId = "project-1"): Job {
  return {
    jobId,
    projectId,
    type: "slide-question-guide-generation",
    status,
    progress: status === "queued" ? 0 : 100,
    message: status,
    result: status === "succeeded" ? { guideId: `guide-${jobId}` } : null,
    error: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
  };
}

function deckFixture() {
  return {
    deckId: "deck_1",
    projectId: "project-1",
    title: "자동 질문 덱",
    version: 3,
    metadata: {},
    targetDurationMinutes: 10,
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    theme: {},
    slides: [slideFixture("slide_1", 1), slideFixture("slide_2", 2), slideFixture("slide_3", 3)],
  };
}

function slideFixture(slideId: string, order: number) {
  return {
    slideId,
    order,
    title: `슬라이드 ${order}`,
    thumbnailUrl: "",
    style: {},
    speakerNotes: "발표자 노트",
    elements: [],
    keywords: [],
    semanticCues: [],
    animations: [],
    actions: [],
  };
}
