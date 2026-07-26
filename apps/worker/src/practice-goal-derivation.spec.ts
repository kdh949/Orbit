import {
  criterionResultSchema,
  evaluationCriterionSchema,
  rehearsalFocusProfileSnapshotSchema,
  reportObservationSchema,
  type EvaluationCriterion,
} from "@orbit/shared/coaching";
import {
  rehearsalEvaluationSnapshotSchema,
  rehearsalReportSchema,
  type RehearsalEvaluationSnapshot,
  type RehearsalReport,
} from "@orbit/shared/rehearsals";
import { describe, expect, it, vi } from "vitest";

import {
  derivePracticeGoalSet,
  deriveProblemCandidates,
  evaluateFullRunCriteria,
  loadPracticeGoalRankingContext,
  persistPracticeGoalSet,
  persistSourceGoalResolutions,
  type PracticeGoalRankingContext,
} from "./practice-goal-derivation";

describe("practice goal derivation", () => {
  it("selects a deterministic lens-ordered Top 3 and creates a new immutable revision", () => {
    const first = derivePracticeGoalSet({
      projectId: "project-a",
      sourceFullRunId: "run-a",
      sourceAnalysisRevision: 1,
      snapshot: snapshot(),
      report: report(true),
    });
    const repeated = derivePracticeGoalSet({
      projectId: "project-a",
      sourceFullRunId: "run-a",
      sourceAnalysisRevision: 1,
      snapshot: snapshot(),
      report: report(true),
    });
    const recovered = derivePracticeGoalSet({
      projectId: "project-a",
      sourceFullRunId: "run-a",
      sourceAnalysisRevision: 2,
      snapshot: snapshot(),
      report: report(false),
    });

    expect(first).toEqual(repeated);
    expect(first?.analysisState).toBe("partial");
    expect(first?.goals).toHaveLength(3);
    expect(first?.goals.map((goal) => goal.category)).toEqual([
      "semantic",
      "timing",
      "delivery",
    ]);
    expect(first?.goals.map((goal) => goal.priority)).toEqual([1, 2, 3]);
    expect(recovered?.analysisState).toBe("final");
    expect(recovered?.revision).toBe(2);
    expect(recovered?.goalSetId).not.toBe(first?.goalSetId);
  });

  it("keeps retryable unavailable semantic evaluation partial", () => {
    const unavailableReport = report(false);
    unavailableReport.semanticEvaluation = {
      state: "unavailable",
      measurementMode: "none",
      reasons: ["provider_unavailable"],
      retryable: true
    };

    const set = derivePracticeGoalSet({
      projectId: "project-a",
      sourceFullRunId: "run-a",
      sourceAnalysisRevision: 1,
      snapshot: snapshot(),
      report: unavailableReport
    });

    expect(set?.analysisState).toBe("partial");
  });

  it("keeps the goal set empty when the report has no failing candidates", () => {
    const set = derivePracticeGoalSet({
      projectId: "project-a",
      sourceFullRunId: "run-a",
      sourceAnalysisRevision: 1,
      snapshot: snapshot(),
      report: passingReport(),
    });

    expect(set?.analysisState).toBe("final");
    expect(set?.goals).toEqual([]);
  });

  it("keeps Brief must-cover, opening, and closing unmeasured without observations", () => {
    const sourceSnapshot = snapshotWithBriefCriteria();
    const sourceReport = report(false);
    const briefCriterionIds = new Set([
      "criterion_brief_must_cover",
      "criterion_brief_opening",
      "criterion_brief_closing",
    ]);

    const evaluation = evaluateFullRunCriteria({
      sourceFullRunId: "run-a",
      snapshot: sourceSnapshot,
      report: sourceReport,
    });
    const set = derivePracticeGoalSet({
      projectId: "project-a",
      sourceFullRunId: "run-a",
      sourceAnalysisRevision: 1,
      snapshot: sourceSnapshot,
      report: sourceReport,
    });

    expect(
      evaluation.results.filter((result) =>
        briefCriterionIds.has(result.criterionRef.criterionId),
      ),
    ).toEqual([
      expect.objectContaining({
        criterionRef: {
          criterionId: "criterion_brief_must_cover",
          revision: 1,
        },
        measurementState: "unmeasured",
        evaluationStatus: "not-evaluated",
        observationId: null,
        reasonCode: "NO_MEASUREMENT",
      }),
      expect.objectContaining({
        criterionRef: { criterionId: "criterion_brief_opening", revision: 1 },
        measurementState: "unmeasured",
        evaluationStatus: "not-evaluated",
        observationId: null,
        reasonCode: "NO_MEASUREMENT",
      }),
      expect.objectContaining({
        criterionRef: { criterionId: "criterion_brief_closing", revision: 1 },
        measurementState: "unmeasured",
        evaluationStatus: "not-evaluated",
        observationId: null,
        reasonCode: "NO_MEASUREMENT",
      }),
    ]);
    expect(
      evaluation.observations.some((observation) =>
        briefCriterionIds.has(observation.criterionRef.criterionId),
      ),
    ).toBe(false);
    expect(
      set?.goals.some((goal) =>
        briefCriterionIds.has(goal.criterionRef.criterionId),
      ),
    ).toBe(false);
  });

  it("keeps core semantic ahead of focused delivery and excludes passed focus items", () => {
    const focusedSnapshot = rehearsalEvaluationSnapshotSchema.parse({
      ...snapshot(),
      focusProfileSnapshot: {
        profileRef: { profileId: "profile_1", revision: 2 },
        items: [
          {
            focusItemId: "focus_filler",
            priority: 1,
            kind: "filler-words",
            label: "반복 말버릇 줄이기",
            targetScope: null,
          },
          {
            focusItemId: "focus_passing_pause",
            priority: 2,
            kind: "silences",
            label: "긴 침묵 줄이기",
            targetScope: null,
          },
        ],
      },
    });
    const set = derivePracticeGoalSet({
      projectId: "project-a",
      sourceFullRunId: "run-a",
      sourceAnalysisRevision: 1,
      snapshot: focusedSnapshot,
      report: report(false),
    });

    expect(set?.goals.map((goal) => goal.criterionRef.criterionId)).toEqual([
      "criterion_cue_scue_1_r1",
      "criterion_timing_slide_1",
      "criterion_system_filler_v1",
    ]);
    expect(
      set?.goals.some(
        (goal) => goal.criterionRef.criterionId === "criterion_system_pause_v1",
      ),
    ).toBe(false);
  });

  it("creates deterministic run-bound scope IDs and preserves a frozen sentence target", () => {
    const criterion = {
      criterionId: "criterion_semantic_slide_1",
      revision: 1,
      category: "semantic",
      source: "brief",
      scope: { type: "slide", slideId: "slide_1" },
      label: "핵심 수치",
      measurement: {
        type: "semantic-coverage",
        expectedConceptIds: ["concept_1"],
      },
    };
    const first = syntheticCandidate({
      sourceFullRunId: "run-a",
      criterion,
      value: { kind: "semantic", value: "missed" },
    });
    const repeated = syntheticCandidate({
      sourceFullRunId: "run-a",
      criterion,
      value: { kind: "semantic", value: "missed" },
    });
    const anotherRun = syntheticCandidate({
      sourceFullRunId: "run-b",
      criterion,
      value: { kind: "semantic", value: "missed" },
    });
    const anotherTarget = syntheticCandidate({
      sourceFullRunId: "run-a",
      criterion: {
        ...criterion,
        scope: { type: "slide", slideId: "slide_2" },
      },
      value: { kind: "semantic", value: "missed" },
      slideOrder: [
        ["slide_1", 1],
        ["slide_2", 2],
      ],
    });
    const frozenSentenceTarget = {
      type: "sentence",
      scopeId: "scope_frozen_sentence",
      slideId: "slide_1",
      sentenceIndex: 0,
      textSnapshotHash: "a".repeat(64),
    } as const;
    const focused = syntheticCandidate({
      sourceFullRunId: "run-a",
      criterion,
      value: { kind: "semantic", value: "missed" },
      focusTarget: frozenSentenceTarget,
    });

    expect(first.targetScope?.scopeId).toBe(repeated.targetScope?.scopeId);
    expect(first.targetScope?.scopeId).not.toBe(
      anotherRun.targetScope?.scopeId,
    );
    expect(first.targetScope?.scopeId).not.toBe(
      anotherTarget.targetScope?.scopeId,
    );
    expect(focused.targetScope).toEqual(frozenSentenceTarget);
  });

  it.each([
    {
      name: "semantic",
      criterion: {
        criterionId: "criterion_semantic",
        revision: 1,
        category: "semantic",
        source: "brief",
        scope: { type: "slide", slideId: "slide_1" },
        label: "핵심 수치",
        measurement: {
          type: "semantic-coverage",
          expectedConceptIds: ["concept_1"],
        },
      },
      value: { kind: "semantic", value: "missed" },
      expected: "핵심 수치의 필수 내용을 모두 전달합니다.",
    },
    {
      name: "filler",
      criterion: {
        criterionId: "criterion_filler",
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
      },
      value: { kind: "count", metric: "filler-word-count", value: 2 },
      expected: "반복 말버릇을 1회 이하로 유지합니다.",
    },
    {
      name: "silence",
      criterion: {
        criterionId: "criterion_silence",
        revision: 1,
        category: "delivery",
        source: "system",
        scope: { type: "run" },
        label: "긴 침묵",
        measurement: {
          type: "max-count",
          metric: "long-silence-count",
          maximum: 0,
        },
      },
      value: { kind: "count", metric: "long-silence-count", value: 1 },
      expected: "긴 침묵을 0회 이하로 유지합니다.",
    },
    {
      name: "opening",
      criterion: {
        criterionId: "criterion_opening",
        revision: 1,
        category: "structure",
        source: "brief",
        scope: { type: "time-window", window: "opening" },
        label: "발표 목적",
        measurement: {
          type: "semantic-coverage",
          expectedConceptIds: ["concept_opening"],
        },
      },
      value: { kind: "semantic", value: "partial" },
      expected: "도입부에서 발표 목적을 명확히 전달합니다.",
    },
    {
      name: "closing",
      criterion: {
        criterionId: "criterion_closing",
        revision: 1,
        category: "structure",
        source: "brief",
        scope: { type: "time-window", window: "closing" },
        label: "다음 행동",
        measurement: {
          type: "semantic-coverage",
          expectedConceptIds: ["concept_closing"],
        },
      },
      value: { kind: "semantic", value: "missed" },
      expected: "마무리에서 다음 행동을 명확히 전달합니다.",
    },
  ])(
    "uses the contract success condition for $name",
    ({ criterion, value, expected }) => {
      expect(syntheticCandidate({ criterion, value }).successCondition).toBe(
        expected,
      );
    },
  );

  it("keeps invalid slide ranges as full-run-only problems", () => {
    const criterion = {
      criterionId: "criterion_range",
      revision: 1,
      category: "semantic",
      source: "brief",
      scope: {
        type: "slide-range",
        startSlideId: "slide_1",
        endSlideId: "slide_3",
      },
      label: "문제와 해결 흐름",
      measurement: {
        type: "semantic-coverage",
        expectedConceptIds: ["concept_range"],
      },
    };
    const value = { kind: "semantic", value: "missed" };
    const valid = syntheticCandidate({
      criterion,
      value,
      slideOrder: [
        ["slide_1", 1],
        ["slide_2", 2],
        ["slide_3", 3],
      ],
    });
    const reversed = syntheticCandidate({
      criterion,
      value,
      slideOrder: [
        ["slide_1", 3],
        ["slide_2", 2],
        ["slide_3", 1],
      ],
    });
    const missing = syntheticCandidate({
      criterion,
      value,
      slideOrder: [
        ["slide_1", 1],
        ["slide_2", 2],
      ],
    });

    expect(valid.targetScope).toMatchObject({
      type: "slide-range",
      startSlideId: "slide_1",
      endSlideId: "slide_3",
    });
    expect(reversed.targetScope).toBeNull();
    expect(missing.targetScope).toBeNull();
  });

  it("orders rerun issues by repeated core, new core, repeated timing, then repeated delivery", async () => {
    const sourceSnapshot = twoCoreSnapshot();
    const currentReport = twoCoreReport("missed");
    const previousReport = twoCoreReport("covered");
    const query = vi.fn(async () => [
      historyRow(
        "run-previous",
        "2026-07-10T00:00:00.000Z",
        previousReport,
        sourceSnapshot,
      ),
    ]);
    const rankingContext = await loadPracticeGoalRankingContext({
      executor: { query } as never,
      projectId: "project-a",
      sourceFullRunId: "run-current",
      snapshot: sourceSnapshot,
    });

    const candidates = candidatesFor(
      "run-current",
      sourceSnapshot,
      currentReport,
      rankingContext,
    );

    expect(
      candidates.map((candidate) => candidate.criterion.criterionId),
    ).toEqual([
      "criterion_cue_scue_1_r1",
      "criterion_cue_scue_2_r1",
      "criterion_timing_slide_1",
      "criterion_system_filler_v1",
    ]);
    expect(candidates.map((candidate) => candidate.repeated)).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it("uses only the latest compatible run before three total runs", async () => {
    const sourceSnapshot = snapshot();
    const query = vi.fn(async () => [
      historyRow(
        "run-previous",
        "2026-07-10T00:00:00.000Z",
        passingReport(),
        sourceSnapshot,
      ),
    ]);
    const rankingContext = await loadPracticeGoalRankingContext({
      executor: { query } as never,
      projectId: "project-a",
      sourceFullRunId: "run-current",
      snapshot: sourceSnapshot,
    });

    const semantic = candidatesFor(
      "run-current",
      sourceSnapshot,
      report(false),
      rankingContext,
    ).find(
      (candidate) =>
        candidate.criterion.criterionId === "criterion_cue_scue_1_r1",
    );

    expect(semantic?.repeated).toBe(false);
  });

  it("counts up to five compatible runs and reuses any issue from three total runs onward", async () => {
    const sourceSnapshot = snapshot();
    const query = vi.fn(async () => [
      historyRow(
        "run-latest",
        "2026-07-10T00:00:00.000Z",
        passingReport(),
        sourceSnapshot,
      ),
      historyRow(
        "run-previous-2",
        "2026-07-09T00:00:00.000Z",
        report(false),
        sourceSnapshot,
      ),
      historyRow(
        "run-previous-3",
        "2026-07-08T00:00:00.000Z",
        passingReport(),
        sourceSnapshot,
      ),
      historyRow(
        "run-previous-4",
        "2026-07-07T00:00:00.000Z",
        passingReport(),
        sourceSnapshot,
      ),
      historyRow(
        "run-previous-5",
        "2026-07-06T00:00:00.000Z",
        passingReport(),
        sourceSnapshot,
      ),
    ]);
    const rankingContext = await loadPracticeGoalRankingContext({
      executor: { query } as never,
      projectId: "project-a",
      sourceFullRunId: "run-current",
      snapshot: sourceSnapshot,
    });

    const semantic = candidatesFor(
      "run-current",
      sourceSnapshot,
      report(false),
      rankingContext,
    ).find(
      (candidate) =>
        candidate.criterion.criterionId === "criterion_cue_scue_1_r1",
    );

    expect(semantic?.repeated).toBe(true);
    expect(
      [...rankingContext.patternHistory.values()].find(
        (history) =>
          history.previousCompatibleRunCount === 5 &&
          history.previousIssueCount === 1,
      ),
    ).toBeDefined();
  });

  it("excludes incompatible and unmeasured criterion history", async () => {
    const sourceSnapshot = snapshot();
    const unmeasuredReport = rehearsalReportSchema.parse({
      ...report(false),
      semanticCueOutcomes: report(false).semanticCueOutcomes.map((outcome) => ({
        ...outcome,
        status: "unmeasured" as const,
        measurementMode: "none" as const,
        unmeasuredReason: "transcript_incomplete" as const,
      })),
    });
    const incompatibleSnapshot = rehearsalEvaluationSnapshotSchema.parse({
      ...sourceSnapshot,
      deckContentHash: "b".repeat(64),
    });
    const query = vi.fn(async () => [
      historyRow(
        "run-incompatible",
        "2026-07-10T00:00:00.000Z",
        report(false),
        incompatibleSnapshot,
      ),
      historyRow(
        "run-unmeasured",
        "2026-07-09T00:00:00.000Z",
        unmeasuredReport,
        sourceSnapshot,
      ),
    ]);
    const rankingContext = await loadPracticeGoalRankingContext({
      executor: { query } as never,
      projectId: "project-a",
      sourceFullRunId: "run-current",
      snapshot: sourceSnapshot,
    });

    const semantic = candidatesFor(
      "run-current",
      sourceSnapshot,
      report(false),
      rankingContext,
    ).find(
      (candidate) =>
        candidate.criterion.criterionId === "criterion_cue_scue_1_r1",
    );

    expect(rankingContext.mode).toBe("rerun");
    expect(semantic?.repeated).toBe(false);
    expect(rankingContext.patternHistory.size).toBe(2);
  });

  it("merges duplicate criterion scopes and keeps ordering independent from input order", () => {
    const sourceSnapshot = snapshot();
    const evaluation = evaluateFullRunCriteria({
      sourceFullRunId: "run-a",
      snapshot: sourceSnapshot,
      report: report(false),
    });
    const firstResult = evaluation.results[0];
    const firstObservation = evaluation.observations.find(
      (observation) => observation.observationId === firstResult?.observationId,
    );
    if (!firstResult?.observationId || !firstObservation) {
      throw new Error("Expected a measured semantic fixture.");
    }
    const partialResult = {
      ...firstResult,
      evaluationStatus: "partial" as const,
      reasonCode: "PARTIAL" as const,
    };
    const duplicateObservation = {
      ...firstObservation,
      observationId: "observation_duplicate",
      value: { kind: "semantic" as const, value: "contradicted" as const },
    };
    const duplicateResult = {
      ...firstResult,
      observationId: duplicateObservation.observationId,
    };
    const sharedInput = {
      sourceFullRunId: "run-a",
      criteria: sourceSnapshot.evaluationPlan?.criteria ?? [],
      focusProfileSnapshot: null,
      evaluatorLensId: "decision-maker" as const,
      slideOrder: new Map([["slide_1", 1]]),
      coreSemanticCriterionKeys: new Set<string>(),
      rankingContext: {
        mode: "baseline" as const,
        patternHistory: new Map(),
      },
    };
    const forward = deriveProblemCandidates({
      ...sharedInput,
      results: [partialResult, ...evaluation.results.slice(1), duplicateResult],
      observations: [...evaluation.observations, duplicateObservation],
    });
    const reversed = deriveProblemCandidates({
      ...sharedInput,
      results: [
        partialResult,
        ...evaluation.results.slice(1),
        duplicateResult,
      ].reverse(),
      observations: [
        ...evaluation.observations,
        duplicateObservation,
      ].reverse(),
    });

    expect(forward).toEqual(reversed);
    const merged = forward.filter(
      (candidate) =>
        candidate.criterion.criterionId ===
        firstResult.criterionRef.criterionId,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      evaluationStatus: "failed",
      severity: 3,
      observationIds: [
        firstObservation.observationId,
        "observation_duplicate",
      ].sort(),
    });
    expect(merged[0]?.evidenceRefs).toEqual([
      {
        kind: "semantic-cue",
        slideId: "slide_1",
        cueId: "scue_1",
        outcome: "contradicted",
      },
      {
        kind: "semantic-cue",
        slideId: "slide_1",
        cueId: "scue_1",
        outcome: "missed",
      },
    ]);
  });

  it("persists the immutable set before advancing the current head with revision CAS", async () => {
    const set = derivePracticeGoalSet({
      projectId: "project-a",
      sourceFullRunId: "run-a",
      sourceAnalysisRevision: 1,
      snapshot: snapshot(),
      report: report(true),
    });
    if (!set) throw new Error("Expected a goal set.");
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => []);
    const dataSource = {
      transaction: vi.fn(
        async (callback: (manager: { query: typeof query }) => unknown) =>
          callback({ query }),
      ),
    };

    await persistPracticeGoalSet(dataSource as never, set);

    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[0]?.[0]).toContain(
      "INSERT INTO practice_goal_sets",
    );
    expect(query.mock.calls[0]?.[0]).toContain(
      "ON CONFLICT (source_full_run_id, revision) DO NOTHING",
    );
    for (const [index, goal] of set.goals.entries()) {
      const evidenceRefsParameter = query.mock.calls[index + 1]?.[1]?.[10];
      expect(typeof evidenceRefsParameter).toBe("string");
      expect(JSON.parse(String(evidenceRefsParameter))).toEqual(
        goal.evidenceRefs,
      );
      expect(query.mock.calls[index + 1]?.[0]).toContain(
        "ON CONFLICT (goal_id) DO NOTHING",
      );
    }
    expect(query.mock.calls.at(-1)?.[0]).toContain(
      "practice_goal_heads.current_analysis_revision < EXCLUDED.current_analysis_revision",
    );
  });

  it("creates idempotent bounded resolutions only for terminal full-run facts", async () => {
    const sourceSnapshot = snapshot("goalset_source");
    let queryCount = 0;
    const query = vi.fn(
      async (_sql: string, _parameters?: unknown[]): Promise<unknown[]> =>
        queryCount++ === 0
          ? [
              {
                goal_id: "goal_source",
                origin_full_run_id: "run-source",
                criterion_ref_json: {
                  criterionId: "criterion_system_filler_v1",
                  revision: 1,
                },
                target_scope_json: null,
                category: "delivery",
              },
            ]
          : [],
    );

    const resolutions = await persistSourceGoalResolutions({ query } as never, {
      projectId: "project-a",
      evaluatedFullRunId: "run-a",
      snapshot: sourceSnapshot,
      report: report(false),
    });

    expect(resolutions).toMatchObject([
      {
        goalId: "goal_source",
        status: "repeated",
        measurementState: "measured",
        observation: { kind: "count", metric: "filler-word-count", value: 4 },
        reasonCode: "FAILED",
      },
    ]);
    expect(query.mock.calls[1]?.[0]).toContain(
      "ON CONFLICT (goal_id, evaluated_full_run_id) DO NOTHING",
    );
  });

  it("keeps a partial semantic result repeated instead of resolving the source goal", async () => {
    const sourceSnapshot = snapshot("goalset_source");
    let queryCount = 0;
    const query = vi.fn(
      async (_sql: string, _parameters?: unknown[]): Promise<unknown[]> =>
        queryCount++ === 0
          ? [
              {
                goal_id: "goal_semantic_source",
                origin_full_run_id: "run-source",
                criterion_ref_json: {
                  criterionId: "criterion_cue_scue_1_r1",
                  revision: 1,
                },
                target_scope_json: {
                  type: "slide",
                  scopeId: "scope_slide_1",
                  slideId: "slide_1",
                },
                category: "semantic",
              },
            ]
          : [],
    );
    const partialReport = rehearsalReportSchema.parse({
      ...passingReport(),
      semanticCueOutcomes: [
        {
          slideId: "slide_1",
          cueId: "scue_1",
          cueRevision: 1,
          cueMeaningSnapshot: "핵심 가치",
          reportLabelSnapshot: "핵심 가치",
          importance: "core",
          status: "partial",
          measurementMode: "full",
          fallbackUsed: false,
          coveredConcepts: ["가치"],
          missingConcepts: ["근거"],
        },
      ],
    });

    const resolutions = await persistSourceGoalResolutions({ query } as never, {
      projectId: "project-a",
      evaluatedFullRunId: "run-a",
      snapshot: sourceSnapshot,
      report: partialReport,
    });

    expect(resolutions).toMatchObject([
      {
        goalId: "goal_semantic_source",
        status: "repeated",
        measurementState: "measured",
        observation: { kind: "semantic", value: "partial" },
        reasonCode: "FAILED",
      },
    ]);
  });

  it("loads ranking history only from compatible measured full runs", async () => {
    const previousSnapshot = snapshot();
    const previousReport = report(false);
    const previousSet = derivePracticeGoalSet({
      projectId: "project-a",
      sourceFullRunId: "run-previous",
      sourceAnalysisRevision: 1,
      snapshot: previousSnapshot,
      report: rehearsalReportSchema.parse({
        ...previousReport,
        reportId: "report_run-previous",
        runId: "run-previous",
      }),
    });
    const fillerGoal = previousSet?.goals.find(
      (goal) => goal.criterionRef.criterionId === "criterion_system_filler_v1",
    );
    if (!fillerGoal) throw new Error("Expected a previous filler goal.");
    const rows = [
      {
        run_id: "run-previous",
        created_at: "2026-07-10T00:00:00.000Z",
        evaluation_snapshot_json: previousSnapshot,
        report_json: {
          ...previousReport,
          reportId: "report_run-previous",
          runId: "run-previous",
        },
      },
    ];
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => rows);
    const executor = { query };

    const rankingContext = await loadPracticeGoalRankingContext({
      executor: executor as never,
      projectId: "project-a",
      sourceFullRunId: "run-current",
      snapshot: snapshot(),
    });
    const incompatible = await loadPracticeGoalRankingContext({
      executor: executor as never,
      projectId: "project-a",
      sourceFullRunId: "run-current",
      snapshot: rehearsalEvaluationSnapshotSchema.parse({
        ...snapshot(),
        deckContentHash: "b".repeat(64),
      }),
    });

    expect(rankingContext.mode).toBe("rerun");
    expect(rankingContext.patternHistory.get(fillerGoal.patternKey)).toEqual({
      previousCompatibleRunCount: 1,
      previousIssueCount: 1,
      issueInLatestCompatibleRun: true,
      lastOccurredAt: "2026-07-10T00:00:00.000Z",
    });
    expect(incompatible).toEqual({
      mode: "baseline",
      patternHistory: new Map(),
    });
    expect(query.mock.calls[0]?.[0]).toContain(
      "runs.semantic_evaluation_mode = 'full'",
    );
    expect(query.mock.calls[0]?.[0]).toContain("runs.status = 'succeeded'");
    expect(query.mock.calls[0]?.[0]).toContain("LIMIT 5");
    expect(query.mock.calls[0]?.[0]).not.toContain("practice_goals");
  });
});

function syntheticCandidate(input: {
  sourceFullRunId?: string;
  criterion: unknown;
  value: unknown;
  slideOrder?: Array<[string, number]>;
  focusTarget?: unknown;
}) {
  const criterion = evaluationCriterionSchema.parse(input.criterion);
  const observation = reportObservationSchema.parse({
    observationId: `observation_${criterion.criterionId}`,
    criterionRef: {
      criterionId: criterion.criterionId,
      revision: criterion.revision,
    },
    scope: criterion.scope,
    measurementState: "measured",
    value: input.value,
    evidenceRefs: [],
    observedAt: "2026-07-14T00:00:00.000Z",
  });
  const isPartial =
    observation.value.kind === "semantic" &&
    observation.value.value === "partial";
  const result = criterionResultSchema.parse({
    criterionRef: observation.criterionRef,
    category: criterion.category,
    scope: criterion.scope,
    measurementState: "measured",
    evaluationStatus: isPartial ? "partial" : "failed",
    observationId: observation.observationId,
    reasonCode: isPartial
      ? "PARTIAL"
      : observation.value.kind === "semantic"
        ? "CONCEPT_MISSED"
        : "THRESHOLD_EXCEEDED",
    evaluatedAt: observation.observedAt,
  });
  const focusProfileSnapshot = input.focusTarget
    ? rehearsalFocusProfileSnapshotSchema.parse({
        profileRef: { profileId: "profile_1", revision: 1 },
        items: [
          {
            focusItemId: "focus_1",
            priority: 1,
            kind:
              criterion.measurement.type === "semantic-coverage"
                ? "semantic-coverage"
                : "custom",
            label: "고정 Target",
            targetScope: input.focusTarget,
          },
        ],
      })
    : null;
  const candidates = deriveProblemCandidates({
    sourceFullRunId: input.sourceFullRunId ?? "run-a",
    criteria: [criterion],
    results: [result],
    observations: [observation],
    focusProfileSnapshot,
    evaluatorLensId: "general-novice",
    slideOrder: new Map(input.slideOrder ?? [["slide_1", 1]]),
    coreSemanticCriterionKeys: new Set(),
    rankingContext: { mode: "baseline", patternHistory: new Map() },
  });
  const candidate = candidates[0];
  if (!candidate) throw new Error("Expected a synthetic problem candidate.");
  return candidate;
}

function candidatesFor(
  sourceFullRunId: string,
  sourceSnapshot: RehearsalEvaluationSnapshot,
  sourceReport: RehearsalReport,
  rankingContext: PracticeGoalRankingContext,
) {
  const evaluation = evaluateFullRunCriteria({
    sourceFullRunId,
    snapshot: sourceSnapshot,
    report: sourceReport,
  });
  return deriveProblemCandidates({
    sourceFullRunId,
    criteria: sourceSnapshot.evaluationPlan?.criteria ?? [],
    results: evaluation.results,
    observations: evaluation.observations,
    focusProfileSnapshot: sourceSnapshot.focusProfileSnapshot,
    evaluatorLensId:
      sourceSnapshot.evaluationPlan?.evaluatorLensRef.lensId ??
      "general-novice",
    slideOrder: new Map(
      sourceSnapshot.slides.map((slide) => [slide.slideId, slide.order]),
    ),
    coreSemanticCriterionKeys: coreSemanticKeysForTest(sourceSnapshot),
    rankingContext,
  });
}

function coreSemanticKeysForTest(snapshot: RehearsalEvaluationSnapshot) {
  return new Set(
    (snapshot.evaluationPlan?.criteria ?? [])
      .filter((criterion) => {
        if (
          criterion.source === "brief" &&
          criterion.category === "semantic" &&
          criterion.measurement.type === "semantic-coverage"
        ) {
          return true;
        }
        if (
          criterion.source !== "deck-cue" ||
          criterion.scope.type !== "slide"
        ) {
          return false;
        }
        const slideId = criterion.scope.slideId;
        return snapshot.slides.some(
          (slide) =>
            slide.slideId === slideId &&
            slide.semanticCues.some(
              (cue) =>
                cue.importance === "core" &&
                criterion.criterionId ===
                  `criterion_cue_${cue.cueId}_r${cue.revision}`.slice(0, 128) &&
                criterion.revision === cue.revision,
            ),
        );
      })
      .map(criterionScopeKeyForTest),
  );
}

function criterionScopeKeyForTest(criterion: EvaluationCriterion) {
  return canonicalJsonForTest({
    criterionId: criterion.criterionId,
    revision: criterion.revision,
    scope: criterion.scope,
  });
}

function canonicalJsonForTest(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalJsonForTest).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) => `${JSON.stringify(key)}:${canonicalJsonForTest(item)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function historyRow(
  runId: string,
  createdAt: string,
  sourceReport: RehearsalReport,
  sourceSnapshot: RehearsalEvaluationSnapshot,
) {
  return {
    run_id: runId,
    created_at: createdAt,
    evaluation_snapshot_json: sourceSnapshot,
    report_json: {
      ...sourceReport,
      reportId: `report_${runId}`,
      runId,
    },
  };
}

function twoCoreSnapshot() {
  const base = snapshot();
  const plan = base.evaluationPlan;
  const firstSlide = base.slides[0];
  if (!plan || !firstSlide)
    throw new Error("Expected ranking snapshot fixtures.");
  return rehearsalEvaluationSnapshotSchema.parse({
    ...base,
    evaluationPlan: {
      ...plan,
      criteria: [
        plan.criteria[0],
        {
          criterionId: "criterion_cue_scue_2_r1",
          revision: 1,
          category: "semantic",
          source: "deck-cue",
          scope: { type: "slide", slideId: "slide_1" },
          label: "두 번째 핵심 가치",
          measurement: {
            type: "semantic-coverage",
            expectedConceptIds: ["concept_second_value"],
          },
        },
        ...plan.criteria.slice(1),
      ],
    },
    slides: [
      {
        ...firstSlide,
        semanticCues: [
          ...firstSlide.semanticCues,
          {
            ...firstSlide.semanticCues[0],
            cueId: "scue_2",
            meaning: "두 번째 핵심 가치",
            requiredConcepts: ["두 번째 가치"],
            nliHypotheses: ["발표자는 두 번째 가치를 설명했다"],
          },
        ],
      },
    ],
  });
}

function twoCoreReport(secondStatus: "covered" | "missed") {
  const base = report(false);
  const firstOutcome = base.semanticCueOutcomes[0];
  if (!firstOutcome) throw new Error("Expected a semantic outcome fixture.");
  return rehearsalReportSchema.parse({
    ...base,
    semanticCueOutcomes: [
      firstOutcome,
      {
        ...firstOutcome,
        cueId: "scue_2",
        cueMeaningSnapshot: "두 번째 핵심 가치",
        reportLabelSnapshot: "두 번째 핵심 가치",
        status: secondStatus,
        coveredConcepts: secondStatus === "covered" ? ["두 번째 가치"] : [],
        missingConcepts: secondStatus === "covered" ? [] : ["두 번째 가치"],
      },
    ],
  });
}

function snapshot(sourceGoalSetId: string | null = null) {
  return rehearsalEvaluationSnapshotSchema.parse({
    deckId: "deck-a",
    deckVersion: 3,
    deckContentHash: "a".repeat(64),
    capturedAt: "2026-07-11T00:00:00.000Z",
    evaluationPlan: {
      planVersion: 1,
      briefRef: { mode: "generic" },
      evaluatorLensRef: { lensId: "decision-maker", revision: 1 },
      targetDurationSeconds: 60,
      criteria: [
        {
          criterionId: "criterion_cue_scue_1_r1",
          revision: 1,
          category: "semantic",
          source: "deck-cue",
          scope: { type: "slide", slideId: "slide_1" },
          label: "핵심 가치",
          measurement: {
            type: "semantic-coverage",
            expectedConceptIds: ["concept_value"],
          },
        },
        {
          criterionId: "criterion_timing_slide_1",
          revision: 1,
          category: "timing",
          source: "system",
          scope: { type: "slide", slideId: "slide_1" },
          label: "첫 장 목표 시간",
          measurement: { type: "max-duration-seconds", maximum: 30 },
        },
        {
          criterionId: "criterion_system_filler_v1",
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
        },
        {
          criterionId: "criterion_system_long_silence_v1",
          revision: 1,
          category: "delivery",
          source: "system",
          scope: { type: "run" },
          label: "긴 침묵",
          measurement: {
            type: "max-count",
            metric: "long-silence-count",
            maximum: 0,
          },
        },
      ],
      metricDefinitionVersions: {
        timing: 1,
        filler: 1,
        silence: 1,
        semantic: 1,
      },
      approvedReferences: [],
      practiceGoalSetRef: sourceGoalSetId
        ? { goalSetId: sourceGoalSetId, revision: 1 }
        : null,
    },
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "첫 장",
        estimatedSeconds: 30,
        keywords: [],
        semanticCues: [
          {
            cueId: "scue_1",
            slideId: "slide_1",
            meaning: "핵심 가치",
            importance: "core",
            reviewStatus: "approved",
            freshness: "current",
            origin: "manual",
            revision: 1,
            required: true,
            priority: 1,
            candidateKeywords: ["가치"],
            aliases: {},
            requiredConcepts: ["가치"],
            nliHypotheses: ["발표자는 가치를 설명했다"],
            negativeHints: [],
            targetElementIds: [],
            triggerActionIds: [],
          },
        ],
      },
    ],
  });
}

function snapshotWithBriefCriteria() {
  const base = snapshot();
  const plan = base.evaluationPlan;
  if (!plan) throw new Error("Expected an evaluation plan fixture.");
  return rehearsalEvaluationSnapshotSchema.parse({
    ...base,
    evaluationPlan: {
      ...plan,
      criteria: [
        ...plan.criteria,
        {
          criterionId: "criterion_brief_must_cover",
          revision: 1,
          category: "semantic",
          source: "brief",
          scope: { type: "run" },
          label: "필수 내용 전달",
          measurement: {
            type: "semantic-coverage",
            expectedConceptIds: ["brief_concept_must_cover"],
          },
        },
        {
          criterionId: "criterion_brief_opening",
          revision: 1,
          category: "structure",
          source: "brief",
          scope: { type: "time-window", window: "opening" },
          label: "도입부 목표 전달",
          measurement: {
            type: "semantic-coverage",
            expectedConceptIds: ["brief_concept_opening"],
          },
        },
        {
          criterionId: "criterion_brief_closing",
          revision: 1,
          category: "structure",
          source: "brief",
          scope: { type: "time-window", window: "closing" },
          label: "마무리 목표 전달",
          measurement: {
            type: "semantic-coverage",
            expectedConceptIds: ["brief_concept_closing"],
          },
        },
      ],
    },
  });
}

function report(retryable: boolean) {
  return rehearsalReportSchema.parse({
    reportId: "report_run-a",
    runId: "run-a",
    projectId: "project-a",
    deckId: "deck-a",
    transcriptRetained: false,
    transcript: null,
    metrics: {
      durationSeconds: 45,
      wordsPerMinute: 120,
      fillerWordCount: 4,
      keywordCoverage: 0.5,
    },
    semanticEvaluation: {
      state: retryable ? "partial" : "succeeded",
      measurementMode: "full",
      reasons: retryable ? ["timeout"] : [],
      retryable,
    },
    semanticCueOutcomes: [
      {
        slideId: "slide_1",
        cueId: "scue_1",
        cueRevision: 1,
        cueMeaningSnapshot: "핵심 가치",
        reportLabelSnapshot: "핵심 가치",
        importance: "core",
        status: "missed",
        measurementMode: "full",
        fallbackUsed: false,
        coveredConcepts: [],
        missingConcepts: ["가치"],
      },
    ],
    slideTimings: [
      { slideId: "slide_1", targetSeconds: 30, actualSeconds: 45 },
    ],
    coaching: null,
    generatedAt: "2026-07-11T00:01:00.000Z",
  });
}

function passingReport() {
  return rehearsalReportSchema.parse({
    ...report(false),
    metrics: {
      durationSeconds: 28,
      wordsPerMinute: 120,
      fillerWordCount: 0,
      keywordCoverage: 1,
    },
    semanticCueOutcomes: [
      {
        slideId: "slide_1",
        cueId: "scue_1",
        cueRevision: 1,
        cueMeaningSnapshot: "핵심 가치",
        reportLabelSnapshot: "핵심 가치",
        importance: "core",
        status: "covered",
        measurementMode: "full",
        fallbackUsed: false,
        coveredConcepts: ["가치"],
        missingConcepts: [],
      },
    ],
    slideTimings: [
      { slideId: "slide_1", targetSeconds: 30, actualSeconds: 20 },
    ],
  });
}
