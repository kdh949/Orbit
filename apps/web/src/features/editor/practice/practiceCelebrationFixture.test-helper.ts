import type { SlidePracticeReportRecord } from "@orbit/shared/slide-practice";

export function practiceCelebrationReportFixture(): Extract<
  SlidePracticeReportRecord,
  { reportVersion: 3 }
> {
  return {
    reportVersion: 3,
    metricDefinitionVersion: 3,
    contentHashVersion: "slide-text-v1",
    slideContentHash: "a".repeat(64),
    classifierVersion: 4,
    reportId: "report-celebration",
    createdBy: "user-1",
    createdAt: "2026-07-21T12:00:10.000Z",
    expiresAt: "2026-10-19T12:00:00.000Z",
    practiceSessionId: "practice-celebration",
    projectId: "project-1",
    deckId: "deck-1",
    deckVersion: 1,
    slideId: "slide-1",
    slideOrder: 1,
    startedAt: "2026-07-21T12:00:00.000Z",
    durationMs: 60_000,
    syllableCount: 100,
    meanRecognitionConfidence: 0.9,
    fillers: { policyVersion: 1, totalCount: 0, details: [] },
    voice: {
      activeSpeechMs: 50_000,
      pauseRatio: 0.2,
      pitchMedianHz: 170,
      pitchSpanHz: 80,
      pitchValidRatio: 0.8,
      loudnessDb: -36,
      loudnessMadDb: 2.4,
      syllablesPerSecond: 4.2,
      signalToNoiseDb: 20,
      breathinessRatio: 0.2,
      clarityRatio: 0.8,
      rhythmRegularity: 0.7,
      clippingRatio: 0,
    },
    style: { mode: "neutral", confidence: 0, evidenceLabels: [], message: "" },
    quality: { state: "measured", reasons: [] },
    source: {
      kind: "server",
      sttEngine: "report-stt",
      deviceIdHash: null,
      baselineVersion: null,
    },
  };
}
