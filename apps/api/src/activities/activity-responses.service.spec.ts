import { describe, expect, it, vi } from "vitest";

import type { ActivityResponseRepository } from "./activity-response.repository";
import { ActivityResponsesService } from "./activity-responses.service";

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
  allowDisplayName: false,
  hideResultsUntilReveal: true
};

const target = {
  activity_run_id: "activity_run_1",
  project_id: "project_1",
  session_id: "session_1",
  activity_id: "activity_1",
  definition_snapshot: definition,
  status: "open" as const,
  revision: 3
};

const response = {
  response_id: "activity_response_1",
  project_id: "project_1",
  activity_run_id: "activity_run_1",
  audience_id: "audience_1",
  answers_json: [{ questionId: "question_rating", type: "rating", value: 5 }],
  display_name: null,
  last_client_mutation_id: "mutation_1",
  revision: 1,
  submitted_at: "2026-07-17T00:00:00.000Z",
  updated_at: "2026-07-17T00:00:00.000Z"
};

function createService(
  overrides: Partial<Record<keyof ActivityResponseRepository, ReturnType<typeof vi.fn>>> = {},
  audienceRateLimit?: { consumeResponseMutation: ReturnType<typeof vi.fn> }
) {
  const manager = {} as never;
  const repository = {
    transaction: vi.fn(async (work) => work(manager)),
    findTarget: vi.fn().mockResolvedValue(target),
    lockAudienceMutation: vi.fn().mockResolvedValue(undefined),
    lockTargetForCommit: vi.fn().mockResolvedValue(target),
    findForAudience: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockResolvedValue(response),
    update: vi.fn().mockResolvedValue({ ...response, revision: 2 }),
    listTextEntries: vi.fn().mockResolvedValue([]),
    upsertTextEntry: vi.fn().mockResolvedValue(undefined),
    deleteTextEntries: vi.fn().mockResolvedValue(undefined),
    bumpRunRevision: vi.fn().mockResolvedValue(4),
    ...overrides
  };
  const logger = { info: vi.fn() } as never;
  return {
    repository,
    service: new ActivityResponsesService(
      repository as unknown as ActivityResponseRepository,
      logger,
      undefined,
      audienceRateLimit as never
    )
  };
}

describe("ActivityResponsesService", () => {
  it("returns the fixed 429 before an excessive response mutation is stored", async () => {
    const limitError = Object.assign(new Error("Too many audience requests"), {
      status: 429
    });
    const audienceRateLimit = {
      consumeResponseMutation: vi.fn().mockRejectedValue(limitError)
    };
    const { repository, service } = createService({}, audienceRateLimit);

    await expect(
      service.upsert("project_1", "session_1", "activity_1", "audience_1", {
        clientMutationId: "mutation_1",
        answers: [{ questionId: "question_rating", type: "rating", value: 5 }]
      })
    ).rejects.toBe(limitError);
    expect(audienceRateLimit.consumeResponseMutation).toHaveBeenCalledWith(
      "audience_1",
      "activity_run_1"
    );
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("creates one response and increments the run response count", async () => {
    const { repository, service } = createService();

    await expect(
      service.upsert("project_1", "session_1", "activity_1", "audience_1", {
        clientMutationId: "mutation_1",
        answers: [{ questionId: "question_rating", type: "rating", value: 5 }]
      })
    ).resolves.toMatchObject({
      response: { responseId: "activity_response_1", revision: 1 },
      runRevision: 4
    });
    expect(repository.bumpRunRevision).toHaveBeenCalledWith(
      expect.anything(),
      "activity_run_1",
      true,
      expect.any(Date)
    );
    expect(repository.lockAudienceMutation).toHaveBeenCalledWith(
      expect.anything(),
      "activity_run_1",
      "audience_1"
    );
    expect(repository.lockAudienceMutation.mock.invocationCallOrder[0]).toBeLessThan(
      repository.findForAudience.mock.invocationCallOrder[0]
    );
    expect(repository.lockTargetForCommit.mock.invocationCallOrder[0]).toBeLessThan(
      repository.insert.mock.invocationCallOrder[0]
    );
    expect(repository.lockTargetForCommit.mock.invocationCallOrder[0]).toBeLessThan(
      repository.bumpRunRevision.mock.invocationCallOrder[0]
    );
  });

  it("returns the existing result for an idempotent mutation retry", async () => {
    const { repository, service } = createService({
      findForAudience: vi.fn().mockResolvedValue(response),
      lockTargetForCommit: vi.fn().mockResolvedValue({ ...target, revision: 9 })
    });

    await expect(
      service.upsert("project_1", "session_1", "activity_1", "audience_1", {
        clientMutationId: "mutation_1",
        answers: [{ questionId: "question_rating", type: "rating", value: 5 }]
      })
    ).resolves.toMatchObject({ runRevision: 9 });
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.bumpRunRevision).not.toHaveBeenCalled();
  });

  it("rejects before storing a response when the run closes before commit", async () => {
    const { repository, service } = createService({
      lockTargetForCommit: vi.fn().mockResolvedValue(null)
    });

    await expect(
      service.upsert("project_1", "session_1", "activity_1", "audience_1", {
        clientMutationId: "mutation_1",
        answers: [{ questionId: "question_rating", type: "rating", value: 5 }]
      })
    ).rejects.toMatchObject({ message: "Activity is not open for responses" });
    expect(repository.insert).not.toHaveBeenCalled();
    expect(repository.bumpRunRevision).not.toHaveBeenCalled();
  });

  it("resets moderation only when free text changes", async () => {
    const withText = {
      ...response,
      answers_json: [
        { questionId: "question_rating", type: "rating", value: 5 },
        { questionId: "question_text", type: "free-text", text: "기존 의견" }
      ],
      last_client_mutation_id: "mutation_old"
    };
    const { repository, service } = createService({
      findForAudience: vi.fn().mockResolvedValue(withText),
      update: vi.fn().mockResolvedValue({
        ...withText,
        answers_json: [
          { questionId: "question_rating", type: "rating", value: 4 },
          { questionId: "question_text", type: "free-text", text: "기존 의견" }
        ],
        last_client_mutation_id: "mutation_new",
        revision: 2
      }),
      listTextEntries: vi.fn().mockResolvedValue([
        {
          entry_id: "activity_text_1",
          question_id: "question_text",
          text_value: "기존 의견"
        }
      ])
    });

    await service.upsert("project_1", "session_1", "activity_1", "audience_1", {
      clientMutationId: "mutation_new",
      answers: [
        { questionId: "question_rating", type: "rating", value: 4 },
        { questionId: "question_text", type: "free-text", text: "기존 의견" }
      ]
    });

    expect(repository.upsertTextEntry).not.toHaveBeenCalled();
    expect(repository.bumpRunRevision).toHaveBeenCalledWith(
      expect.anything(),
      "activity_run_1",
      false,
      expect.any(Date)
    );
  });
});
