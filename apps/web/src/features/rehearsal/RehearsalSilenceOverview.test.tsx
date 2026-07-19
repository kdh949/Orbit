import {
  legacyRehearsalReportMetricsDefaults,
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
  type RehearsalReport,
} from "@orbit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  getSilencePlaybackRange,
  RehearsalSilenceOverview,
} from "./RehearsalSilenceOverview";

describe("RehearsalSilenceOverview", () => {
  it("shows only long silence details while retaining brief silence in totals", () => {
    const html = renderToStaticMarkup(
      <RehearsalSilenceOverview
        deck={null}
        formatDuration={(seconds) => `${seconds}s`}
        report={reportFixture(measuredSilenceAnalysis())}
      />,
    );

    expect(html).toContain("긴 침묵 · 5.2s");
    expect(html).toContain("5s 지점");
    expect(html).toContain("5.6s");
    expect(html).not.toContain("1s 지점");
    expect(html).toContain("이 구간 들어보기");
  });

  it("adds two seconds of context without crossing recording boundaries", () => {
    expect(getSilencePlaybackRange(5, 10.2, 12)).toEqual({
      startSeconds: 3,
      endSeconds: 12,
    });
    expect(getSilencePlaybackRange(1, 6, 20)).toEqual({
      startSeconds: 0,
      endSeconds: 8,
    });
  });

  it("shows playback as unavailable when the recording cannot be played", () => {
    const html = renderToStaticMarkup(
      <RehearsalSilenceOverview
        audioPlaybackAvailable={false}
        deck={null}
        formatDuration={(seconds) => `${seconds}s`}
        report={reportFixture(measuredSilenceAnalysis())}
      />,
    );

    expect(html).toContain("녹음 재생 불가");
    expect(html).not.toContain("이 구간 들어보기");
  });

  it("does not expose legacy one-second segments as danger zones", () => {
    const html = renderToStaticMarkup(
      <RehearsalSilenceOverview
        deck={null}
        formatDuration={(seconds) => `${seconds}s`}
        report={reportFixture(legacyMeasuredSilenceAnalysis())}
      />,
    );

    expect(html).not.toContain("rrd-pause-alert is-critical");
  });

  it("renders legacy reports as unmeasured", () => {
    const html = renderToStaticMarkup(
      <RehearsalSilenceOverview
        deck={null}
        formatDuration={(seconds) => `${seconds}s`}
        report={reportFixture(legacyRehearsalSilenceAnalysis)}
      />,
    );

    expect(html).toContain("음성 기반 침묵 구간을 측정하지 못했습니다");
    expect(html).not.toContain("1초 이상 침묵한 구간이 없습니다");
  });
});

function reportFixture(
  silenceAnalysis: RehearsalReport["silenceAnalysis"],
): RehearsalReport {
  const measured = silenceAnalysis.measurementState === "measured";
  return {
    reportId: "report_1",
    runId: "run_1",
    projectId: "project_1",
    deckId: "deck_1",
    transcriptRetained: false,
    transcript: null,
    volumeAnalysis: legacyRehearsalVolumeAnalysis,
    silenceAnalysis,
    metrics: {
      ...legacyRehearsalReportMetricsDefaults,
      durationSeconds: 12,
      wordsPerMinute: 120,
      fillerWordCount: 0,
      longSilenceCount: measured ? silenceAnalysis.longSilenceCount : null,
      keywordCoverage: 1,
      measurements: {
        ...legacyRehearsalReportMetricsDefaults.measurements,
        longSilenceCount: measured
          ? {
              measurementState: "measured",
              metricDefinitionVersion: silenceAnalysis.metricDefinitionVersion,
              reasonCode: null,
            }
          : legacyRehearsalReportMetricsDefaults.measurements.longSilenceCount,
      },
      keywordCoverageMeasurement: { state: "measured" },
    },
    speedSamples: [],
    fillerWordDetails: [],
    missedKeywords: [],
    utteranceOutcomes: [],
    semanticCueDecisions: [],
    semanticEvaluation: {
      state: "unavailable",
      measurementMode: "none",
      reasons: ["evaluation_not_run"],
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
    generatedAt: "2026-07-16T00:00:00.000Z",
  };
}

function measuredSilenceAnalysis(): RehearsalReport["silenceAnalysis"] {
  return {
    metricDefinitionVersion: 2,
    measurementState: "measured",
    reasonCode: null,
    detector: "silero-vad",
    detectorVersion: "6.2.1",
    speechThreshold: 0.5,
    minimumSilenceMs: 250,
    longSilenceMs: 5000,
    analysisWindowStartSeconds: 0.5,
    analysisWindowEndSeconds: 11,
    totalSilenceSeconds: 5.6,
    silenceRatio: 0.5333,
    longSilenceCount: 1,
    detectedSegmentCount: 2,
    segmentsTruncated: false,
    segments: [
      {
        category: "brief",
        startSeconds: 1,
        endSeconds: 1.4,
        durationSeconds: 0.4,
      },
      {
        category: "long",
        startSeconds: 5,
        endSeconds: 10.2,
        durationSeconds: 5.2,
      },
    ],
  };
}

function legacyMeasuredSilenceAnalysis(): RehearsalReport["silenceAnalysis"] {
  return {
    metricDefinitionVersion: 1,
    measurementState: "measured",
    reasonCode: null,
    detector: "silero-vad",
    detectorVersion: "6.2.1",
    speechThreshold: 0.5,
    minimumSilenceMs: 250,
    longSilenceMs: 1000,
    analysisWindowStartSeconds: 0.5,
    analysisWindowEndSeconds: 4,
    totalSilenceSeconds: 1.2,
    silenceRatio: 0.3429,
    longSilenceCount: 1,
    detectedSegmentCount: 1,
    segmentsTruncated: false,
    segments: [
      {
        category: "long",
        startSeconds: 1,
        endSeconds: 2.2,
        durationSeconds: 1.2,
      },
    ],
  };
}
