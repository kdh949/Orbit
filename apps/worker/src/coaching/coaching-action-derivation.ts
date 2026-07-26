import {
  coachingActionSchema,
  type CoachingAction,
  type CriterionResult,
  type EvaluationCriterion,
  type PracticeGoal,
  type ReportObservation,
} from "@orbit/shared/coaching";
import { createHash } from "node:crypto";

export function deriveCoachingActions(input: {
  projectId: string;
  sourceFullRunId: string;
  goals: PracticeGoal[];
  criteria: EvaluationCriterion[];
  criterionResults: CriterionResult[];
  observations: ReportObservation[];
  evaluatorLensId: "general-novice" | "decision-maker" | "strict-reviewer";
}): CoachingAction[] {
  const actions = [...input.goals]
    .sort((left, right) => left.priority - right.priority || left.goalId.localeCompare(right.goalId))
    .map((goal) => {
      const criterion = input.criteria.find(
        (candidate) =>
          sameCriterionRef(candidate, goal.criterionRef) &&
          targetMatchesCriterion(goal, candidate),
      );
      const result = input.criterionResults.find(
        (candidate) =>
          sameCriterionRef(candidate.criterionRef, goal.criterionRef) &&
          candidate.measurementState === "measured" &&
          (candidate.evaluationStatus === "partial" ||
            candidate.evaluationStatus === "failed"),
      );
      const observation = result?.observationId
        ? input.observations.find(
            (candidate) => candidate.observationId === result.observationId,
          )
        : null;
      if (
        !criterion ||
        !result ||
        !observation ||
        !sameCriterionRef(observation.criterionRef, goal.criterionRef) ||
        !sameJson(observation.scope, result.scope)
      ) {
        throw new Error("CoachingAction requires a matching measured problem observation.");
      }

      return coachingActionSchema.parse({
        actionId: `action_${hash([
          goal.goalId,
          observation.observationId,
          goal.priority,
        ]).slice(0, 32)}`,
        priority: goal.priority,
        criterionRef: goal.criterionRef,
        observationIds: [observation.observationId],
        label: goal.problemLabel.slice(0, 120),
        detail: `${observationFact(criterion, observation)} 연습 범위: ${scopeLabel(goal)}.`.slice(
          0,
          240,
        ),
        audienceImpact: audienceImpact(input.evaluatorLensId, criterion.category),
        instruction: goal.nextAction,
        successCondition: goal.successCondition,
        target: goal.targetScope
          ? {
              type: "focused-practice",
              projectId: input.projectId,
              goalId: goal.goalId,
              sourceFullRunId: input.sourceFullRunId,
            }
          : {
              type: "full-rehearsal",
              projectId: input.projectId,
              sourceGoalSetId: goal.goalSetId,
            },
        availability: "available",
        unavailableReason: null,
      });
    });

  return actions;
}

function observationFact(
  criterion: EvaluationCriterion,
  observation: ReportObservation,
) {
  if (observation.value.kind === "semantic") {
    if (observation.value.value === "partial") {
      return `${criterion.label}이 부분적으로만 전달됐습니다.`;
    }
    if (observation.value.value === "contradicted") {
      return `${criterion.label}이 반대 의미로 전달됐습니다.`;
    }
    return `${criterion.label}이 전달되지 않았습니다.`;
  }
  if (
    observation.value.kind === "duration-seconds" &&
    criterion.measurement.type === "max-duration-seconds"
  ) {
    return `관측 ${formatNumber(observation.value.value)}초로 허용 ${formatNumber(
      criterion.measurement.maximum,
    )}초를 초과했습니다.`;
  }
  if (
    observation.value.kind === "count" &&
    criterion.measurement.type === "max-count"
  ) {
    return `관측 ${observation.value.value}회로 허용 ${criterion.measurement.maximum}회를 초과했습니다.`;
  }
  throw new Error("CoachingAction observation value does not match its criterion.");
}

function audienceImpact(
  lensId: "general-novice" | "decision-maker" | "strict-reviewer",
  category: EvaluationCriterion["category"],
) {
  const categoryImpact = {
    structure: "발표의 흐름을 따라가기 어려워질 수 있습니다.",
    semantic: "핵심 판단 근거를 정확히 이해하기 어려워질 수 있습니다.",
    timing: "중요한 내용에 집중할 시간이 부족해질 수 있습니다.",
    delivery: "메시지의 명확성과 발표 신뢰도가 낮아질 수 있습니다.",
  }[category];
  if (lensId === "decision-maker") {
    return `의사결정자가 결론과 근거를 빠르게 판단하기 어렵습니다. ${categoryImpact}`;
  }
  if (lensId === "strict-reviewer") {
    return `검토자가 논리와 근거의 완결성을 확인하기 어렵습니다. ${categoryImpact}`;
  }
  return `처음 듣는 청중이 핵심 내용을 놓칠 수 있습니다. ${categoryImpact}`;
}

function scopeLabel(goal: PracticeGoal) {
  if (!goal.targetScope) return "전체 발표";
  if (goal.targetScope.type === "opening") return "도입";
  if (goal.targetScope.type === "closing") return "마무리";
  if (goal.targetScope.type === "slide") {
    return `슬라이드 ${goal.targetScope.slideId}`;
  }
  if (goal.targetScope.type === "sentence") {
    return `슬라이드 ${goal.targetScope.slideId}의 문장 ${goal.targetScope.sentenceIndex + 1}`;
  }
  return `슬라이드 ${goal.targetScope.startSlideId}부터 ${goal.targetScope.endSlideId}`;
}

function targetMatchesCriterion(
  goal: PracticeGoal,
  criterion: EvaluationCriterion,
) {
  if (!goal.targetScope) return criterion.scope.type === "run";
  if (goal.targetScope.type === "opening" || goal.targetScope.type === "closing") {
    return (
      criterion.scope.type === "time-window" &&
      criterion.scope.window === goal.targetScope.type
    );
  }
  if (goal.targetScope.type === "slide" || goal.targetScope.type === "sentence") {
    return (
      criterion.scope.type === "slide" &&
      criterion.scope.slideId === goal.targetScope.slideId
    );
  }
  return (
    criterion.scope.type === "slide-range" &&
    criterion.scope.startSlideId === goal.targetScope.startSlideId &&
    criterion.scope.endSlideId === goal.targetScope.endSlideId
  );
}

function sameCriterionRef(
  left: { criterionId: string; revision: number },
  right: { criterionId: string; revision: number },
) {
  return left.criterionId === right.criterionId && left.revision === right.revision;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
