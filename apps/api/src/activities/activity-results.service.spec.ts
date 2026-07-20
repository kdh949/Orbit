import { describe, expect, it, vi } from "vitest";

import type { ActivityResultsRepository } from "./activity-results.repository";
import { ActivityResultsService } from "./activity-results.service";

const definition = {
  activityId: "activity_1",
  template: "satisfaction" as const,
  title: "만족도",
  description: "",
  questions: [
    {
      questionId: "question_rating",
      type: "rating" as const,
      prompt: "평점",
      required: true,
      leftLabel: "낮음",
      rightLabel: "높음"
    },
    {
      questionId: "question_text",
      type: "free-text" as const,
      prompt: "의견",
      required: false
    }
  ],
  allowDisplayName: true,
  hideResultsUntilReveal: true
};

const run = {
  activity_run_id: "activity_run_1",
  project_id: "project_1",
  session_id: "session_1",
  activity_id: "activity_1",
  source_slide_id: "slide_1",
  version: 1,
  supersedes_activity_run_id: null,
  definition_snapshot: definition,
  definition_fingerprint: "fingerprint-1",
  status: "results" as const,
  revision: 5,
  is_current: true,
  response_count: 2,
  opened_at: "2026-07-17T00:00:00.000Z",
  closed_at: "2026-07-17T00:10:00.000Z",
  revealed_at: "2026-07-17T00:11:00.000Z",
  created_at: "2026-07-17T00:00:00.000Z",
  updated_at: "2026-07-17T00:11:00.000Z"
};

const responses = [
  {
    response_id: "activity_response_1",
    answers_json: [
      { questionId: "question_rating", type: "rating", value: 5 },
      { questionId: "question_text", type: "free-text", text: "공개 의견" }
    ],
    display_name: "PRIVATE_NAME_SENTINEL",
    revision: 1,
    submitted_at: "2026-07-17T00:05:00.000Z",
    updated_at: "2026-07-17T00:05:00.000Z"
  },
  {
    response_id: "activity_response_2",
    answers_json: [{ questionId: "question_rating", type: "rating", value: 3 }],
    display_name: null,
    revision: 1,
    submitted_at: "2026-07-17T00:06:00.000Z",
    updated_at: "2026-07-17T00:06:00.000Z"
  }
];

function createService(
  status: typeof run.status | "closed" = "results",
  retention: "raw-retained" | "aggregate-only" | "results-deleted" = "raw-retained"
) {
  let resultsDeleted = retention === "results-deleted";
  const manager = {} as never;
  const repository = {
    transaction: vi.fn(async (work) => work(manager)),
    findRun: vi.fn().mockResolvedValue({ ...run, status }),
    findCurrentRun: vi.fn().mockResolvedValue({ ...run, status }),
    findActiveRun: vi.fn().mockResolvedValue({ ...run, status }),
    listSessionRuns: vi.fn().mockResolvedValue([{ ...run, status }]),
    listSessionSnapshots: vi.fn().mockResolvedValue(
      retention === "aggregate-only"
        ? [{
            activity_run_id: run.activity_run_id,
            aggregate_json: {
              activityRunId: run.activity_run_id,
              activityId: run.activity_id,
              status,
              revision: run.revision,
              responseCount: run.response_count,
              participantCount: 4,
              responseRate: 50,
              aggregates: [{
                questionId: "question_rating",
                type: "rating",
                responseCount: 2,
                average: 4,
                ratingDistribution: [
                  { value: 1, count: 0, ratio: 0 },
                  { value: 2, count: 0, ratio: 0 },
                  { value: 3, count: 1, ratio: 0.5 },
                  { value: 4, count: 0, ratio: 0 },
                  { value: 5, count: 1, ratio: 0.5 }
                ],
                choices: []
              }],
              textEntries: []
            }
          }]
        : []
    ),
    hardDeleteSessionResults: vi.fn().mockImplementation(async () => {
      resultsDeleted = true;
      return true;
    }),
    countSessionAudiences: vi.fn().mockResolvedValue(4),
    findOwnResponse: vi.fn().mockResolvedValue(responses[0]),
    listResponses: vi.fn().mockResolvedValue(responses),
    listTextEntries: vi.fn().mockResolvedValue([
      {
        entry_id: "activity_text_approved",
        question_id: "question_text",
        text_value: "공개 의견",
        display_name: "PRIVATE_NAME_SENTINEL",
        moderation_status: "approved",
        answered_at: null,
        updated_at: "2026-07-17T00:05:00.000Z"
      },
      {
        entry_id: "activity_text_pending",
        question_id: "question_text",
        text_value: "PENDING_TEXT_SENTINEL",
        display_name: "PRIVATE_NAME_SENTINEL",
        moderation_status: "pending",
        answered_at: null,
        updated_at: "2026-07-17T00:06:00.000Z"
      }
    ])
  } as unknown as ActivityResultsRepository;
  const presentationSessionsService = {
    getSessionForPresenter: vi.fn().mockImplementation(async () => ({
      sessionId: "session_1",
      projectId: "project_1",
      deckId: "deck_1",
      deckVersion: 1,
      presenterUserId: "user_owner",
      createdBy: "user_owner",
      status: "ended",
      accessMode: "public",
      startsAt: "2026-07-17T00:00:00.000Z",
      expiresAt: "2026-07-18T00:00:00.000Z",
      activeActivityRunId: null,
      startedAt: "2026-07-17T00:00:00.000Z",
      endedAt: "2026-07-17T00:20:00.000Z",
      closedAt: "2026-07-17T00:20:00.000Z",
      rawResponsesDeleteAfter: "2026-10-15T00:20:00.000Z",
      rawResponsesDeletedAt: retention === "aggregate-only" ? "2026-10-15T00:20:00.000Z" : null,
      resultsDeletedAt: resultsDeleted ? "2026-07-17T00:21:00.000Z" : null,
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:21:00.000Z"
    }))
  };
  const logger = { info: vi.fn() };
  return {
    logger,
    presentationSessionsService,
    repository,
    service: new ActivityResultsService(
      repository,
      presentationSessionsService as never,
      logger as never
    )
  };
}

describe("ActivityResultsService", () => {
  it("returns full text moderation details only to the presenter projection", async () => {
    const result = await createService().service.getPresenterResult(
      "project_1",
      "session_1",
      "activity_run_1"
    );

    expect(result.result.responseCount).toBe(2);
    expect(result.result).toMatchObject({ participantCount: 4, responseRate: 50 });
    expect(result.result.aggregates[0]).toMatchObject({
      questionId: "question_rating",
      average: 4,
      responseCount: 2
    });
    expect(result.result.textEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryId: "activity_text_approved",
          displayName: "PRIVATE_NAME_SENTINEL"
        }),
        expect.objectContaining({
          entryId: "activity_text_pending",
          text: "PENDING_TEXT_SENTINEL"
        })
      ])
    );
  });

  it("removes display names and pending text from the public projection", async () => {
    const result = await createService().service.getPublicResult(
      "project_1",
      "session_1",
      "activity_run_1"
    );
    const serialized = JSON.stringify(result);

    expect(result.result?.approvedTextEntries).toEqual([
      {
        entryId: "activity_text_approved",
        questionId: "question_text",
        text: "공개 의견",
        answered: false
      }
    ]);
    expect(serialized).not.toContain("PRIVATE_NAME_SENTINEL");
    expect(serialized).not.toContain("PENDING_TEXT_SENTINEL");
  });

  it("does not expose aggregate results before the results state", async () => {
    await expect(
      createService("closed").service.getPublicResult("project_1", "session_1", "activity_run_1")
    ).resolves.toEqual({ result: null });
  });

  it("returns the active activity with the current audience response", async () => {
    const result = await createService("closed").service.getAudienceActiveActivity(
      "project_1",
      "session_1",
      "audience_private"
    );

    expect(result.activity).toMatchObject({
      activityId: "activity_1",
      ownResponse: { responseId: "activity_response_1" },
      publicResult: null
    });
  });

  it("loads only runs from the requested project and session archive", async () => {
    const { repository, service } = createService();
    const archive = await service.getSessionArchive("project_1", "session_1");

    expect(repository.listSessionRuns).toHaveBeenCalledWith("project_1", "session_1");
    expect(archive).toMatchObject({
      session: { sessionId: "session_1" },
      activities: [{ availability: "raw-retained", result: { responseCount: 2 } }]
    });
  });

  it("uses the anonymous snapshot in the aggregate-only archive state", async () => {
    const archive = await createService("results", "aggregate-only").service.getSessionArchive(
      "project_1",
      "session_1"
    );
    expect(archive.activities[0]).toMatchObject({
      availability: "aggregate-only",
      result: {
        responseCount: 2,
        textEntries: []
      }
    });
    expect(JSON.stringify(archive)).not.toContain("PRIVATE_NAME_SENTINEL");
  });

  it("does not expose a snapshot after hard deletion", async () => {
    const archive = await createService("results", "results-deleted").service.getSessionArchive(
      "project_1",
      "session_1"
    );
    expect(archive.activities[0]).toMatchObject({
      availability: "results-deleted",
      result: null
    });
  });

  it("requires the exact session name before permanent deletion", async () => {
    const { repository, service } = createService();
    await expect(
      service.deleteSessionResults("project_1", "session_1", {
        confirmation: "잘못된 이름"
      })
    ).rejects.toThrow("confirmation does not match");
    expect(repository.hardDeleteSessionResults).not.toHaveBeenCalled();
  });

  it("permanently deletes a session and returns only the deleted state", async () => {
    const { logger, repository, service } = createService();
    const archive = await service.deleteSessionResults("project_1", "session_1", {
      confirmation: "발표 세션 2026-07-17 ession_1"
    });

    expect(repository.hardDeleteSessionResults).toHaveBeenCalledWith(
      expect.anything(),
      "project_1",
      "session_1",
      expect.any(Date)
    );
    expect(archive.activities[0]).toMatchObject({
      availability: "results-deleted",
      result: null
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "activity_results.deleted" }),
      expect.any(String)
    );
  });

  it("returns no presenter or public result after deletion", async () => {
    const { repository, service } = createService();
    vi.mocked(repository.findRun).mockResolvedValue({
      ...run,
      results_deleted_at: "2026-07-17T00:21:00.000Z"
    } as never);

    await expect(
      service.getPresenterResult("project_1", "session_1", "activity_run_1")
    ).rejects.toThrow("Activity results deleted");
    await expect(
      service.getPublicResult("project_1", "session_1", "activity_run_1")
    ).resolves.toEqual({ result: null });
  });
});
