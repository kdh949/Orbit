import {
  legacyRehearsalReportMetricsDefaults,
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
  type RehearsalReport,
  type RehearsalSemanticCueOutcome,
} from "@orbit/shared/rehearsals";
import { describe, expect, it } from "vitest";

import { buildRehearsalReportViewModel } from "./rehearsalReportViewModel";

describe("buildRehearsalReportViewModel", () => {
  it("uses only measured outcomes in the coverage denominator and Top 3", () => {
    const model = buildRehearsalReportViewModel(
      reportFixture({
        semanticEvaluation: {
          state: "partial",
          measurementMode: "full",
          reasons: ["timeout"],
          retryable: true,
        },
        semanticCueOutcomes: [
          outcomeFixture({ cueId: "covered", status: "covered" }),
          outcomeFixture({
            cueId: "partial",
            status: "partial",
            missingConcepts: ["비용 절감"],
            evidence: {
              excerpt: "반복 업무를 줄였습니다.",
              startMs: 100,
              endMs: 800,
            },
          }),
          outcomeFixture({
            cueId: "missed",
            reportLabelSnapshot: "고객 가치",
            status: "missed",
          }),
          outcomeFixture({
            cueId: "unmeasured",
            measurementMode: "none",
            status: "unmeasured",
            unmeasuredReason: "timeout",
          }),
          outcomeFixture({
            cueId: "excluded",
            measurementMode: "none",
            status: "excluded",
            unmeasuredReason: undefined,
          }),
        ],
      }),
      null,
    );

    expect(model.semantic.coverage).toEqual({
      coveredCount: 1,
      denominator: 3,
      missedCount: 1,
      partialCount: 1,
      percent: 33,
    });
    expect(model.semantic.unmeasuredItems).toHaveLength(1);
    expect(model.semantic.excludedItems).toHaveLength(1);
    expect(model.semantic.topGoals.map((goal) => goal.cueId)).toEqual([
      "missed",
      "partial",
    ]);
    expect(model.semantic.topGoals.map((goal) => goal.cueId)).not.toContain(
      "unmeasured",
    );
    expect({
      coverage: model.semantic.coverage,
      excluded: model.semantic.excludedItems.map((item) => item.reason?.label),
      goals: model.semantic.topGoals.map((goal) => ({
        cueId: goal.cueId,
        detail: goal.detail,
      })),
      notices: model.semantic.systemNotices.map((notice) => notice.label),
      state: model.semantic.stateLabel,
    }).toMatchInlineSnapshot(`
      {
        "coverage": {
          "coveredCount": 1,
          "denominator": 3,
          "missedCount": 1,
          "partialCount": 1,
          "percent": 33,
        },
        "excluded": [
          "Cue 평가 제외",
        ],
        "goals": [
          {
            "cueId": "missed",
            "detail": "다음 연습에서 이 핵심 내용을 분명하게 설명해 보세요.",
          },
          {
            "cueId": "partial",
            "detail": "빠진 내용: 비용 절감",
          },
        ],
        "notices": [
          "정밀 의미 평가 시간 초과",
        ],
        "state": "일부 의미 항목을 측정하지 못했어요",
      }
    `);
  });

  it("labels basic results without inventing missed outcomes", () => {
    const model = buildRehearsalReportViewModel(
      reportFixture({
        semanticEvaluation: {
          state: "succeeded",
          measurementMode: "basic",
          reasons: [],
          retryable: false,
        },
        semanticCueOutcomes: [
          outcomeFixture({
            cueId: "basic-covered",
            measurementMode: "basic",
            status: "covered",
          }),
          outcomeFixture({
            cueId: "basic-partial",
            measurementMode: "basic",
            status: "partial",
            coveredConcepts: ["고객 가치"],
          }),
        ],
      }),
      null,
    );

    expect(model.semantic.measurementLabel).toBe("기본 의미 체크");
    expect(model.semantic.items.map((item) => item.measurementLabel)).toEqual([
      "기본 의미 체크",
      "기본 의미 체크",
    ]);
    expect(model.semantic.topGoals).toHaveLength(1);
    expect(model.semantic.topGoals[0]?.cueId).toBe("basic-partial");
  });

  it("limits goals to three and omits a partial outcome without positive evidence", () => {
    const semanticCueOutcomes = [
      outcomeFixture({
        cueId: "partial-empty",
        status: "partial",
        coveredConcepts: [],
      }),
      ...Array.from({ length: 4 }, (_, index) =>
        outcomeFixture({
          cueId: `missed-${index}`,
          reportLabelSnapshot: `핵심 ${index}`,
          status: "missed",
        }),
      ),
    ];
    const model = buildRehearsalReportViewModel(
      reportFixture({ semanticCueOutcomes }),
      null,
    );

    expect(model.semantic.coverage.denominator).toBe(5);
    expect(model.semantic.topGoals).toHaveLength(3);
    expect(model.semantic.topGoals.map((goal) => goal.cueId)).not.toContain(
      "partial-empty",
    );
  });

  it.each([
    ["server_evaluation_failed", "서버 의미 평가 연결 실패"],
    ["timeout", "정밀 의미 평가 시간 초과"],
    ["stt_unavailable", "음성 인식 사용 불가"],
    ["stale_cue", "Cue 재검토 필요"],
    ["transcript_incomplete", "발화 근거 일부 누락"],
  ] as const)("maps %s to presenter-facing system copy", (reason, label) => {
    const model = buildRehearsalReportViewModel(
      reportFixture({
        semanticEvaluation: {
          state: "unavailable",
          measurementMode: "none",
          reasons: [reason],
          retryable: reason === "server_evaluation_failed",
        },
      }),
      null,
    );

    expect(model.semantic.systemNotices[0]).toMatchObject({
      label,
      source: "system-status",
    });
  });

  it("shows N/A instead of zero when a deck has no keyword denominator", () => {
    const model = buildRehearsalReportViewModel(
      reportFixture({
        metrics: {
          ...reportFixture().metrics,
          keywordCoverage: 0,
          keywordCoverageMeasurement: {
            state: "unmeasured",
            reason: "no-keywords",
          },
        },
      }),
      null,
    );

    expect(model.keywordCoverage).toEqual({
      detail: "저장된 장표 키워드가 없어 측정하지 않았어요.",
      valueLabel: "N/A",
    });
  });
});

function outcomeFixture(
  patch: Partial<RehearsalSemanticCueOutcome> = {},
): RehearsalSemanticCueOutcome {
  return {
    slideId: "slide_1",
    cueId: "cue_1",
    cueRevision: 1,
    cueMeaningSnapshot: "고객이 얻는 가치를 설명한다.",
    reportLabelSnapshot: "핵심 가치",
    importance: "core",
    status: "covered",
    confidence: 0.9,
    matchedBy: "post_run_semantic",
    measurementMode: "full",
    fallbackUsed: false,
    coveredConcepts: ["고객 가치"],
    missingConcepts: [],
    ...patch,
  };
}

function reportFixture(patch: Partial<RehearsalReport> = {}): RehearsalReport {
  return {
    reportId: "report_1",
    runId: "run_1",
    projectId: "project_1",
    deckId: "deck_1",
    transcriptRetained: false,
    transcript: null,
    volumeAnalysis: legacyRehearsalVolumeAnalysis,
    silenceAnalysis: legacyRehearsalSilenceAnalysis,
    metrics: {
      ...legacyRehearsalReportMetricsDefaults,
      durationSeconds: 60,
      wordsPerMinute: 120,
      fillerWordCount: 0,
      longSilenceCount: null,
      keywordCoverage: 1,
      keywordCoverageMeasurement: { state: "measured" },
    },
    speedSamples: [],
    fillerWordDetails: [],
    missedKeywords: [],
    utteranceOutcomes: [],
    semanticCueDecisions: [],
    semanticEvaluation: {
      state: "succeeded",
      measurementMode: "full",
      reasons: [],
      retryable: false,
    },
    semanticCueOutcomes: [],
    slideTimings: [],
    slideInsights: [],
    qnaSummary: {
      questionCount: 0,
      questionSummary: "",
      unclearTopics: [],
    },
    coaching: null,
    generatedAt: "2026-07-10T00:00:00.000Z",
    ...patch,
  };
}
