import { describe, expect, it } from "vitest";

import { activityDefinitionSchema } from "./activity-definition.schema";

function satisfactionDefinition() {
  return {
    activityId: "activity_satisfaction_1",
    template: "satisfaction" as const,
    title: "발표 만족도",
    description: "발표에 대한 의견을 알려주세요.",
    allowDisplayName: false,
    hideResultsUntilReveal: true,
    questions: [
      {
        questionId: "question_rating_1",
        type: "rating" as const,
        prompt: "발표는 유익했나요?",
        required: true,
        leftLabel: "전혀 아니요",
        rightLabel: "매우 그래요"
      }
    ]
  };
}

describe("activityDefinitionSchema", () => {
  it("parses a satisfaction definition and applies defaults", () => {
    expect(activityDefinitionSchema.parse(satisfactionDefinition())).toMatchObject({
      template: "satisfaction",
      questions: [{ type: "rating", required: true }]
    });
  });

  it("accepts one to five free-text questions for pre-question", () => {
    const result = activityDefinitionSchema.safeParse({
      ...satisfactionDefinition(),
      template: "pre-question",
      questions: [
        {
          questionId: "question_pre_1",
          type: "free-text",
          prompt: "발표 전에 궁금한 점이 있나요?",
          required: true
        },
        {
          questionId: "question_pre_2",
          type: "free-text",
          prompt: "가장 기대하는 내용은 무엇인가요?",
          required: false
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects non-free-text questions for pre-question", () => {
    const result = activityDefinitionSchema.safeParse({
      ...satisfactionDefinition(),
      template: "pre-question"
    });

    expect(result.success).toBe(false);
  });

  it("requires exactly one single-choice question for poll", () => {
    const result = activityDefinitionSchema.safeParse({
      ...satisfactionDefinition(),
      template: "poll",
      questions: [
        {
          questionId: "question_poll_1",
          type: "single-choice",
          prompt: "어떤 주제가 좋았나요?",
          required: true,
          options: [
            { optionId: "option_1", label: "제품" },
            { optionId: "option_2", label: "기술" }
          ]
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects more than five satisfaction questions", () => {
    const result = activityDefinitionSchema.safeParse({
      ...satisfactionDefinition(),
      questions: Array.from({ length: 6 }, (_, index) => ({
        questionId: `question_${index + 1}`,
        type: "free-text",
        prompt: `질문 ${index + 1}`,
        required: false
      }))
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate question IDs and option IDs or labels", () => {
    const duplicateQuestions = activityDefinitionSchema.safeParse({
      ...satisfactionDefinition(),
      questions: [
        ...satisfactionDefinition().questions,
        { ...satisfactionDefinition().questions[0] }
      ]
    });
    const duplicateOptions = activityDefinitionSchema.safeParse({
      ...satisfactionDefinition(),
      questions: [
        {
          questionId: "question_choice_1",
          type: "single-choice",
          prompt: "선택",
          required: false,
          options: [
            { optionId: "option_same", label: "같음" },
            { optionId: "option_same", label: "같음" }
          ]
        }
      ]
    });

    expect(duplicateQuestions.success).toBe(false);
    expect(duplicateOptions.success).toBe(false);
  });

  it("rejects unknown and runtime fields", () => {
    const result = activityDefinitionSchema.safeParse({
      ...satisfactionDefinition(),
      responseCount: 12
    });

    expect(result.success).toBe(false);
  });
});
