import type {
  ActivityAnswer,
  ActivityDefinition,
  ActivityResponse,
} from "@orbit/shared/activities";

export type SatisfactionDraft = {
  displayName: string;
  freeText: Record<string, string>;
  multipleChoice: Record<string, string[]>;
  ratings: Record<string, number>;
  singleChoice: Record<string, string>;
};

export type SatisfactionDraftErrors = Record<string, string>;

export function createSatisfactionDraft(
  response: ActivityResponse | null
): SatisfactionDraft {
  const draft: SatisfactionDraft = {
    displayName: response?.displayName ?? "",
    freeText: {},
    multipleChoice: {},
    ratings: {},
    singleChoice: {}
  };
  response?.answers.forEach((answer) => {
    if (answer.type === "rating") draft.ratings[answer.questionId] = answer.value;
    if (answer.type === "free-text") draft.freeText[answer.questionId] = answer.text;
    if (answer.type === "single-choice") {
      draft.singleChoice[answer.questionId] = answer.optionId;
    }
    if (answer.type === "multiple-choice") {
      draft.multipleChoice[answer.questionId] = answer.optionIds;
    }
  });
  return draft;
}

export function validateSatisfactionDraft(
  definition: ActivityDefinition,
  draft: SatisfactionDraft
): SatisfactionDraftErrors {
  const errors: SatisfactionDraftErrors = {};
  definition.questions.forEach((question) => {
    if (question.type === "rating" && question.required && !draft.ratings[question.questionId]) {
      errors[question.questionId] = "평점을 선택해 주세요.";
    }
    if (
      question.type === "free-text" &&
      question.required &&
      !(draft.freeText[question.questionId] ?? "").trim()
    ) {
      errors[question.questionId] = "답변을 입력해 주세요.";
    }
    if (
      question.type === "single-choice" &&
      question.required &&
      !draft.singleChoice[question.questionId]
    ) {
      errors[question.questionId] = "선택지를 골라 주세요.";
    }
    if (
      question.type === "multiple-choice" &&
      question.required &&
      (draft.multipleChoice[question.questionId]?.length ?? 0) === 0
    ) {
      errors[question.questionId] = "하나 이상 골라 주세요.";
    }
    if (
      question.type === "multiple-choice" &&
      question.maxSelections !== undefined &&
      (draft.multipleChoice[question.questionId]?.length ?? 0) > question.maxSelections
    ) {
      errors[question.questionId] = `최대 ${question.maxSelections}개까지 선택할 수 있습니다.`;
    }
  });
  if (definition.allowDisplayName && draft.displayName.trim().length > 40) {
    errors.displayName = "이름은 40자 이하로 입력해 주세요.";
  }
  return errors;
}

export function buildSatisfactionAnswers(
  definition: ActivityDefinition,
  draft: SatisfactionDraft
): ActivityAnswer[] {
  const answers: ActivityAnswer[] = [];
  definition.questions.forEach((question) => {
    if (question.type === "rating") {
      const value = draft.ratings[question.questionId];
      if (value !== undefined) {
        answers.push({ questionId: question.questionId, type: "rating", value });
      }
    }
    if (question.type === "free-text") {
      const text = (draft.freeText[question.questionId] ?? "").trim();
      if (text) answers.push({ questionId: question.questionId, type: "free-text", text });
    }
    if (question.type === "single-choice") {
      const optionId = draft.singleChoice[question.questionId];
      if (optionId) {
        answers.push({ questionId: question.questionId, type: "single-choice", optionId });
      }
    }
    if (question.type === "multiple-choice") {
      const optionIds = draft.multipleChoice[question.questionId] ?? [];
      if (optionIds.length > 0) {
        answers.push({ questionId: question.questionId, type: "multiple-choice", optionIds });
      }
    }
  });
  return answers;
}

export function hasSatisfactionDraft(draft: SatisfactionDraft): boolean {
  return (
    draft.displayName.trim().length > 0 ||
    Object.keys(draft.ratings).length > 0 ||
    Object.keys(draft.singleChoice).length > 0 ||
    Object.values(draft.multipleChoice).some((value) => value.length > 0) ||
    Object.values(draft.freeText).some((value) => value.trim().length > 0)
  );
}
