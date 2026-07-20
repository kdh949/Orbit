import {
  rehearsalEvaluationSnapshotSchema,
  rehearsalReportSchema,
  type RehearsalReport,
} from "@orbit/shared";
import { describe, expect, it } from "vitest";
import { buildRehearsalProjectSummary } from "./rehearsal-project-summary";

describe("buildRehearsalProjectSummary", () => {
  it("aggregates measured run trends and latest-snapshot slide rows", () => {
    const summary = buildRehearsalProjectSummary({
      projectId: "project_1",
      progressComment: "최근 발표 흐름이 안정되고 있습니다.",
      runs: [
        {
          runId: "run_1",
          createdAt: new Date("2026-07-18T00:00:00.000Z"),
          rehearsalReport: reportFixture({
            runId: "run_1",
            durationSeconds: 100,
            longSilenceCount: 4,
            slideTimings: [
              { slideId: "slide_1", targetSeconds: 60, actualSeconds: 80 },
              { slideId: "slide_2", targetSeconds: 60, actualSeconds: 40 },
            ],
            semanticStatuses: ["covered", "partial"],
            missedKeywordIds: ["kw_1", "kw_2"],
          }),
          evaluationSnapshot: snapshotFixture(),
        },
        {
          runId: "run_2",
          createdAt: new Date("2026-07-19T00:00:00.000Z"),
          rehearsalReport: reportFixture({
            runId: "run_2",
            durationSeconds: 90,
            longSilenceCount: 2,
            slideTimings: [
              { slideId: "slide_1", targetSeconds: 60, actualSeconds: 60 },
              { slideId: "slide_2", targetSeconds: 60, actualSeconds: 61 },
            ],
            semanticStatuses: ["covered", "covered"],
            missedKeywordIds: ["kw_1"],
          }),
          evaluationSnapshot: snapshotFixture(),
        },
      ],
    });

    expect(summary.runMetricSeries).toHaveLength(2);
    expect(summary.runMetricSeries[1]).toMatchObject({
      duration: {
        measurementState: "measured",
        actualSeconds: 90,
        targetSeconds: 120,
      },
      longSilence: { measurementState: "measured", count: 2 },
      coreMessageCoverage: {
        measurementState: "measured",
        coveredCount: 2,
        measurableCount: 2,
        rate: 1,
      },
      keywordCoverage: {
        measurementState: "measured",
        matchedCount: 1,
        missedCount: 1,
        measurableCount: 2,
        rate: 0.5,
      },
      timingOverrun: {
        measurementState: "measured",
        overrunCount: 0,
        measurableCount: 2,
        rate: 0,
      },
    });
    expect(summary.slidePerformanceSummaries).toEqual([
      expect.objectContaining({
        slideId: "slide_1",
        order: 1,
        title: "문제 정의",
        thumbnailUrl: "/slides/1.png",
        avgActualSeconds: 70,
        targetSeconds: 60,
        sampleCount: 2,
        timingOverrun: expect.objectContaining({
          overrunCount: 1,
          measurableCount: 2,
          rate: 0.5,
        }),
        coreMessageCoverage: expect.objectContaining({
          coveredCount: 2,
          measurableCount: 2,
          rate: 1,
        }),
        keywordCoverage: expect.objectContaining({
          matchedCount: 0,
          missedCount: 2,
          measurableCount: 2,
          rate: 0,
        }),
        repeatedMissedKeywordCount: 1,
      }),
      expect.objectContaining({
        slideId: "slide_2",
        order: 2,
        title: "해결책",
        thumbnailUrl: "/slides/2.png",
        avgActualSeconds: 51,
        targetSeconds: 60,
        sampleCount: 2,
        coreMessageCoverage: expect.objectContaining({
          coveredCount: 1,
          partialCount: 1,
          measurableCount: 2,
          rate: 0.5,
        }),
        keywordCoverage: expect.objectContaining({
          matchedCount: 1,
          missedCount: 1,
          measurableCount: 2,
          rate: 0.5,
        }),
      }),
    ]);
  });

  it("keeps unavailable reports out of measured legacy series", () => {
    const summary = buildRehearsalProjectSummary({
      projectId: "project_1",
      progressComment: null,
      runs: [
        {
          runId: "run_legacy",
          createdAt: new Date("2026-07-17T00:00:00.000Z"),
          rehearsalReport: null,
          evaluationSnapshot: snapshotFixture(),
        },
      ],
    });

    expect(summary.runMetricSeries[0]).toMatchObject({
      duration: {
        measurementState: "unmeasured",
        reasonCode: "REPORT_UNAVAILABLE",
        actualSeconds: null,
        targetSeconds: 120,
      },
      longSilence: {
        measurementState: "unmeasured",
        reasonCode: "REPORT_UNAVAILABLE",
        count: null,
      },
      coreMessageCoverage: {
        measurementState: "unmeasured",
        reasonCode: "REPORT_UNAVAILABLE",
        rate: null,
      },
      keywordCoverage: {
        measurementState: "unmeasured",
        reasonCode: "REPORT_UNAVAILABLE",
        rate: null,
      },
    });
    expect(summary.runDurationSeries).toEqual([]);
    expect(summary.slidePerformanceSummaries).toEqual([
      expect.objectContaining({
        slideId: "slide_1",
        avgActualSeconds: null,
        sampleCount: 0,
      }),
      expect.objectContaining({
        slideId: "slide_2",
        avgActualSeconds: null,
        sampleCount: 0,
      }),
    ]);
  });

  it("calculates keyword coverage from the run snapshot without semantic cues", () => {
    const snapshot = snapshotFixture();
    snapshot.slides[0]!.keywords = Array.from({ length: 8 }, (_, index) => ({
      keywordId: `kw_coverage_${index + 1}`,
      text: `키워드 ${index + 1}`,
      synonyms: [],
      abbreviations: [],
      required: true,
    }));
    snapshot.slides[1]!.keywords = [];
    const report = reportFixture({
      runId: "run_keyword",
      durationSeconds: 90,
      longSilenceCount: 0,
      slideTimings: [],
      semanticStatuses: [],
    });
    report.missedKeywords = [
      {
        slideId: "slide_1",
        keywordId: "kw_coverage_8",
        text: "키워드 8",
      },
    ];

    const summary = buildRehearsalProjectSummary({
      projectId: "project_1",
      progressComment: null,
      runs: [
        {
          runId: "run_keyword",
          createdAt: new Date("2026-07-19T00:00:00.000Z"),
          rehearsalReport: report,
          evaluationSnapshot: snapshot,
        },
      ],
    });

    expect(summary.runMetricSeries[0]?.keywordCoverage).toEqual({
      measurementState: "measured",
      reasonCode: null,
      matchedCount: 7,
      missedCount: 1,
      measurableCount: 8,
      rate: 0.875,
    });
    expect(summary.runMetricSeries[0]?.coreMessageCoverage).toMatchObject({
      measurementState: "unmeasured",
      reasonCode: "NO_MEASURABLE_CORE_CUES",
    });
  });

  it("returns N/A reasons for unmeasured STT coverage and snapshots without keywords", () => {
    const unmeasuredReport = reportFixture({
      runId: "run_unmeasured",
      durationSeconds: 90,
      longSilenceCount: 0,
      slideTimings: [],
      semanticStatuses: [],
    });
    unmeasuredReport.metrics.measurements.keywordCoverage = {
      measurementState: "unmeasured",
      metricDefinitionVersion: 1,
      reasonCode: "LOW_TRANSCRIPTION_CONFIDENCE",
    };
    unmeasuredReport.metrics.keywordCoverageMeasurement = {
      state: "unmeasured",
      reason: "low-transcription-confidence",
    };
    unmeasuredReport.missedKeywords = [];

    const noKeywordSnapshot = snapshotFixture();
    noKeywordSnapshot.slides.forEach((slide) => {
      slide.keywords = [];
    });

    const summary = buildRehearsalProjectSummary({
      projectId: "project_1",
      progressComment: null,
      runs: [
        {
          runId: "run_unmeasured",
          createdAt: new Date("2026-07-18T00:00:00.000Z"),
          rehearsalReport: unmeasuredReport,
          evaluationSnapshot: snapshotFixture(),
        },
        {
          runId: "run_no_keywords",
          createdAt: new Date("2026-07-19T00:00:00.000Z"),
          rehearsalReport: reportFixture({
            runId: "run_no_keywords",
            durationSeconds: 90,
            longSilenceCount: 0,
            slideTimings: [],
            semanticStatuses: [],
          }),
          evaluationSnapshot: noKeywordSnapshot,
        },
      ],
    });

    expect(summary.runMetricSeries[0]?.keywordCoverage).toMatchObject({
      measurementState: "unmeasured",
      reasonCode: "KEYWORD_COVERAGE_UNMEASURED",
      rate: null,
    });
    expect(summary.runMetricSeries[1]?.keywordCoverage).toMatchObject({
      measurementState: "unmeasured",
      reasonCode: "NO_MEASURABLE_KEYWORDS",
      rate: null,
    });
  });
});

function reportFixture(input: {
  runId: string;
  durationSeconds: number;
  longSilenceCount: number;
  slideTimings: Array<{
    slideId: string;
    targetSeconds: number;
    actualSeconds: number;
  }>;
  semanticStatuses: Array<"covered" | "partial" | "missed">;
  missedKeywordIds?: string[];
}): RehearsalReport {
  return rehearsalReportSchema.parse({
    reportId: `report_${input.runId}`,
    runId: input.runId,
    projectId: "project_1",
    deckId: "deck_1",
    transcriptRetained: false,
    transcript: null,
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
      analysisWindowEndSeconds: input.durationSeconds,
      totalSilenceSeconds: input.longSilenceCount * 1.5,
      silenceRatio:
        (input.longSilenceCount * 1.5) / Math.max(1, input.durationSeconds),
      longSilenceCount: input.longSilenceCount,
      detectedSegmentCount: input.longSilenceCount,
      segmentsTruncated: false,
      segments: Array.from({ length: input.longSilenceCount }, (_, index) => ({
        category: "long" as const,
        startSeconds: index * 2,
        endSeconds: index * 2 + 1.5,
        durationSeconds: 1.5,
      })),
    },
    metrics: {
      durationSeconds: input.durationSeconds,
      charactersPerMinute: 300,
      wordsPerMinute: 120,
      fillerWordCount: 0,
      longSilenceCount: input.longSilenceCount,
      keywordCoverage: 1,
      measurements: measuredReportMeasurements(),
    },
    semanticEvaluation: {
      state: "succeeded",
      measurementMode: "full",
      reasons: [],
      retryable: false,
    },
    semanticCueOutcomes: input.semanticStatuses.map((status, index) => ({
      slideId: `slide_${index + 1}`,
      cueId: `scue_${index + 1}`,
      cueRevision: 1,
      cueMeaningSnapshot: `핵심 메시지 ${index + 1}`,
      reportLabelSnapshot: `핵심 메시지 ${index + 1}`,
      importance: "core",
      status,
      measurementMode: "full",
      fallbackUsed: false,
      coveredConcepts: status === "covered" ? ["핵심"] : [],
      missingConcepts: status === "covered" ? [] : ["근거"],
    })),
    missedKeywords: (input.missedKeywordIds ?? []).map((keywordId) => ({
      slideId: keywordId === "kw_1" ? "slide_1" : "slide_2",
      keywordId,
      text: keywordId === "kw_1" ? "문제" : "해결",
    })),
    slideTimings: input.slideTimings,
    slideInsights: [],
    coaching: {
      status: "succeeded",
      summary: "발표 흐름을 확인했습니다.",
      strengths: [],
      improvements: [],
      nextPracticeFocus: "핵심 메시지를 먼저 말해보세요.",
      message: "",
    },
    generatedAt: "2026-07-19T00:05:00.000Z",
  });
}

function measuredReportMeasurements() {
  return Object.fromEntries(
    [
      "duration",
      "charactersPerMinute",
      "wordsPerMinute",
      "fillerWordCount",
      "longSilenceCount",
      "keywordCoverage",
    ].map((key) => [
      key,
      {
        measurementState: "measured",
        metricDefinitionVersion: 1,
        reasonCode: null,
      },
    ]),
  );
}

function snapshotFixture() {
  return rehearsalEvaluationSnapshotSchema.parse({
    deckId: "deck_1",
    deckVersion: 1,
    capturedAt: "2026-07-19T00:00:00.000Z",
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "문제 정의",
        estimatedSeconds: 60,
        thumbnailUrl: "/slides/1.png",
        keywords: [
          {
            keywordId: "kw_1",
            text: "문제",
            synonyms: ["고충"],
            abbreviations: [],
            required: true,
          },
        ],
        semanticCues: [],
      },
      {
        slideId: "slide_2",
        order: 2,
        title: "해결책",
        estimatedSeconds: 60,
        thumbnailUrl: "/slides/2.png",
        keywords: [
          {
            keywordId: "kw_2",
            text: "해결",
            synonyms: [],
            abbreviations: ["솔루션"],
            required: true,
          },
        ],
        semanticCues: [],
      },
    ],
  });
}
