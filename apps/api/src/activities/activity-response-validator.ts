import type {
  ActivityAnswer,
  ActivityDefinition,
  UpsertActivityResponseRequest,
} from "@orbit/shared/activities";

export class ActivityResponseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityResponseValidationError";
  }
}

export function validateActivityResponseInput(
  definition: ActivityDefinition,
  input: UpsertActivityResponseRequest
): { answers: ActivityAnswer[]; displayName: string | null } {
  const questions = new Map(
    definition.questions.map((question) => [question.questionId, question])
  );
  const answers = new Map<string, ActivityAnswer>();

  input.answers.forEach((answer) => {
    if (answers.has(answer.questionId)) {
      throw new ActivityResponseValidationError("A question can be answered only once");
    }
    const question = questions.get(answer.questionId);
    if (!question || question.type !== answer.type) {
      throw new ActivityResponseValidationError("Answer does not match the run snapshot");
    }
    if (answer.type === "single-choice") {
      if (question.type !== "single-choice") {
        throw new ActivityResponseValidationError("Answer does not match the run snapshot");
      }
      if (!question.options.some((option) => option.optionId === answer.optionId)) {
        throw new ActivityResponseValidationError("Unknown choice option");
      }
    }
    if (answer.type === "multiple-choice") {
      if (question.type !== "multiple-choice") {
        throw new ActivityResponseValidationError("Answer does not match the run snapshot");
      }
      const optionIds = new Set(question.options.map((option) => option.optionId));
      if (answer.optionIds.some((optionId) => !optionIds.has(optionId))) {
        throw new ActivityResponseValidationError("Unknown choice option");
      }
      if (
        question.maxSelections !== undefined &&
        answer.optionIds.length > question.maxSelections
      ) {
        throw new ActivityResponseValidationError("Too many options selected");
      }
    }
    answers.set(answer.questionId, answer);
  });

  for (const question of definition.questions) {
    if (question.required && !answers.has(question.questionId)) {
      throw new ActivityResponseValidationError("A required question is missing");
    }
  }

  const displayName = input.displayName ?? null;
  if (!definition.allowDisplayName && displayName !== null) {
    throw new ActivityResponseValidationError("Display name is not allowed");
  }
  return { answers: [...answers.values()], displayName };
}
