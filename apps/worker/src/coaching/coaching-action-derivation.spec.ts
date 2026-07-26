import {
  criterionResultSchema,
  evaluationCriterionSchema,
  practiceGoalSchema,
  reportObservationSchema,
} from "@orbit/shared/coaching";
import { describe, expect, it } from "vitest";

import { deriveCoachingActions } from "./coaching-action-derivation";

describe("deriveCoachingActions", () => {
  it("creates an evidence-linked focused-practice action", () => {
    const fixture = focusedFixture();
    const actions = deriveCoachingActions({
      projectId: "project_1",
      sourceFullRunId: "run_1",
      goals: [fixture.goal],
      criteria: [fixture.criterion],
      criterionResults: [fixture.result],
      observations: [fixture.observation],
      evaluatorLensId: "decision-maker",
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      priority: 1,
      observationIds: ["observation_semantic_1"],
      target: {
        type: "focused-practice",
        projectId: "project_1",
        goalId: "goal_1",
        sourceFullRunId: "run_1",
      },
      availability: "available",
      unavailableReason: null,
    });
    expect(actions[0]?.detail).toContain("연습 범위");
    expect(actions[0]?.audienceImpact).toContain("의사결정자");
    expect(actions[0]?.criterionRef).toEqual(fixture.goal.criterionRef);
    expect(actions[0]?.instruction).toBe(fixture.goal.nextAction);
    expect(actions[0]?.successCondition).toBe(fixture.goal.successCondition);
  });

  it("uses a full-rehearsal target for a run-level problem", () => {
    const criterion = evaluationCriterionSchema.parse({
      criterionId: "criterion_filler_1",
      revision: 1,
      category: "delivery",
      source: "system",
      scope: { type: "run" },
      label: "반복 말버릇",
      measurement: {
        type: "max-count",
        metric: "filler-word-count",
        maximum: 1,
      },
    });
    const observation = reportObservationSchema.parse({
      observationId: "observation_filler_1",
      criterionRef: { criterionId: criterion.criterionId, revision: 1 },
      scope: criterion.scope,
      measurementState: "measured",
      value: { kind: "count", metric: "filler-word-count", value: 2 },
      evidenceRefs: [],
      observedAt: "2026-07-13T00:00:00.000Z",
    });
    const result = criterionResultSchema.parse({
      criterionRef: observation.criterionRef,
      category: criterion.category,
      scope: criterion.scope,
      measurementState: "measured",
      evaluationStatus: "failed",
      observationId: observation.observationId,
      reasonCode: "THRESHOLD_EXCEEDED",
      evaluatedAt: "2026-07-13T00:00:00.000Z",
    });
    const goal = practiceGoalSchema.parse({
      goalId: "goal_2",
      goalSetId: "goal_set_1",
      projectId: "project_1",
      originFullRunId: "run_1",
      priority: 2,
      patternKey: "b".repeat(64),
      category: "delivery",
      criterionRef: observation.criterionRef,
      targetScope: null,
      recommendedPracticeMode: "full-run-only",
      evidenceRefs: [
        { kind: "delivery-count", metric: "filler-word-count", count: 2 },
      ],
      problemLabel: "반복 말버릇 2회가 감지됐습니다.",
      nextAction: "추임새를 빼고 다시 말하세요.",
      successCondition: "반복 말버릇을 1회 이하로 유지합니다.",
      measurementState: "measured",
      createdAt: "2026-07-13T00:00:00.000Z",
    });

    const [action] = deriveCoachingActions({
      projectId: "project_1",
      sourceFullRunId: "run_1",
      goals: [goal],
      criteria: [criterion],
      criterionResults: [result],
      observations: [observation],
      evaluatorLensId: "general-novice",
    });

    expect(action?.target).toEqual({
      type: "full-rehearsal",
      projectId: "project_1",
      sourceGoalSetId: "goal_set_1",
    });
  });

  it.each([
    {
      name: "sentence",
      targetScope: {
        type: "sentence",
        scopeId: "scope_sentence",
        slideId: "slide_1",
        sentenceIndex: 0,
        textSnapshotHash: "a".repeat(64),
      },
      criterionScope: { type: "slide", slideId: "slide_1" },
    },
    {
      name: "slide",
      targetScope: { type: "slide", scopeId: "scope_slide", slideId: "slide_1" },
      criterionScope: { type: "slide", slideId: "slide_1" },
    },
    {
      name: "slide-range",
      targetScope: {
        type: "slide-range",
        scopeId: "scope_range",
        startSlideId: "slide_1",
        endSlideId: "slide_3",
      },
      criterionScope: {
        type: "slide-range",
        startSlideId: "slide_1",
        endSlideId: "slide_3",
      },
    },
    {
      name: "opening",
      targetScope: { type: "opening", scopeId: "scope_opening" },
      criterionScope: { type: "time-window", window: "opening" },
    },
    {
      name: "closing",
      targetScope: { type: "closing", scopeId: "scope_closing" },
      criterionScope: { type: "time-window", window: "closing" },
    },
  ])("preserves $name target identity in a focused action", ({ targetScope, criterionScope }) => {
    const fixture = targetFixture(targetScope, criterionScope);
    const [action] = deriveCoachingActions({
      projectId: "project_1",
      sourceFullRunId: "run_1",
      goals: [fixture.goal],
      criteria: [fixture.criterion],
      criterionResults: [fixture.result],
      observations: [fixture.observation],
      evaluatorLensId: "general-novice",
    });

    expect(action).toMatchObject({
      criterionRef: fixture.goal.criterionRef,
      observationIds: [fixture.observation.observationId],
      instruction: fixture.goal.nextAction,
      successCondition: fixture.goal.successCondition,
      target: {
        type: "focused-practice",
        goalId: fixture.goal.goalId,
        sourceFullRunId: fixture.goal.originFullRunId,
      },
    });
  });

  it("returns empty top actions when there are no problem goals", () => {
    expect(deriveCoachingActions({
      projectId: "project_1",
      sourceFullRunId: "run_1",
      goals: [],
      criteria: [],
      criterionResults: [],
      observations: [],
      evaluatorLensId: "general-novice",
    })).toEqual([]);
  });

  it("rejects a dangling Observation and never emits private evidence fields", () => {
    const fixture = focusedFixture();
    expect(() =>
      deriveCoachingActions({
        projectId: "project_1",
        sourceFullRunId: "run_1",
        goals: [fixture.goal],
        criteria: [fixture.criterion],
        criterionResults: [fixture.result],
        observations: [],
        evaluatorLensId: "strict-reviewer",
      }),
    ).toThrow("CoachingAction requires a matching measured problem observation.");

    const serialized = JSON.stringify(
      deriveCoachingActions({
        projectId: "project_1",
        sourceFullRunId: "run_1",
        goals: [fixture.goal],
        criteria: [fixture.criterion],
        criterionResults: [fixture.result],
        observations: [fixture.observation],
        evaluatorLensId: "strict-reviewer",
      }),
    );
    expect(serialized).not.toContain("transcript");
    expect(serialized).not.toContain("signedUrl");
    expect(serialized).not.toContain("audio");
  });
});

function focusedFixture() {
  const criterion = evaluationCriterionSchema.parse({
    criterionId: "criterion_semantic_1",
    revision: 1,
    category: "semantic",
    source: "brief",
    scope: { type: "slide", slideId: "slide_1" },
    label: "핵심 수치",
    measurement: {
      type: "semantic-coverage",
      expectedConceptIds: ["concept_1"],
    },
  });
  const observation = reportObservationSchema.parse({
    observationId: "observation_semantic_1",
    criterionRef: { criterionId: criterion.criterionId, revision: 1 },
    scope: criterion.scope,
    measurementState: "measured",
    value: { kind: "semantic", value: "partial" },
    evidenceRefs: [
      {
        kind: "time-range",
        slideId: "slide_1",
        startMs: 1_000,
        endMs: 2_000,
      },
    ],
    observedAt: "2026-07-13T00:00:00.000Z",
  });
  const result = criterionResultSchema.parse({
    criterionRef: observation.criterionRef,
    category: criterion.category,
    scope: criterion.scope,
    measurementState: "measured",
    evaluationStatus: "partial",
    observationId: observation.observationId,
    reasonCode: "PARTIAL",
    evaluatedAt: "2026-07-13T00:00:00.000Z",
  });
  const goal = practiceGoalSchema.parse({
    goalId: "goal_1",
    goalSetId: "goal_set_1",
    projectId: "project_1",
    originFullRunId: "run_1",
    priority: 1,
    patternKey: "a".repeat(64),
    category: "semantic",
    criterionRef: observation.criterionRef,
    targetScope: { type: "slide", scopeId: "scope_1", slideId: "slide_1" },
    recommendedPracticeMode: "focused",
    evidenceRefs: [],
    problemLabel: "핵심 수치가 부분적으로만 전달됐습니다.",
    nextAction: "핵심 수치를 먼저 한 문장으로 말하세요.",
    successCondition: "핵심 수치의 필수 내용을 모두 전달합니다.",
    measurementState: "measured",
    createdAt: "2026-07-13T00:00:00.000Z",
  });
  return { criterion, observation, result, goal };
}

function targetFixture(targetScope: unknown, criterionScope: unknown) {
  const isStructure =
    typeof targetScope === "object" &&
    targetScope !== null &&
    ["opening", "closing"].includes(String((targetScope as { type?: unknown }).type));
  const criterion = evaluationCriterionSchema.parse({
    criterionId: `criterion_${isStructure ? "structure" : "semantic"}_target`,
    revision: 1,
    category: isStructure ? "structure" : "semantic",
    source: "brief",
    scope: criterionScope,
    label: isStructure ? "발표 역할" : "핵심 내용",
    measurement: {
      type: "semantic-coverage",
      expectedConceptIds: ["concept_target"],
    },
  });
  const observation = reportObservationSchema.parse({
    observationId: `observation_${String((targetScope as { type: string }).type)}`,
    criterionRef: { criterionId: criterion.criterionId, revision: criterion.revision },
    scope: criterion.scope,
    measurementState: "measured",
    value: { kind: "semantic", value: "partial" },
    evidenceRefs: [],
    observedAt: "2026-07-14T00:00:00.000Z",
  });
  const result = criterionResultSchema.parse({
    criterionRef: observation.criterionRef,
    category: criterion.category,
    scope: criterion.scope,
    measurementState: "measured",
    evaluationStatus: "partial",
    observationId: observation.observationId,
    reasonCode: "PARTIAL",
    evaluatedAt: observation.observedAt,
  });
  const goal = practiceGoalSchema.parse({
    goalId: `goal_${String((targetScope as { type: string }).type)}`,
    goalSetId: "goal_set_1",
    projectId: "project_1",
    originFullRunId: "run_1",
    priority: 1,
    patternKey: "c".repeat(64),
    category: criterion.category,
    criterionRef: observation.criterionRef,
    targetScope,
    recommendedPracticeMode: "focused",
    evidenceRefs: [],
    problemLabel: "연습할 문제가 발견됐습니다.",
    nextAction: "해당 범위를 다시 연습하세요.",
    successCondition: "필수 내용을 모두 전달합니다.",
    measurementState: "measured",
    createdAt: "2026-07-14T00:00:00.000Z",
  });
  return { criterion, observation, result, goal };
}
