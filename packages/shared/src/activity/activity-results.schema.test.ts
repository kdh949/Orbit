import { describe, expect, it } from "vitest";

import {
  calculateActivityResponseRate,
  createAudienceActivityProjection,
  type ActivityPresenterResult
} from "./activity-results.schema";

const presenterResult: ActivityPresenterResult = {
  activityRunId: "activity_run_1",
  activityId: "activity_1",
  status: "results",
  revision: 4,
  responseCount: 2,
  participantCount: 4,
  responseRate: 50,
  aggregates: [
    {
      questionId: "question_1",
      type: "rating",
      responseCount: 2,
      average: 4.5,
      ratingDistribution: [
        { value: 1, count: 0, ratio: 0 },
        { value: 2, count: 0, ratio: 0 },
        { value: 3, count: 0, ratio: 0 },
        { value: 4, count: 1, ratio: 0.5 },
        { value: 5, count: 1, ratio: 0.5 }
      ],
      choices: []
    }
  ],
  textEntries: [
    {
      entryId: "activity_text_approved",
      questionId: "question_2",
      text: "공개 가능한 의견",
      displayName: "PRIVATE_NAME_SENTINEL",
      moderationStatus: "approved",
      answeredAt: null,
      updatedAt: "2026-07-17T00:00:00.000Z"
    },
    {
      entryId: "activity_text_pending",
      questionId: "question_2",
      text: "PENDING_TEXT_SENTINEL",
      displayName: "PRIVATE_NAME_SENTINEL",
      moderationStatus: "pending",
      answeredAt: null,
      updatedAt: "2026-07-17T00:00:00.000Z"
    }
  ]
};

describe("createAudienceActivityProjection", () => {
  it("calculates a bounded integer percentage from unique entrants", () => {
    expect(calculateActivityResponseRate(2, 4)).toBe(50);
    expect(calculateActivityResponseRate(0, 0)).toBe(0);
    expect(calculateActivityResponseRate(5, 4)).toBe(100);
  });

  it("re-parses a presenter result into the strict public contract", () => {
    const projection = createAudienceActivityProjection(presenterResult);
    const serialized = JSON.stringify(projection);

    expect(projection?.approvedTextEntries).toEqual([
      expect.objectContaining({ text: "공개 가능한 의견" })
    ]);
    expect(serialized).not.toContain("PRIVATE_NAME_SENTINEL");
    expect(serialized).not.toContain("PENDING_TEXT_SENTINEL");
    expect(serialized).not.toContain("moderationStatus");
    expect(serialized).not.toContain("participantCount");
    expect(serialized).not.toContain("responseRate");
  });

  it("returns no public projection before reveal", () => {
    expect(
      createAudienceActivityProjection({ ...presenterResult, status: "closed" })
    ).toBeNull();
  });
});
