import type {
  EvaluationCriterion,
  PracticeGoalResolution,
} from "@orbit/shared/coaching";
import type { RehearsalEvaluationSnapshot } from "@orbit/shared/rehearsals";

type StoredIncomparabilityReason = Extract<
  PracticeGoalResolution["reasonCode"],
  "DECK_CHANGED" | "BRIEF_CHANGED" | "CRITERION_CHANGED" | "SCOPE_CHANGED"
>;

export type CriterionComparabilityResult =
  | { comparable: true; reasonCode: null }
  | { comparable: false; reasonCode: StoredIncomparabilityReason | null };

export function compareCriterionSources(input: {
  currentSnapshot: RehearsalEvaluationSnapshot;
  currentCriterion: EvaluationCriterion;
  previousSnapshot: RehearsalEvaluationSnapshot;
  previousCriterion: EvaluationCriterion;
}): CriterionComparabilityResult {
  const currentPlan = input.currentSnapshot.evaluationPlan;
  const previousPlan = input.previousSnapshot.evaluationPlan;
  if (!currentPlan || !previousPlan) return incomparable(null);

  const currentDeckHash = input.currentSnapshot.deckContentHash;
  const previousDeckHash = input.previousSnapshot.deckContentHash;
  if (!currentDeckHash || !previousDeckHash) return incomparable(null);
  if (currentDeckHash !== previousDeckHash) return incomparable("DECK_CHANGED");

  if (!sameJson(currentPlan.briefRef, previousPlan.briefRef)) {
    return incomparable("BRIEF_CHANGED");
  }

  if (!sameJson(currentPlan.evaluatorLensRef, previousPlan.evaluatorLensRef)) {
    return incomparable(null);
  }

  if (
    input.currentCriterion.criterionId !==
      input.previousCriterion.criterionId ||
    input.currentCriterion.revision !== input.previousCriterion.revision
  ) {
    return incomparable("CRITERION_CHANGED");
  }

  if (!sameJson(input.currentCriterion.scope, input.previousCriterion.scope)) {
    return incomparable("SCOPE_CHANGED");
  }

  if (
    !planContainsCriterion(currentPlan.criteria, input.currentCriterion) ||
    !planContainsCriterion(previousPlan.criteria, input.previousCriterion)
  ) {
    return incomparable("CRITERION_CHANGED");
  }

  const currentMetricVersion = metricDefinitionVersion(
    currentPlan.metricDefinitionVersions,
    input.currentCriterion,
  );
  const previousMetricVersion = metricDefinitionVersion(
    previousPlan.metricDefinitionVersions,
    input.previousCriterion,
  );
  if (
    currentMetricVersion === null ||
    previousMetricVersion === null ||
    currentMetricVersion !== previousMetricVersion
  ) {
    return incomparable(null);
  }

  return { comparable: true, reasonCode: null };
}

function metricDefinitionVersion(
  versions: NonNullable<
    RehearsalEvaluationSnapshot["evaluationPlan"]
  >["metricDefinitionVersions"],
  criterion: EvaluationCriterion,
) {
  if (criterion.measurement.type === "semantic-coverage") {
    return versions.semantic;
  }
  if (criterion.measurement.type === "max-duration-seconds") {
    return versions.timing;
  }
  if (criterion.measurement.type === "max-count") {
    return criterion.measurement.metric === "filler-word-count"
      ? versions.filler
      : versions.silence;
  }
  return null;
}

function planContainsCriterion(
  criteria: EvaluationCriterion[],
  criterion: EvaluationCriterion,
) {
  return criteria.some(
    (candidate) =>
      candidate.criterionId === criterion.criterionId &&
      candidate.revision === criterion.revision &&
      sameJson(candidate.scope, criterion.scope) &&
      sameJson(candidate.measurement, criterion.measurement),
  );
}

function incomparable(
  reasonCode: StoredIncomparabilityReason | null,
): CriterionComparabilityResult {
  return { comparable: false, reasonCode };
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
