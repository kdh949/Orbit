import { describe, expect, it } from "vitest";

import {
  activityPresenterResultSchema,
  activityPublicResultSchema
} from "./activity-results.schema";
import {
  getAudienceActiveActivityResponseSchema,
  getCurrentActivityRunResponseSchema,
  deletePresentationSessionResultsRequestSchema,
  updateActivityRunStatusRequestSchema,
  upsertActivityResponseRequestSchema
} from "./activity-api.schema";

const resultBase = {
  activityRunId: "activity_run_1",
  activityId: "activity_1",
  status: "results" as const,
  revision: 3,
  responseCount: 1,
  aggregates: [
    {
      questionId: "question_1",
      type: "rating" as const,
      responseCount: 1,
      average: 5,
      ratingDistribution: [
        { value: 1, count: 0, ratio: 0 },
        { value: 2, count: 0, ratio: 0 },
        { value: 3, count: 0, ratio: 0 },
        { value: 4, count: 0, ratio: 0 },
        { value: 5, count: 1, ratio: 1 }
      ],
      choices: []
    }
  ]
};

describe("activity API boundary schemas", () => {
  it("keeps presenter raw text separate from public approved text", () => {
    expect(
      activityPresenterResultSchema.safeParse({
        ...resultBase,
        participantCount: 2,
        responseRate: 50,
        textEntries: [
          {
            entryId: "activity_text_1",
            questionId: "question_1",
            text: "검토 전 원문 sentinel",
            displayName: "민감 이름 sentinel",
            moderationStatus: "pending",
            answeredAt: null,
            updatedAt: "2026-07-17T10:00:00.000Z"
          }
        ]
      }).success
    ).toBe(true);

    expect(
      activityPublicResultSchema.safeParse({
        ...resultBase,
        approvedTextEntries: [],
        displayName: "민감 이름 sentinel"
      }).success
    ).toBe(false);

    expect(
      activityPublicResultSchema.safeParse({
        ...resultBase,
        approvedTextEntries: [],
        textEntries: [{ text: "검토 전 원문 sentinel" }]
      }).success
    ).toBe(false);
  });

  it("rejects unknown fields in mutation requests", () => {
    expect(
      updateActivityRunStatusRequestSchema.safeParse({
        status: "open",
        expectedRevision: 0,
        definition: {}
      }).success
    ).toBe(false);
  });

  it("limits display names, free text, and answer count", () => {
    expect(
      upsertActivityResponseRequestSchema.safeParse({
        clientMutationId: "mutation_1",
        displayName: "가".repeat(41),
        answers: [
          {
            questionId: "question_1",
            type: "free-text",
            text: "나".repeat(2001)
          }
        ]
      }).success
    ).toBe(false);
  });

  it("represents an audience session with no active activity explicitly", () => {
    expect(
      getAudienceActiveActivityResponseSchema.safeParse({ activity: null }).success
    ).toBe(true);
    expect(
      getAudienceActiveActivityResponseSchema.safeParse({}).success
    ).toBe(false);
  });

  it("represents an activity with no run explicitly", () => {
    expect(getCurrentActivityRunResponseSchema.safeParse({ run: null }).success).toBe(true);
    expect(getCurrentActivityRunResponseSchema.safeParse({}).success).toBe(false);
  });

  it("requires an exact, strict hard-delete confirmation payload", () => {
    expect(
      deletePresentationSessionResultsRequestSchema.safeParse({
        confirmation: "발표 세션 2026-07-17 abcdef12"
      }).success
    ).toBe(true);
    expect(
      deletePresentationSessionResultsRequestSchema.safeParse({
        confirmation: "발표 세션 2026-07-17 abcdef12",
        force: true
      }).success
    ).toBe(false);
  });
});
