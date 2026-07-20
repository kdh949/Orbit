import type { ActivityDefinition } from "./activity-definition.schema";
import type { ActivityQuestionAggregate } from "./activity-results.schema";
import type { ActivityAnswer } from "./activity-runtime.schema";

export function buildActivityAggregates(
  definition: ActivityDefinition,
  responses: ActivityAnswer[][],
): ActivityQuestionAggregate[] {
  return definition.questions.map((question) => {
    const answers = responses
      .flatMap((response) => response)
      .filter((answer) => answer.questionId === question.questionId);
    if (question.type === "rating") {
      const values = answers
        .filter(
          (answer): answer is Extract<ActivityAnswer, { type: "rating" }> =>
            answer.type === "rating",
        )
        .map((answer) => answer.value);
      return {
        questionId: question.questionId,
        type: question.type,
        responseCount: values.length,
        average:
          values.length === 0
            ? null
            : values.reduce((sum, value) => sum + value, 0) / values.length,
        ratingDistribution: [1, 2, 3, 4, 5].map((value) => {
          const count = values.filter((candidate) => candidate === value).length;
          return {
            value,
            count,
            ratio: values.length === 0 ? 0 : count / values.length,
          };
        }),
        choices: [],
      };
    }
    if (
      question.type === "single-choice" ||
      question.type === "multiple-choice"
    ) {
      const selected = answers.flatMap((answer) => {
        if (answer.type === "single-choice") return [answer.optionId];
        if (answer.type === "multiple-choice") return answer.optionIds;
        return [];
      });
      const responseCount = answers.length;
      return {
        questionId: question.questionId,
        type: question.type,
        responseCount,
        average: null,
        ratingDistribution: [],
        choices: question.options.map((option) => {
          const count = selected.filter(
            (optionId) => optionId === option.optionId,
          ).length;
          return {
            optionId: option.optionId,
            count,
            ratio: responseCount === 0 ? 0 : count / responseCount,
          };
        }),
      };
    }
    return {
      questionId: question.questionId,
      type: question.type,
      responseCount: answers.length,
      average: null,
      ratingDistribution: [],
      choices: [],
    };
  });
}
