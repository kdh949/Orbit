import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { DecksService } from "../decks/decks.service";
import { createActivityDefinitionFingerprint } from "./activity-definition-fingerprint";
import type { ActivityRunRepository, ActivityRunRow } from "./activity-run.repository";
import { ActivityRunsService } from "./activity-runs.service";

const definition = {
  activityId: "activity_1",
  template: "satisfaction" as const,
  title: "만족도",
  description: "",
  questions: [
    {
      questionId: "question_1",
      type: "rating" as const,
      prompt: "발표가 유익했나요?",
      required: true,
      leftLabel: "아니요",
      rightLabel: "그래요"
    }
  ],
  allowDisplayName: false,
  hideResultsUntilReveal: true
};

const deck = {
  deckId: "deck_1",
  projectId: "project_1",
  title: "Activity Deck",
  version: 7,
  canvas: {
    preset: "wide-16-9" as const,
    width: 1920 as const,
    height: 1080 as const,
    aspectRatio: "16:9" as const
  },
  slides: [
    {
      slideId: "slide_1",
      order: 1,
      title: "만족도",
      thumbnailUrl: "",
      style: {},
      speakerNotes: "",
      elements: [],
      keywords: [],
      semanticCues: [],
      animations: [],
      actions: [],
      kind: "activity" as const,
      activity: definition
    }
  ]
};

const session = {
  session_id: "session_1",
  project_id: "project_1",
  deck_id: "deck_1",
  deck_version: 7,
  session_status: "live" as const,
  session_purpose: "presentation" as const,
  audience_access_enabled: true,
  starts_at: "2026-01-01T00:00:00.000Z",
  expires_at: "2027-07-31T00:00:00.000Z"
};

const run: ActivityRunRow = {
  activity_run_id: "activity_run_1",
  project_id: "project_1",
  session_id: "session_1",
  activity_id: "activity_1",
  source_slide_id: "slide_1",
  version: 1,
  supersedes_activity_run_id: null,
  definition_snapshot: definition,
  definition_fingerprint: createActivityDefinitionFingerprint(definition),
  status: "draft",
  revision: 0,
  is_current: true,
  response_count: 0,
  opened_at: null,
  closed_at: null,
  revealed_at: null,
  created_at: "2026-07-17T00:00:00.000Z",
  updated_at: "2026-07-17T00:00:00.000Z"
};

function createService(
  overrides: Partial<ActivityRunRepository> = {},
  deckOverrides: Partial<DecksService> = {}
) {
  const manager = {} as never;
  const repository = {
    transaction: vi.fn(async (work) => work(manager)),
    findSessionIdentity: vi.fn().mockResolvedValue({ deck_id: "deck_1" }),
    lockSession: vi.fn().mockResolvedValue(session),
    findCurrent: vi.fn().mockResolvedValue(run),
    findCurrentForRead: vi.fn().mockResolvedValue(run),
    findById: vi.fn().mockResolvedValue(run),
    insert: vi.fn().mockResolvedValue(run),
    updateSnapshot: vi.fn().mockResolvedValue({ ...run, revision: run.revision + 1 }),
    markSuperseded: vi.fn().mockResolvedValue(undefined),
    closeOtherOpenRuns: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn().mockImplementation(
      async (_manager, _runId, status) => ({
        ...run,
        status,
        revision: run.revision + 1
      })
    ),
    setActiveRun: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as ActivityRunRepository;
  const decksService = {
    getDeckForUpdate: vi.fn().mockResolvedValue(deck),
    ...deckOverrides
  } as unknown as DecksService;
  const logger = { info: vi.fn() } as never;
  return {
    decksService,
    repository,
    service: new ActivityRunsService(repository, decksService, logger)
  };
}

describe("ActivityRunsService", () => {
  it("reads a current run without creating or locking a new run", async () => {
    const { repository, service } = createService();

    await expect(
      service.getCurrentRun("project_1", "session_1", "activity_1")
    ).resolves.toMatchObject({ run: { activityRunId: "activity_run_1" } });
    expect(repository.findCurrentForRead).toHaveBeenCalledWith(
      "project_1",
      "session_1",
      "activity_1"
    );
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("returns an explicit null when an activity has no run", async () => {
    const { service } = createService({
      findCurrentForRead: vi.fn().mockResolvedValue(null)
    });

    await expect(
      service.getCurrentRun("project_1", "session_1", "activity_missing")
    ).resolves.toEqual({ run: null });
  });

  it("creates the first run from the stored Deck definition", async () => {
    const { decksService, repository, service } = createService({
      findCurrent: vi.fn().mockResolvedValue(null)
    });

    await expect(
      service.ensureCurrentRun("project_1", "session_1", "activity_1")
    ).resolves.toMatchObject({ run: { activityId: "activity_1", version: 1 } });
    expect(decksService.getDeckForUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "project_1",
      "deck_1"
    );
    expect(repository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "project_1",
        sessionId: "session_1",
        sourceSlideId: "slide_1",
        definition
      })
    );
  });

  it("rejects activity run creation for a rehearsal session", async () => {
    const { repository, service } = createService({
      lockSession: vi.fn().mockResolvedValue({
        ...session,
        session_purpose: "rehearsal",
        audience_access_enabled: false,
      }),
    });

    await expect(
      service.ensureCurrentRun("project_1", "session_1", "activity_1"),
    ).rejects.toMatchObject({
      message: "Audience access must be enabled for activity runs",
    });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("synchronizes a changed definition before the first response", async () => {
    const staleRun = { ...run, definition_fingerprint: "stale-fingerprint" };
    const { repository, service } = createService({
      findCurrent: vi.fn().mockResolvedValue(staleRun)
    });

    await service.ensureCurrentRun("project_1", "session_1", "activity_1");

    expect(repository.updateSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "activity_run_1",
      "slide_1",
      definition,
      createActivityDefinitionFingerprint(definition),
      expect.any(Date)
    );
  });

  it("keeps the definition snapshot immutable after the first response", async () => {
    const lockedRun = {
      ...run,
      definition_fingerprint: "stale-fingerprint",
      response_count: 1
    };
    const { repository, service } = createService({
      findCurrent: vi.fn().mockResolvedValue(lockedRun)
    });

    const error = await service
      .ensureCurrentRun("project_1", "session_1", "activity_1")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: "ACTIVITY_DEFINITION_LOCKED",
      currentRun: { responseCount: 1 }
    });
    expect(repository.updateSnapshot).not.toHaveBeenCalled();
  });

  it("locks the Deck and session before opening a run and closes any other open run", async () => {
    const openRun = {
      ...run,
      status: "closed" as const,
      revision: 3,
      response_count: 7
    };
    const { decksService, repository, service } = createService({
      findById: vi.fn().mockResolvedValue(openRun),
      closeOtherOpenRuns: vi.fn().mockResolvedValue(["activity_run_other"]),
      updateStatus: vi.fn().mockResolvedValue({
        ...openRun,
        status: "open",
        revision: 4,
        opened_at: "2026-07-17T01:00:00.000Z"
      })
    });

    await expect(
      service.updateStatus("project_1", "session_1", "activity_run_1", {
        status: "open",
        expectedRevision: 3
      })
    ).resolves.toMatchObject({
      run: { status: "open", responseCount: 7 }
    });

    expect(vi.mocked(decksService.getDeckForUpdate).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repository.lockSession).mock.invocationCallOrder[0] ?? Infinity
    );
    expect(vi.mocked(repository.lockSession).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repository.findById).mock.invocationCallOrder[0] ?? Infinity
    );
    expect(repository.closeOtherOpenRuns).toHaveBeenCalled();
    expect(repository.setActiveRun).toHaveBeenCalledWith(
      expect.anything(),
      "project_1",
      "session_1",
      "activity_run_1",
      expect.any(Date)
    );
  });

  it("returns an idempotent success for an already applied status", async () => {
    const alreadyOpen = { ...run, status: "open" as const, revision: 4 };
    const { repository, service } = createService({
      findById: vi.fn().mockResolvedValue(alreadyOpen)
    });

    await expect(
      service.updateStatus("project_1", "session_1", "activity_run_1", {
        status: "open",
        expectedRevision: 1
      })
    ).resolves.toMatchObject({ run: { status: "open", revision: 4 } });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("rejects an illegal direct results-to-open transition", async () => {
    const resultsRun = { ...run, status: "results" as const, revision: 2 };
    const { service } = createService({
      findById: vi.fn().mockResolvedValue(resultsRun)
    });

    const error = await service
      .updateStatus("project_1", "session_1", "activity_run_1", {
        status: "open",
        expectedRevision: 2
      })
      .catch((caught: unknown) => caught);

    expect((error as HttpException).getResponse()).toMatchObject({
      code: "ACTIVITY_INVALID_STATE_TRANSITION"
    });
  });

  it("creates an explicit next version while retaining the previous run", async () => {
    const { repository, service } = createService({
      insert: vi.fn().mockResolvedValue({
        ...run,
        activity_run_id: "activity_run_2",
        version: 2,
        supersedes_activity_run_id: "activity_run_1"
      })
    });

    await expect(
      service.supersede("project_1", "session_1", "activity_run_1", {
        expectedRevision: 0
      })
    ).resolves.toMatchObject({
      previousRunId: "activity_run_1",
      run: { activityRunId: "activity_run_2", version: 2 }
    });
    expect(repository.markSuperseded).toHaveBeenCalled();
  });
});
