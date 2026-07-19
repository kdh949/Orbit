import { describe, expect, it } from "vitest";

import {
  rehearsalAudioProcessingResponseSchema,
  rehearsalSilenceAnalysisSchema,
  rehearsalVolumeAnalysisSchema,
} from "./rehearsal-audio-analysis.schema";
import { rehearsalReportSchema } from "./rehearsal.schema";

const measuredVolumeAnalysis = {
  metricDefinitionVersion: 2,
  measurementState: "measured",
  reasonCode: null,
  averageDbfs: -22.4,
  baselineDbfs: -21.8,
  variationDb: 8.3,
  activeRatio: 0.76,
  issueSegments: [
    {
      kind: "quiet",
      startSeconds: 8.1,
      endSeconds: 10.2,
      durationSeconds: 2.1,
      meanDeviationDb: -7.4,
    },
  ],
} as const;

const measuredSilenceAnalysis = {
  metricDefinitionVersion: 2,
  measurementState: "measured",
  reasonCode: null,
  detector: "silero-vad",
  detectorVersion: "6.2.1",
  speechThreshold: 0.5,
  minimumSilenceMs: 250,
  longSilenceMs: 5000,
  analysisWindowStartSeconds: 0.42,
  analysisWindowEndSeconds: 28.31,
  totalSilenceSeconds: 5.34,
  silenceRatio: 0.1915,
  longSilenceCount: 1,
  detectedSegmentCount: 1,
  segmentsTruncated: false,
  segments: [
    {
      category: "long",
      startSeconds: 8.12,
      endSeconds: 13.46,
      durationSeconds: 5.34,
    },
  ],
} as const;

describe("rehearsal volume analysis contract", () => {
  it("accepts a measured audio processing response", () => {
    const response = rehearsalAudioProcessingResponseSchema.parse({
      runId: "run_1",
      projectId: "project_1",
      fileId: "file_1",
      transcript: "발표 전사 결과",
      language: "ko-KR",
      provider: "whisperx",
      model: "large-v3",
      durationSeconds: 30.2,
      segments: [],
      volumeAnalysis: measuredVolumeAnalysis,
      silenceAnalysis: measuredSilenceAnalysis,
    });

    expect(response.volumeAnalysis.measurementState).toBe("measured");
    expect(response.silenceAnalysis.longSilenceCount).toBe(1);
  });

  it("enforces silence measurement and category invariants", () => {
    expect(
      rehearsalSilenceAnalysisSchema.safeParse({
        ...measuredSilenceAnalysis,
        speechThreshold: 0.6,
      }).success,
    ).toBe(false);
    expect(
      rehearsalSilenceAnalysisSchema.safeParse({
        ...measuredSilenceAnalysis,
        longSilenceMs: 1000,
      }).success,
    ).toBe(false);
    expect(
      rehearsalSilenceAnalysisSchema.safeParse({
        ...measuredSilenceAnalysis,
        segments: [
          {
            category: "brief",
            startSeconds: 8.12,
            endSeconds: 13.46,
            durationSeconds: 5.34,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      rehearsalSilenceAnalysisSchema.safeParse({
        ...measuredSilenceAnalysis,
        totalSilenceSeconds: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
  });

  it("rejects inconsistent measured and unmeasured states", () => {
    expect(
      rehearsalVolumeAnalysisSchema.safeParse({
        ...measuredVolumeAnalysis,
        measurementState: "unmeasured",
        reasonCode: "ANALYSIS_FAILED",
      }).success,
    ).toBe(false);
    expect(
      rehearsalVolumeAnalysisSchema.safeParse({
        ...measuredVolumeAnalysis,
        averageDbfs: Number.NaN,
      }).success,
    ).toBe(false);
    expect(
      rehearsalVolumeAnalysisSchema.safeParse({
        ...measuredVolumeAnalysis,
        issueSegments: [
          {
            kind: "quiet",
            startSeconds: 8.1,
            endSeconds: 9.6,
            durationSeconds: 1.5,
            meanDeviationDb: -7.4,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      rehearsalVolumeAnalysisSchema.safeParse({
        ...measuredVolumeAnalysis,
        issueSegments: Array.from({ length: 6 }, (_, index) => ({
          kind: "quiet" as const,
          startSeconds: index * 3,
          endSeconds: index * 3 + 2,
          durationSeconds: 2,
          meanDeviationDb: -7.4,
        })),
      }).success,
    ).toBe(false);
  });

  it("rejects invalid issue segment ranges", () => {
    expect(
      rehearsalVolumeAnalysisSchema.safeParse({
        ...measuredVolumeAnalysis,
        issueSegments: [
          {
            kind: "loud",
            startSeconds: 5,
            endSeconds: 4,
            durationSeconds: 1,
            meanDeviationDb: 8,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("defaults legacy reports to an unmeasured volume analysis", () => {
    const report = rehearsalReportSchema.parse({
      reportId: "report_1",
      runId: "run_1",
      projectId: "project_1",
      deckId: "deck_1",
      transcriptRetained: false,
      transcript: null,
      metrics: {
        durationSeconds: 30,
        wordsPerMinute: 100,
        fillerWordCount: 0,
        pauseCount: 0,
        keywordCoverage: 1,
      },
      coaching: null,
      generatedAt: "2026-07-16T00:00:00.000Z",
    });

    expect(report.volumeAnalysis).toMatchObject({
      measurementState: "unmeasured",
      reasonCode: "LEGACY_REPORT",
    });
    expect(report.silenceAnalysis).toMatchObject({
      measurementState: "unmeasured",
      reasonCode: "LEGACY_REPORT",
    });
  });
});
