import { describe, expect, it } from "vitest";

import { buildActivityAggregates } from "./activity-aggregate";

describe("buildActivityAggregates", () => {
  it("builds rating averages and choice ratios from validated answers", () => {
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
          questionId: "question_choice",
          type: "single-choice" as const,
          prompt: "선택",
          required: false,
          options: [
            { optionId: "option_1", label: "하나" },
            { optionId: "option_2", label: "둘" }
          ]
        }
      ],
      allowDisplayName: false,
      hideResultsUntilReveal: true
    };
    expect(
      buildActivityAggregates(definition, [
        [
          { questionId: "question_rating", type: "rating", value: 5 },
          { questionId: "question_choice", type: "single-choice", optionId: "option_1" }
        ],
        [
          { questionId: "question_rating", type: "rating", value: 3 },
          { questionId: "question_choice", type: "single-choice", optionId: "option_2" }
        ]
      ])
    ).toEqual([
      {
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
      },
      {
        questionId: "question_choice",
        type: "single-choice",
        responseCount: 2,
        average: null,
        ratingDistribution: [],
        choices: [
          { optionId: "option_1", count: 1, ratio: 0.5 },
          { optionId: "option_2", count: 1, ratio: 0.5 }
        ]
      }
    ]);
  });
});
