import type { ProjectsService } from "../projects/projects.service";
import {
  legacyRehearsalReportMetricsDefaults,
  rehearsalEvaluationSnapshotSchema,
  rehearsalReportSchema,
} from "@orbit/shared/rehearsals";
import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { PracticeGoalsService } from "./practice-goals.service";

describe("PracticeGoalsService", () => {
  it("does not collapse a missing goal head into no history while analysis is running", async () => {
    const service = createService([
      [
        {
          status: "processing",
          analysis_revision: 0,
          analysis_finalized_at: null,
        },
      ],
      [],
    ]);

    await expect(
      service.getPlan("project-a", "run-a", "user-a"),
    ).resolves.toEqual({
      status: "processing",
      sourceFullRunId: "run-a",
    });
  });

  it("returns no-goal when a succeeded run has no current goal head", async () => {
    const service = createService([
      [
        {
          status: "succeeded",
          analysis_revision: 1,
          analysis_finalized_at: "2026-07-12T00:00:00.000Z",
        },
      ],
      [],
    ]);

    await expect(
      service.getPlan("project-a", "run-a", "user-a"),
    ).resolves.toEqual({
      status: "no-goal",
      sourceFullRunId: "run-a",
    });
  });

  it("excludes persisted pause goals from legacy goal sets", async () => {
    const createdAt = "2026-07-11T00:00:00.000Z";
    const service = createService([
      [
        {
          status: "succeeded",
          analysis_revision: 1,
          analysis_finalized_at: createdAt,
        },
      ],
      [
        {
          goal_set_id: "goalset-a",
          revision: 1,
          source_analysis_revision: 1,
          analysis_state: "final",
          data_origin: "live",
          derivation_version: 1,
          created_at: createdAt,
        },
      ],
      [
        {
          ...goalRow(createdAt),
          evidence_refs_json: [
            {
              kind: "delivery-count",
              metric: "pause-count",
              count: 1,
            },
          ],
        },
      ],
    ]);

    await expect(
      service.getPlan("project-a", "run-a", "user-a"),
    ).resolves.toEqual({
      status: "no-goal",
      sourceFullRunId: "run-a",
    });
  });

  it("counts a prior report issue even when it had no Top 3 goal row", async () => {
    const createdAt = "2026-07-11T00:00:00.000Z";
    const { service, query } = createServiceHarness([
      [
        {
          status: "succeeded",
          analysis_revision: 1,
          analysis_finalized_at: createdAt,
        },
      ],
      [
        {
          goal_set_id: "goalset-a",
          revision: 1,
          source_analysis_revision: 1,
          analysis_state: "final",
          data_origin: "live",
          derivation_version: 1,
          created_at: createdAt,
        },
      ],
      [
        {
          goal_id: "goal-a",
          goal_set_id: "goalset-a",
          project_id: "project-a",
          origin_full_run_id: "run-a",
          priority: 1,
          pattern_key: "a".repeat(64),
          category: "timing",
          criterion_ref_json: { criterionId: "criterion-timing", revision: 1 },
          target_scope_json: {
            type: "slide",
            scopeId: "scope-1",
            slideId: "slide_1",
          },
          recommended_practice_mode: "focused",
          evidence_refs_json: [
            {
              kind: "slide-timing",
              slideId: "slide_1",
              targetSeconds: 30,
              actualSeconds: 45,
            },
          ],
          problem_label: "시간을 초과했습니다.",
          next_action: "핵심 문장만 말합니다.",
          success_condition: "30초 안에 마칩니다.",
          measurement_state: "measured",
          created_at: createdAt,
        },
      ],
      [
        historyRow("run-a", createdAt),
        historyRow("run-previous", "2026-07-10T00:00:00.000Z"),
      ],
    ]);

    const result = await service.getPlan("project-a", "run-a", "user-a");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected ready plan.");
    expect(result.goals[0]).toMatchObject({
      canStartFocusedPractice: true,
      unavailableReason: null,
      history: { label: "recent-twice", occurrenceCount: 2 },
    });
    expect(query.mock.calls[3]?.[0]).not.toContain("practice_goals");
    expect(query.mock.calls[3]?.[0]).toContain("runs.status = 'succeeded'");
    expect(query.mock.calls[3]?.[0]).toContain(
      "runs.semantic_evaluation_mode = 'full'",
    );
    expect(query.mock.calls[3]?.[0]).toContain("LIMIT 5");
    expect(JSON.stringify(result)).not.toContain("transcript");
  });

  it("does not label problem-normal-problem as recent-twice", async () => {
    const createdAt = "2026-07-11T00:00:00.000Z";
    const service = createService(
      readyPlanResults(createdAt, [
        historyRow("run-a", createdAt),
        historyRow("run-normal", "2026-07-10T00:00:00.000Z", {
          actualSeconds: 20,
        }),
        historyRow("run-old-problem", "2026-07-09T00:00:00.000Z"),
      ]),
    );

    const result = await service.getPlan("project-a", "run-a", "user-a");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected ready plan.");
    expect(result.goals[0]?.history).toMatchObject({
      label: "persistent",
      occurrenceCount: 2,
      comparableRunCount: 2,
    });
    expect(result.goals[0]?.history.label).not.toBe("recent-twice");
  });

  it("excludes incompatible and unmeasured runs from repetition history", async () => {
    const createdAt = "2026-07-11T00:00:00.000Z";
    const service = createService(
      readyPlanResults(createdAt, [
        historyRow("run-a", createdAt),
        historyRow("run-incompatible", "2026-07-10T00:00:00.000Z", {
          deckContentHash: "b".repeat(64),
        }),
        historyRow("run-unmeasured", "2026-07-09T00:00:00.000Z", {
          measured: false,
        }),
        historyRow("run-comparable", "2026-07-08T00:00:00.000Z"),
      ]),
    );

    const result = await service.getPlan("project-a", "run-a", "user-a");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected ready plan.");
    expect(result.goals[0]?.history).toMatchObject({
      label: "recent-twice",
      occurrenceCount: 2,
      comparableRunCount: 1,
    });
  });

  it("re-evaluates semantic cue, run filler, and slide silence issues from reports", async () => {
    const createdAt = "2026-07-11T00:00:00.000Z";
    const service = createService([
      [
        {
          status: "succeeded",
          analysis_revision: 1,
          analysis_finalized_at: createdAt,
        },
      ],
      [
        {
          goal_set_id: "goalset-a",
          revision: 1,
          source_analysis_revision: 1,
          analysis_state: "final",
          data_origin: "live",
          derivation_version: 1,
          created_at: createdAt,
        },
      ],
      measurementGoalRows(createdAt),
      [
        measurementHistoryRow("run-a", createdAt),
        measurementHistoryRow("run-previous", "2026-07-10T00:00:00.000Z"),
        measurementHistoryRow("run-passed", "2026-07-09T00:00:00.000Z", false),
      ],
    ]);

    const result = await service.getPlan("project-a", "run-a", "user-a");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected ready plan.");
    expect(result.goals).toHaveLength(3);
    expect(result.goals.map((goal) => goal.history)).toEqual([
      {
        label: "persistent",
        occurrenceCount: 2,
        comparableRunCount: 2,
        lastSeenAt: createdAt,
      },
      {
        label: "persistent",
        occurrenceCount: 2,
        comparableRunCount: 2,
        lastSeenAt: createdAt,
      },
      {
        label: "persistent",
        occurrenceCount: 2,
        comparableRunCount: 2,
        lastSeenAt: createdAt,
      },
    ]);
  });
});

function readyPlanResults(createdAt: string, historyRows: unknown[]) {
  return [
    [
      {
        status: "succeeded",
        analysis_revision: 1,
        analysis_finalized_at: createdAt,
      },
    ],
    [
      {
        goal_set_id: "goalset-a",
        revision: 1,
        source_analysis_revision: 1,
        analysis_state: "final",
        data_origin: "live",
        derivation_version: 1,
        created_at: createdAt,
      },
    ],
    [goalRow(createdAt)],
    historyRows,
  ];
}

function goalRow(createdAt: string) {
  return {
    goal_id: "goal-a",
    goal_set_id: "goalset-a",
    project_id: "project-a",
    origin_full_run_id: "run-a",
    priority: 1,
    pattern_key: "a".repeat(64),
    category: "timing",
    criterion_ref_json: { criterionId: "criterion-timing", revision: 1 },
    target_scope_json: {
      type: "slide",
      scopeId: "scope-1",
      slideId: "slide_1",
    },
    recommended_practice_mode: "focused",
    evidence_refs_json: [
      {
        kind: "slide-timing",
        slideId: "slide_1",
        targetSeconds: 30,
        actualSeconds: 45,
      },
    ],
    problem_label: "시간을 초과했습니다.",
    next_action: "핵심 문장만 말합니다.",
    success_condition: "30초 안에 마칩니다.",
    measurement_state: "measured",
    created_at: createdAt,
  };
}

function measurementGoalRows(createdAt: string) {
  const common = {
    goal_set_id: "goalset-a",
    project_id: "project-a",
    origin_full_run_id: "run-a",
    problem_label: "문제가 반복되었습니다.",
    next_action: "다음 발표에서 수정합니다.",
    success_condition: "기준 안으로 전달합니다.",
    measurement_state: "measured",
    created_at: createdAt,
  };
  return [
    {
      ...common,
      goal_id: "goal-semantic",
      priority: 1,
      pattern_key: "b".repeat(64),
      category: "semantic",
      criterion_ref_json: {
        criterionId: "criterion_cue_scue_1_r1",
        revision: 1,
      },
      target_scope_json: {
        type: "slide",
        scopeId: "scope-semantic",
        slideId: "slide_1",
      },
      recommended_practice_mode: "focused",
      evidence_refs_json: [
        {
          kind: "semantic-cue",
          slideId: "slide_1",
          cueId: "scue_1",
          outcome: "missed",
        },
      ],
    },
    {
      ...common,
      goal_id: "goal-filler",
      priority: 2,
      pattern_key: "c".repeat(64),
      category: "delivery",
      criterion_ref_json: { criterionId: "criterion-filler", revision: 1 },
      target_scope_json: null,
      recommended_practice_mode: "full-run-only",
      evidence_refs_json: [
        {
          kind: "delivery-count",
          metric: "filler-word-count",
          count: 3,
        },
      ],
    },
    {
      ...common,
      goal_id: "goal-silence",
      priority: 3,
      pattern_key: "d".repeat(64),
      category: "delivery",
      criterion_ref_json: {
        criterionId: "criterion-long-silence-slide",
        revision: 1,
      },
      target_scope_json: {
        type: "slide",
        scopeId: "scope-silence",
        slideId: "slide_1",
      },
      recommended_practice_mode: "focused",
      evidence_refs_json: [
        {
          kind: "delivery-count",
          slideId: "slide_1",
          metric: "long-silence-count",
          count: 2,
        },
      ],
    },
  ];
}

function measurementHistoryRow(
  runId: string,
  createdAt: string,
  problem = true,
) {
  const evaluationSnapshot = rehearsalEvaluationSnapshotSchema.parse({
    deckId: "deck-a",
    deckVersion: 1,
    deckContentHash: "a".repeat(64),
    evaluationPlan: {
      planVersion: 1,
      briefRef: { mode: "generic" },
      evaluatorLensRef: { lensId: "general-novice", revision: 1 },
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
            expectedConceptIds: ["concept-value"],
          },
        },
        {
          criterionId: "criterion-filler",
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
          criterionId: "criterion-long-silence-slide",
          revision: 1,
          category: "delivery",
          source: "system",
          scope: { type: "slide", slideId: "slide_1" },
          label: "슬라이드 긴 침묵",
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
      practiceGoalSetRef: null,
    },
    focusProfileSnapshot: null,
    capturedAt: createdAt,
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "첫 슬라이드",
        estimatedSeconds: 30,
        keywords: [],
        semanticCues: [],
      },
    ],
  });
  const rehearsalReport = rehearsalReportSchema.parse({
    reportId: `report-${runId}`,
    runId,
    projectId: "project-a",
    deckId: "deck-a",
    transcriptRetained: false,
    transcript: null,
    metrics: {
      durationSeconds: 45,
      wordsPerMinute: 100,
      fillerWordCount: problem ? 3 : 0,
      longSilenceCount: problem ? 2 : 0,
      keywordCoverage: 1,
      measurements: {
        ...legacyRehearsalReportMetricsDefaults.measurements,
        longSilenceCount: {
          measurementState: "measured",
          metricDefinitionVersion: 1,
          reasonCode: null,
        },
      },
    },
    silenceAnalysis: measuredSilenceAnalysis(problem ? 2 : 0),
    semanticEvaluation: {
      state: "succeeded",
      measurementMode: "full",
      reasons: [],
      retryable: false,
    },
    semanticCueOutcomes: [
      {
        slideId: "slide_1",
        cueId: "scue_1",
        cueRevision: 1,
        cueMeaningSnapshot: "핵심 가치",
        reportLabelSnapshot: "핵심 가치",
        importance: "core",
        status: problem ? "missed" : "covered",
        measurementMode: "full",
        fallbackUsed: false,
        coveredConcepts: problem ? [] : ["가치"],
        missingConcepts: problem ? ["가치"] : [],
      },
    ],
    slideTimings: [],
    slideInsights: [
      {
        slideId: "slide_1",
        fillerWordCount: 0,
        longSilenceCount: problem ? 2 : 0,
      },
    ],
    coaching: null,
    generatedAt: createdAt,
  });
  return {
    run_id: runId,
    run_created_at: createdAt,
    evaluation_snapshot_json: evaluationSnapshot,
    rehearsal_report_json: rehearsalReport,
  };
}

function historyRow(
  runId: string,
  createdAt: string,
  options: {
    deckContentHash?: string;
    measured?: boolean;
    actualSeconds?: number;
  } = {},
) {
  const evaluationSnapshot = rehearsalEvaluationSnapshotSchema.parse({
    deckId: "deck-a",
    deckVersion: 1,
    deckContentHash: options.deckContentHash ?? "a".repeat(64),
    evaluationPlan: {
      planVersion: 1,
      briefRef: { mode: "generic" },
      evaluatorLensRef: { lensId: "general-novice", revision: 1 },
      targetDurationSeconds: 60,
      criteria: [
        {
          criterionId: "criterion-timing",
          revision: 1,
          category: "timing",
          source: "system",
          scope: { type: "slide", slideId: "slide_1" },
          label: "첫 슬라이드 목표 시간",
          measurement: { type: "max-duration-seconds", maximum: 30 },
        },
      ],
      metricDefinitionVersions: {
        timing: 1,
        filler: 1,
        silence: 1,
        semantic: 1,
      },
      approvedReferences: [],
      practiceGoalSetRef: null,
    },
    focusProfileSnapshot: null,
    capturedAt: createdAt,
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "첫 슬라이드",
        estimatedSeconds: 30,
        keywords: [],
        semanticCues: [],
      },
    ],
  });
  const rehearsalReport = rehearsalReportSchema.parse({
    reportId: `report-${runId}`,
    runId,
    projectId: "project-a",
    deckId: "deck-a",
    transcriptRetained: false,
    transcript: null,
    metrics: {
      durationSeconds: 45,
      wordsPerMinute: 100,
      fillerWordCount: 0,
      keywordCoverage: 1,
    },
    semanticEvaluation: {
      state: "succeeded",
      measurementMode: "full",
      reasons: [],
      retryable: false,
    },
    semanticCueOutcomes: [],
    slideTimings:
      options.measured === false
        ? []
        : [
            {
              slideId: "slide_1",
              targetSeconds: 30,
              actualSeconds: options.actualSeconds ?? 45,
            },
          ],
    coaching: null,
    generatedAt: createdAt,
  });
  return {
    run_id: runId,
    run_created_at: createdAt,
    evaluation_snapshot_json: evaluationSnapshot,
    rehearsal_report_json: rehearsalReport,
  };
}

function createService(results: unknown[][]) {
  return createServiceHarness(results).service;
}

function measuredSilenceAnalysis(longSilenceCount: number) {
  const segments = Array.from({ length: longSilenceCount }, (_, index) => ({
    category: "long" as const,
    startSeconds: 5 + index * 3,
    endSeconds: 6.2 + index * 3,
    durationSeconds: 1.2,
  }));
  const totalSilenceSeconds = longSilenceCount * 1.2;
  return {
    metricDefinitionVersion: 1 as const,
    measurementState: "measured" as const,
    reasonCode: null,
    detector: "silero-vad" as const,
    detectorVersion: "test-vad",
    speechThreshold: 0.5 as const,
    minimumSilenceMs: 250 as const,
    longSilenceMs: 1000 as const,
    analysisWindowStartSeconds: 0,
    analysisWindowEndSeconds: 45,
    totalSilenceSeconds,
    silenceRatio: totalSilenceSeconds / 45,
    longSilenceCount,
    detectedSegmentCount: longSilenceCount,
    segmentsTruncated: false,
    segments,
  };
}

function createServiceHarness(results: unknown[][]) {
  let index = 0;
  const query = vi.fn(
    async (_sql: string, _parameters?: unknown[]) => results[index++] ?? [],
  );
  const dataSource = { query } as unknown as DataSource;
  const projects = {
    assertCanReadProject: vi.fn(async () => ({ projectId: "project-a" })),
  } as unknown as ProjectsService;
  return {
    service: new PracticeGoalsService(dataSource, projects),
    query,
  };
}
