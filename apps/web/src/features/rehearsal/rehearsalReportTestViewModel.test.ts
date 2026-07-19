import {
  legacyRehearsalReportMetricsDefaults,
  legacyRehearsalVolumeAnalysis,
  type RehearsalReport,
} from "@orbit/shared";
import { describe, expect, it } from "vitest";
import { buildRehearsalReportTestSlideMetrics } from "./rehearsalReportTestViewModel";

describe("buildRehearsalReportTestSlideMetrics", () => {
  it("uses measured slide insight, five-second silence, and required keywords", () => {
    const metrics = buildRehearsalReportTestSlideMetrics(
      measuredReport({
        missedKeywords: [
          {
            slideId: "slide_2",
            keywordId: "kw_performance",
            text: "성능",
          },
        ],
      }),
      "slide_2",
      [
        {
          keywordId: "kw_unity",
          text: "Unity",
          synonyms: [],
          abbreviations: [],
          required: true,
        },
        {
          keywordId: "kw_performance",
          text: "성능",
          synonyms: [],
          abbreviations: [],
          required: true,
        },
      ],
    );

    expect(metrics.speakingRate).toMatchObject({
      value: "분당 300자",
      meta: "이번 발표 기준 대비 +25%",
      status: "빠름",
    });
    expect(metrics.filler).toMatchObject({ value: "3회", status: "많음" });
    expect(metrics.longSilence).toMatchObject({ value: "1회", status: "발생" });
    expect(metrics.keyMessage).toMatchObject({
      value: "1 / 2개",
      status: "일부 전달",
      meta: "미전달: 성능",
    });
    expect(metrics.nextPractice).toBe("발표 속도를 안정적으로 유지하세요.");
  });

  it("shows explicit unavailable states instead of mock values", () => {
    const report = measuredReport({
      slideInsights: [],
      semanticCueOutcomes: [],
      silenceAnalysis: {
        metricDefinitionVersion: 2,
        measurementState: "unmeasured",
        reasonCode: "VAD_INITIALIZATION_FAILED",
        detector: "silero-vad",
        detectorVersion: "unavailable",
        speechThreshold: 0.5,
        minimumSilenceMs: 250,
        longSilenceMs: 5000,
        analysisWindowStartSeconds: null,
        analysisWindowEndSeconds: null,
        totalSilenceSeconds: null,
        silenceRatio: null,
        longSilenceCount: null,
        detectedSegmentCount: 0,
        segmentsTruncated: false,
        segments: [],
      },
    });

    const metrics = buildRehearsalReportTestSlideMetrics(report, "slide_2");

    expect(metrics.speakingRate.value).toBe("측정 불가");
    expect(metrics.filler.value).toBe("측정 불가");
    expect(metrics.longSilence.value).toBe("측정 불가");
    expect(metrics.keyMessage.value).toBe("측정 불가");
    expect(metrics.nextPractice).toBe("발표 속도를 안정적으로 유지하세요.");
  });

  it("shows CPM while withholding comparison when fewer than three slides qualify", () => {
    const report = measuredReport({
      slideInsights: [
        {
          slideId: "slide_2",
          fillerWordCount: 0,
          longSilenceCount: 0,
          speakingRate: {
            metricDefinitionVersion: 1,
            measurementState: "unmeasured",
            reasonCode: "BASELINE_UNAVAILABLE",
            charactersPerSecond: null,
            baselineCharactersPerSecond: null,
            relativeRateRatio: null,
            paceCategory: null,
            activeSpeechSeconds: 5,
            characterCount: 20,
          },
        },
      ],
    });

    const metrics = buildRehearsalReportTestSlideMetrics(report, "slide_2");

    expect(metrics.speakingRate).toMatchObject({
      value: "분당 240자",
      meta: "유효한 슬라이드 발화 3개 이상 필요",
      status: "비교 불가",
    });
  });
  it("prefers slide semantic feedback for the next practice", () => {
    const report = measuredReport({
      semanticCueOutcomes: [
        semanticOutcome({
          status: "partial",
          feedback: "문제의 영향을 수치로 한 번 더 설명하세요.",
        }),
      ],
    });

    const metrics = buildRehearsalReportTestSlideMetrics(report, "slide_2");

    expect(metrics.nextPractice).toBe(
      "문제의 영향을 수치로 한 번 더 설명하세요.",
    );
  });
});

function measuredReport(patch: Partial<RehearsalReport> = {}): RehearsalReport {
  return {
    reportId: "report_1",
    runId: "run_1",
    projectId: "project_1",
    deckId: "deck_1",
    transcriptRetained: false,
    transcript: null,
    volumeAnalysis: legacyRehearsalVolumeAnalysis,
    silenceAnalysis: {
      metricDefinitionVersion: 2,
      measurementState: "measured",
      reasonCode: null,
      detector: "silero-vad",
      detectorVersion: "6.2.1",
      speechThreshold: 0.5,
      minimumSilenceMs: 250,
      longSilenceMs: 5000,
      analysisWindowStartSeconds: 0,
      analysisWindowEndSeconds: 90,
      totalSilenceSeconds: 5.5,
      silenceRatio: 0.0611,
      longSilenceCount: 1,
      detectedSegmentCount: 1,
      segmentsTruncated: false,
      segments: [
        {
          category: "long",
          startSeconds: 35,
          endSeconds: 40.5,
          durationSeconds: 5.5,
        },
      ],
    },
    metrics: {
      ...legacyRehearsalReportMetricsDefaults,
      durationSeconds: 90,
      wordsPerMinute: 120,
      fillerWordCount: 3,
      longSilenceCount: 1,
      keywordCoverage: 0.5,
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
    semanticCueOutcomes: [
      semanticOutcome(),
      semanticOutcome({
        cueId: "cue_2",
        cueMeaningSnapshot: "근거를 전달한다.",
        reportLabelSnapshot: "근거",
        status: "missed",
      }),
    ],
    slideTimings: [
      { slideId: "slide_1", actualSeconds: 30, targetSeconds: 30 },
      { slideId: "slide_2", actualSeconds: 60, targetSeconds: 60 },
    ],
    slideInsights: [
      {
        slideId: "slide_2",
        fillerWordCount: 3,
        longSilenceCount: 1,
        speakingRate: {
          metricDefinitionVersion: 1,
          measurementState: "measured",
          reasonCode: null,
          charactersPerSecond: 5,
          baselineCharactersPerSecond: 4,
          relativeRateRatio: 1.25,
          paceCategory: "faster",
          activeSpeechSeconds: 40,
          characterCount: 200,
        },
      },
    ],
    qnaSummary: {
      questionCount: 0,
      questionSummary: "",
      unclearTopics: [],
    },
    coaching: {
      status: "succeeded",
      summary: "",
      strengths: [],
      improvements: [],
      nextPracticeFocus: "발표 속도를 안정적으로 유지하세요.",
      message: "",
    },
    generatedAt: "2026-07-19T00:00:00.000Z",
    ...patch,
  };
}

function semanticOutcome(
  patch: Partial<RehearsalReport["semanticCueOutcomes"][number]> = {},
): RehearsalReport["semanticCueOutcomes"][number] {
  return {
    slideId: "slide_2",
    cueId: "cue_1",
    cueRevision: 1,
    cueMeaningSnapshot: "핵심 문제를 전달한다.",
    reportLabelSnapshot: "핵심 문제",
    importance: "core",
    status: "covered",
    confidence: 0.9,
    matchedBy: "post_run_semantic",
    measurementMode: "full",
    fallbackUsed: false,
    coveredConcepts: ["문제"],
    missingConcepts: [],
    ...patch,
  };
}
