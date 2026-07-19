import {
  legacyRehearsalReportMetricsDefaults,
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
  type RehearsalReport,
} from "@orbit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  RehearsalVolumeOverview,
  selectRepresentativeVolumeIssues,
} from "./RehearsalVolumeOverview";

describe("RehearsalVolumeOverview", () => {
  it("shows only five representative volume issues in time order", () => {
    const html = renderToStaticMarkup(
      <RehearsalVolumeOverview
        formatDuration={(seconds) => `${seconds}s`}
        report={reportFixture(measuredVolumeAnalysis())}
      />,
    );

    expect(html).toContain(
      "전체 발화보다 작게 말한 주요 구간</span><strong>2<em>개",
    );
    expect(html).toContain(
      "전체 발화보다 크게 말한 주요 구간</span><strong>3<em>개",
    );
    expect(html.match(/rrd-volume-issue is-/g)).toHaveLength(5);
    expect(html).toContain("이 구간 들어보기");
    expect(html).not.toContain("dBFS");
    expect(html).not.toContain("averageDbfs");
  });

  it("merges nearby same-kind issues and removes one-second noise", () => {
    const issues = selectRepresentativeVolumeIssues([
      issue("quiet", 0, 1.2),
      issue("quiet", 2, 3.2),
      issue("loud", 5, 6),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "quiet",
      startSeconds: 0,
      endSeconds: 3.2,
      durationSeconds: 3.2,
    });
  });
  it("shows an unavailable recording state instead of playback controls", () => {
    const html = renderToStaticMarkup(
      <RehearsalVolumeOverview
        audioPlaybackAvailable={false}
        formatDuration={(seconds) => `${seconds}s`}
        report={reportFixture(measuredVolumeAnalysis())}
      />,
    );

    expect(html).toContain("녹음 재생 불가");
    expect(html).not.toContain("이 구간 들어보기");
  });

  it("distinguishes legacy and measured empty reports", () => {
    const legacyHtml = renderToStaticMarkup(
      <RehearsalVolumeOverview
        formatDuration={(seconds) => `${seconds}s`}
        report={reportFixture(legacyRehearsalVolumeAnalysis)}
      />,
    );
    expect(legacyHtml).toContain("음량 분석 기능이 적용되기 전에");

    const emptyHtml = renderToStaticMarkup(
      <RehearsalVolumeOverview
        formatDuration={(seconds) => `${seconds}s`}
        report={reportFixture({
          ...measuredVolumeAnalysis(),
          issueSegments: [],
        })}
      />,
    );
    expect(emptyHtml).toContain("음량 변화가 큰 구간이 없었어요");
  });
});

function reportFixture(
  volumeAnalysis: RehearsalReport["volumeAnalysis"],
): RehearsalReport {
  return {
    reportId: "report_1",
    runId: "run_1",
    projectId: "project_1",
    deckId: "deck_1",
    transcriptRetained: false,
    transcript: null,
    volumeAnalysis,
    silenceAnalysis: legacyRehearsalSilenceAnalysis,
    metrics: {
      ...legacyRehearsalReportMetricsDefaults,
      durationSeconds: 20,
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

function measuredVolumeAnalysis(): RehearsalReport["volumeAnalysis"] {
  return {
    metricDefinitionVersion: 2,
    measurementState: "measured",
    reasonCode: null,
    averageDbfs: -21,
    baselineDbfs: -20,
    variationDb: 9,
    activeRatio: 0.8,
    issueSegments: [
      issue("quiet", 0, 2),
      issue("loud", 3, 5),
      issue("quiet", 6, 9),
      issue("loud", 10, 12),
      issue("quiet", 13, 15),
      issue("loud", 16, 20),
    ],
  };
}

function issue(
  kind: "quiet" | "loud",
  startSeconds: number,
  endSeconds: number,
): RehearsalReport["volumeAnalysis"]["issueSegments"][number] {
  return {
    kind,
    startSeconds,
    endSeconds,
    durationSeconds: endSeconds - startSeconds,
    meanDeviationDb: kind === "quiet" ? -7 : 7,
  };
}
