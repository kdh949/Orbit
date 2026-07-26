import { createHash } from "node:crypto";
import type {
  ActivityDefinition,
  ActivityQuestion,
} from "@orbit/shared/activities";

export function createActivityDefinitionFingerprint(
  definition: ActivityDefinition
): string {
  const semantic = {
    activityId: definition.activityId,
    template: definition.template,
    title: definition.title,
    description: definition.description,
    questions: definition.questions.map(toSemanticQuestion),
    allowDisplayName: definition.allowDisplayName,
    hideResultsUntilReveal: definition.hideResultsUntilReveal
  };
  return createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
}

function toSemanticQuestion(question: ActivityQuestion) {
  switch (question.type) {
    case "rating":
      return {
        questionId: question.questionId,
        type: question.type,
        prompt: question.prompt,
        required: question.required,
        leftLabel: question.leftLabel,
        rightLabel: question.rightLabel
      };
    case "single-choice":
      return {
        questionId: question.questionId,
        type: question.type,
        prompt: question.prompt,
        required: question.required,
        options: question.options.map((option) => ({
          optionId: option.optionId,
          label: option.label
        }))
      };
    case "multiple-choice":
      return {
        questionId: question.questionId,
        type: question.type,
        prompt: question.prompt,
        required: question.required,
        options: question.options.map((option) => ({
          optionId: option.optionId,
          label: option.label
        })),
        maxSelections: question.maxSelections ?? null
      };
    case "free-text":
      return {
        questionId: question.questionId,
        type: question.type,
        prompt: question.prompt,
        required: question.required
      };
  }
}
