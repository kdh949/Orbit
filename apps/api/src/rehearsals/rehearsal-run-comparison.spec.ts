import { legacyRehearsalSlideSpeakingRate } from "@orbit/shared/coaching";
import {
  legacyRehearsalReportMetricsDefaults,
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
} from "@orbit/shared/rehearsals";
import type {
  RehearsalReport,
  RehearsalSemanticCueOutcome,
} from "@orbit/shared/rehearsals";
import { describe, expect, it } from "vitest";
import { buildRehearsalRunComparison } from "./rehearsal-run-comparison";

describe("buildRehearsalRunComparison", () => {
  it("separates compatible improvement, repeated, new, and incomparable outcomes", () => {
    const previousReport = reportFixture({
      semanticCueOutcomes: [
        outcomeFixture({ cueId: "scue_improved", status: "missed" }),
        outcomeFixture({
          cueId: "scue_repeated",
          cueRevision: 2,
          status: "partial",
        }),
        outcomeFixture({ cueId: "scue_changed", status: "missed" }),
        outcomeFixture({
          cueId: "scue_unmeasured",
          measurementMode: "none",
          status: "unmeasured",
          unmeasuredReason: "timeout",
        }),
      ],
      slideTimings: [
        { slideId: "slide_timing", targetSeconds: 60, actualSeconds: 80 },
      ],
      slideInsights: [
        {
          slideId: "slide_delivery",
          fillerWordCount: 2,
          longSilenceCount: null,
          speakingRate: legacyRehearsalSlideSpeakingRate,
        },
      ],
    });
    const currentReport = reportFixture({
      semanticCueOutcomes: [
        outcomeFixture({ cueId: "scue_improved", status: "covered" }),
        outcomeFixture({
          cueId: "scue_repeated",
          cueRevision: 2,
          status: "missed",
        }),
        outcomeFixture({
          cueId: "scue_changed",
          cueRevision: 2,
          status: "missed",
        }),
        outcomeFixture({ cueId: "scue_unmeasured", status: "covered" }),
        outcomeFixture({ cueId: "scue_new", status: "missed" }),
      ],
      slideTimings: [
        { slideId: "slide_timing", targetSeconds: 60, actualSeconds: 85 },
      ],
      slideInsights: [
        {
          slideId: "slide_delivery",
          fillerWordCount: 3,
          longSilenceCount: null,
          speakingRate: legacyRehearsalSlideSpeakingRate,
        },
      ],
    });

    const comparison = buildRehearsalRunComparison({
      currentReport,
      currentRunId: "run_current",
      previousReport,
      previousRunId: "run_previous",
    });

    expect(comparison.improved.map((issue) => issue.cueId)).toEqual([
      "scue_improved",
    ]);
    expect(comparison.repeated.map((issue) => issue.category)).toEqual([
      "semantic-cue",
      "timing",
      "delivery",
    ]);
    expect(comparison.newIssues.map((issue) => issue.cueId)).toEqual([
      "scue_new",
    ]);
    expect(comparison.incomparable.map((issue) => issue.cueId)).toEqual([
      "scue_changed",
      "scue_unmeasured",
    ]);
    expect(comparison.briefing.map((issue) => issue.category)).toEqual([
      "semantic-cue",
      "semantic-cue",
      "timing",
    ]);
    expect(comparison.briefing.map((issue) => issue.cueId)).toEqual([
      "scue_repeated",
      "scue_new",
      undefined,
    ]);
    expect(comparison.briefing).toHaveLength(3);
    expect(JSON.stringify(comparison)).not.toContain("민감한 전사 원문");
  });

  it("keeps first-run failures actionable without treating unmeasured as missed", () => {
    const comparison = buildRehearsalRunComparison({
      currentReport: reportFixture({
        semanticCueOutcomes: [
          outcomeFixture({ cueId: "scue_new", status: "partial" }),
          outcomeFixture({
            cueId: "scue_offline",
            measurementMode: "none",
            status: "unmeasured",
            unmeasuredReason: "evaluation_snapshot_mismatch",
          }),
        ],
      }),
      currentRunId: "run_current",
      previousReport: null,
      previousRunId: null,
    });

    expect(comparison.previousRunId).toBeNull();
    expect(comparison.newIssues.map((issue) => issue.cueId)).toEqual([
      "scue_new",
    ]);
    expect(comparison.incomparable.map((issue) => issue.cueId)).toEqual([
      "scue_offline",
    ]);
    expect(comparison.briefing.map((issue) => issue.cueId)).toEqual([
      "scue_new",
    ]);
  });

  it("does not label a repeated supporting cue as a repeated core issue", () => {
    const supporting = outcomeFixture({
      cueId: "scue_supporting",
      importance: "supporting",
      status: "partial",
    });
    const comparison = buildRehearsalRunComparison({
      currentReport: reportFixture({ semanticCueOutcomes: [supporting] }),
      currentRunId: "run_current",
      previousReport: reportFixture({ semanticCueOutcomes: [supporting] }),
      previousRunId: "run_previous",
    });

    expect(comparison.repeated).toEqual([]);
    expect(comparison.newIssues.map((issue) => issue.cueId)).toEqual([
      "scue_supporting",
    ]);
    expect(comparison.briefing).toEqual([]);
  });

  it("compares long silence only between measured reports of the same version", () => {
    const current = reportWithLongSilence();
    const comparable = buildRehearsalRunComparison({
      currentReport: current,
      currentRunId: "run_current",
      previousReport: reportWithLongSilence(),
      previousRunId: "run_previous",
    });
    const legacy = buildRehearsalRunComparison({
      currentReport: current,
      currentRunId: "run_current",
      previousReport: reportFixture(),
      previousRunId: "run_legacy",
    });

    expect(
      comparable.repeated.some((issue) => issue.category === "delivery"),
    ).toBe(true);
    expect(comparable.silenceComparison).toMatchObject({
      state: "comparable",
      currentLongSilenceCount: 1,
      previousLongSilenceCount: 1,
      longSilenceCountDelta: 0,
      currentTotalSilenceSeconds: 1.2,
      previousTotalSilenceSeconds: 1.2,
      totalSilenceSecondsDelta: 0,
      reasonCode: null,
    });
    expect(legacy.repeated.some((issue) => issue.category === "delivery")).toBe(
      false,
    );
    expect(
      legacy.newIssues.some((issue) => issue.category === "delivery"),
    ).toBe(false);
    expect(legacy.silenceComparison).toMatchObject({
      state: "unavailable",
      reasonCode: "PREVIOUS_UNMEASURED",
    });
  });
});

function outcomeFixture(
  patch: Partial<RehearsalSemanticCueOutcome> = {},
): RehearsalSemanticCueOutcome {
  return {
    slideId: "slide_1",
    cueId: "scue_default",
    cueRevision: 1,
    cueMeaningSnapshot: "고객이 얻는 가치를 설명한다.",
    reportLabelSnapshot: "고객 가치",
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
    runId: "run_current",
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

function reportWithLongSilence(): RehearsalReport {
  return reportFixture({
    silenceAnalysis: {
      metricDefinitionVersion: 1,
      measurementState: "measured",
      reasonCode: null,
      detector: "silero-vad",
      detectorVersion: "6.2.1",
      speechThreshold: 0.5,
      minimumSilenceMs: 250,
      longSilenceMs: 1000,
      analysisWindowStartSeconds: 0,
      analysisWindowEndSeconds: 60,
      totalSilenceSeconds: 1.2,
      silenceRatio: 0.02,
      longSilenceCount: 1,
      detectedSegmentCount: 1,
      segmentsTruncated: false,
      segments: [
        {
          category: "long",
          startSeconds: 10,
          endSeconds: 11.2,
          durationSeconds: 1.2,
        },
      ],
    },
    metrics: {
      ...legacyRehearsalReportMetricsDefaults,
      durationSeconds: 60,
      wordsPerMinute: 120,
      fillerWordCount: 0,
      longSilenceCount: 1,
      keywordCoverage: 1,
      measurements: {
        ...legacyRehearsalReportMetricsDefaults.measurements,
        longSilenceCount: {
          measurementState: "measured",
          metricDefinitionVersion: 1,
          reasonCode: null,
        },
      },
      keywordCoverageMeasurement: { state: "measured" },
    },
    slideInsights: [
      {
        slideId: "slide_delivery",
        fillerWordCount: 0,
        longSilenceCount: 1,
        speakingRate: legacyRehearsalSlideSpeakingRate,
      },
    ],
  });
}
