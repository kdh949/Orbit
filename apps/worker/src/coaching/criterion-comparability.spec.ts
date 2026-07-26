import {
  rehearsalEvaluationPlanSchema,
  type EvaluationCriterion,
} from "@orbit/shared/coaching";
import { deckSchema } from "@orbit/shared/deck";
import {
  createRehearsalEvaluationSnapshot,
  type RehearsalEvaluationSnapshot,
} from "@orbit/shared/rehearsals";
import { describe, expect, it } from "vitest";

import { compareCriterionSources } from "./criterion-comparability";

describe("compareCriterionSources", () => {
  it("accepts the same frozen source identities and metric definition", () => {
    const criterion = timingCriterion();
    const snapshot = evaluationSnapshot(criterion);

    expect(
      compareCriterionSources({
        currentSnapshot: snapshot,
        currentCriterion: criterion,
        previousSnapshot: snapshot,
        previousCriterion: criterion,
      }),
    ).toEqual({ comparable: true, reasonCode: null });
  });

  it("rejects a missing or changed Deck hash", () => {
    const criterion = timingCriterion();
    const current = evaluationSnapshot(criterion);

    expect(
      compareCriterionSources({
        currentSnapshot: { ...current, deckContentHash: null },
        currentCriterion: criterion,
        previousSnapshot: current,
        previousCriterion: criterion,
      }),
    ).toEqual({ comparable: false, reasonCode: null });
    expect(
      compareCriterionSources({
        currentSnapshot: current,
        currentCriterion: criterion,
        previousSnapshot: { ...current, deckContentHash: "b".repeat(64) },
        previousCriterion: criterion,
      }),
    ).toEqual({ comparable: false, reasonCode: "DECK_CHANGED" });
  });

  it("rejects changed Brief, Lens, Criterion, and scope identities", () => {
    const criterion = timingCriterion();
    const snapshot = evaluationSnapshot(criterion);
    const changedBrief = withPlan(snapshot, {
      briefRef: { mode: "briefed", briefId: "brief_1", revision: 2 },
    });
    const changedLens = withPlan(snapshot, {
      evaluatorLensRef: { lensId: "strict-reviewer", revision: 1 },
    });
    const changedCriterion = { ...criterion, revision: 2 };
    const changedScope = {
      ...criterion,
      scope: { type: "slide" as const, slideId: "slide_2" },
    };

    expect(result(snapshot, criterion, changedBrief, criterion)).toEqual({
      comparable: false,
      reasonCode: "BRIEF_CHANGED",
    });
    expect(result(snapshot, criterion, changedLens, criterion)).toEqual({
      comparable: false,
      reasonCode: null,
    });
    expect(result(snapshot, criterion, snapshot, changedCriterion)).toEqual({
      comparable: false,
      reasonCode: "CRITERION_CHANGED",
    });
    expect(result(snapshot, criterion, snapshot, changedScope)).toEqual({
      comparable: false,
      reasonCode: "SCOPE_CHANGED",
    });
  });

  it("rejects a criterion that is not materialized in its evaluation plan", () => {
    const criterion = timingCriterion();
    const snapshot = evaluationSnapshot(criterion);
    const planWithoutCriterion = withPlan(snapshot, { criteria: [] });

    expect(
      result(snapshot, criterion, planWithoutCriterion, criterion),
    ).toEqual({
      comparable: false,
      reasonCode: "CRITERION_CHANGED",
    });
  });

  it("compares long silence criteria with the silence metric version", () => {
    const criterion = longSilenceCriterion();
    const snapshot = evaluationSnapshot(criterion);

    expect(result(snapshot, criterion, snapshot, criterion)).toEqual({
      comparable: true,
      reasonCode: null,
    });
  });
});

function result(
  currentSnapshot: RehearsalEvaluationSnapshot,
  currentCriterion: EvaluationCriterion,
  previousSnapshot: RehearsalEvaluationSnapshot,
  previousCriterion: EvaluationCriterion,
) {
  return compareCriterionSources({
    currentSnapshot,
    currentCriterion,
    previousSnapshot,
    previousCriterion,
  });
}

function evaluationSnapshot(
  criterion: EvaluationCriterion,
): RehearsalEvaluationSnapshot {
  const deck = deckSchema.parse({
    deckId: "deck_1",
    projectId: "project_1",
    title: "테스트 덱",
    version: 1,
    targetDurationMinutes: 10,
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "도입",
        elements: [],
        keywords: [],
        semanticCues: [],
      },
    ],
  });
  const evaluationPlan = rehearsalEvaluationPlanSchema.parse({
    planVersion: 1,
    briefRef: { mode: "generic" },
    evaluatorLensRef: { lensId: "general-novice", revision: 1 },
    targetDurationSeconds: 600,
    criteria: [criterion],
    metricDefinitionVersions: {
      timing: 1,
      filler: 1,
      silence: 1,
      semantic: 1,
    },
    approvedReferences: [],
    practiceGoalSetRef: null,
  });
  return createRehearsalEvaluationSnapshot(deck, "2026-07-13T00:00:00.000Z", {
    deckContentHash: "a".repeat(64),
    evaluationPlan,
  });
}

function timingCriterion(): EvaluationCriterion {
  return {
    criterionId: "criterion_timing_1",
    revision: 1,
    category: "timing",
    source: "system",
    scope: { type: "slide", slideId: "slide_1" },
    label: "도입 목표 시간",
    measurement: { type: "max-duration-seconds", maximum: 12 },
  };
}

function longSilenceCriterion(): EvaluationCriterion {
  return {
    criterionId: "criterion_silence_1",
    revision: 1,
    category: "delivery",
    source: "system",
    scope: { type: "run" },
    label: "긴 침묵 없이 발표",
    measurement: {
      type: "max-count",
      metric: "long-silence-count",
      maximum: 0,
    },
  };
}

function withPlan(
  snapshot: RehearsalEvaluationSnapshot,
  patch: Partial<NonNullable<RehearsalEvaluationSnapshot["evaluationPlan"]>>,
): RehearsalEvaluationSnapshot {
  if (!snapshot.evaluationPlan)
    throw new Error("evaluation plan fixture is missing");
  return {
    ...snapshot,
    evaluationPlan: rehearsalEvaluationPlanSchema.parse({
      ...snapshot.evaluationPlan,
      ...patch,
    }),
  };
}
