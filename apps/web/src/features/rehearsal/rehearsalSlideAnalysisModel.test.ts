import type { Deck, RehearsalReport } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import {
  buildFiveSecondLongSilenceCountBySlide,
  buildRehearsalSlideAnalysisCards,
} from "./rehearsalSlideAnalysisModel";

describe("five-second silence slide analysis", () => {
  it("ignores legacy one-second counts and attributes only five-second segments", () => {
    const report = legacyReport();
    const counts = buildFiveSecondLongSilenceCountBySlide(report);

    expect(Object.fromEntries(counts ?? [])).toEqual({
      slide_1: 0,
      slide_2: 1,
    });

    const cards = buildRehearsalSlideAnalysisCards(deck(), [], report);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.slideId).toBe("slide_2");
    expect(cards[0]?.signalTags).toContain("긴 침묵 1회");
    expect(cards[0]?.feedbackItems).toContain(
      "5초 이상 발화가 없었던 구간이 1회 있었습니다. 다음 문장 연결어를 미리 준비해 두는 편이 좋습니다.",
    );
  });

  it("does not derive slide silence counts when audio analysis is unmeasured", () => {
    const report = legacyReport();
    report.silenceAnalysis = {
      ...report.silenceAnalysis,
      measurementState: "unmeasured",
      reasonCode: "LEGACY_REPORT",
      analysisWindowStartSeconds: null,
      analysisWindowEndSeconds: null,
      totalSilenceSeconds: null,
      silenceRatio: null,
      longSilenceCount: null,
      detectedSegmentCount: null,
      segmentsTruncated: false,
      segments: [],
    };

    expect(buildFiveSecondLongSilenceCountBySlide(report)).toBeNull();
  });
});

function deck(): Deck {
  return {
    deckId: "deck_1",
    projectId: "project_1",
    title: "발표",
    slides: [
      { slideId: "slide_1", order: 1, title: "도입", thumbnailUrl: "" },
      { slideId: "slide_2", order: 2, title: "본론", thumbnailUrl: "" },
    ],
  } as unknown as Deck;
}

function legacyReport(): RehearsalReport {
  return {
    metrics: { durationSeconds: 20 },
    missedKeywords: [],
    slideTimings: [
      { slideId: "slide_1", actualSeconds: 10, targetSeconds: 10 },
      { slideId: "slide_2", actualSeconds: 10, targetSeconds: 10 },
    ],
    slideInsights: [
      {
        slideId: "slide_1",
        fillerWordCount: 0,
        longSilenceCount: 1,
      },
      {
        slideId: "slide_2",
        fillerWordCount: 0,
        longSilenceCount: 0,
      },
    ],
    silenceAnalysis: {
      metricDefinitionVersion: 1,
      measurementState: "measured",
      reasonCode: null,
      detector: "silero-vad",
      detectorVersion: "legacy",
      speechThreshold: 0.5,
      minimumSilenceMs: 250,
      longSilenceMs: 1000,
      analysisWindowStartSeconds: 0,
      analysisWindowEndSeconds: 20,
      totalSilenceSeconds: 6.2,
      silenceRatio: 0.31,
      longSilenceCount: 2,
      detectedSegmentCount: 2,
      segmentsTruncated: false,
      segments: [
        {
          category: "long",
          startSeconds: 2,
          endSeconds: 3,
          durationSeconds: 1,
        },
        {
          category: "long",
          startSeconds: 11,
          endSeconds: 16.2,
          durationSeconds: 5.2,
        },
      ],
    },
  } as unknown as RehearsalReport;
}