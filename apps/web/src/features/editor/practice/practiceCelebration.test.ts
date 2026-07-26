import type { SlidePracticeReportRecord } from "@orbit/shared/slide-practice";
import { describe, expect, it } from "vitest";

import {
  practiceCelebrationAnimationSession,
  practiceCelebrationOutcome,
} from "./practiceCelebration";

describe("practice celebration", () => {
  it("모든 조건을 만족한 v3 기록만 GREAT로 판정한다", () => {
    expect(practiceCelebrationOutcome(report())).toEqual({
      great: true,
      noFiller: true,
    });
  });

  it.each([
    ["legacy", { reportVersion: 2, metricDefinitionVersion: 2 }],
    ["unmeasured", { quality: { state: "unmeasured", reasons: ["insufficient-speech"] } }],
    ["short speech", { voice: { activeSpeechMs: 4_999 } }],
    ["filler total", { fillers: { totalCount: 1, details: [{ word: "음", count: 1 }] } }],
  ])("%s 기록은 no-filler 성공으로 처리하지 않는다", (_label, patch) => {
    expect(practiceCelebrationOutcome(report(patch)).noFiller).toBe(false);
  });

  it("no-filler와 GREAT를 분리하고 3.0 dB 경계를 포함한다", () => {
    expect(practiceCelebrationOutcome(report({ voice: { loudnessMadDb: 3 } }))).toEqual({
      great: true,
      noFiller: true,
    });
    expect(practiceCelebrationOutcome(report({ voice: { loudnessMadDb: 3.01 } }))).toEqual({
      great: false,
      noFiller: true,
    });
    expect(practiceCelebrationOutcome(report({ voice: { pitchSpanHz: null } }))).toEqual({
      great: false,
      noFiller: true,
    });
  });

  it("새 최신 session만 한 번 animation 대상으로 소비한다", () => {
    expect(practiceCelebrationAnimationSession({
      consumedSessionId: null,
      latestSessionId: "practice-2",
      triggerSessionId: "practice-2",
    })).toBe("practice-2");
    expect(practiceCelebrationAnimationSession({
      consumedSessionId: "practice-2",
      latestSessionId: "practice-2",
      triggerSessionId: "practice-2",
    })).toBeNull();
    expect(practiceCelebrationAnimationSession({
      consumedSessionId: null,
      latestSessionId: "practice-2",
      triggerSessionId: null,
    })).toBeNull();
  });
});

type PracticeReportV3Record = Extract<SlidePracticeReportRecord, { reportVersion: 3 }>;

function report(patch: Record<string, unknown> = {}): SlidePracticeReportRecord {
  const base: PracticeReportV3Record = {
    reportVersion: 3,
    metricDefinitionVersion: 3,
    contentHashVersion: "slide-text-v1",
    slideContentHash: "a".repeat(64),
    classifierVersion: 4,
    reportId: "report-1",
    createdBy: "user-1",
    createdAt: "2026-07-21T12:00:10.000Z",
    expiresAt: "2026-10-19T12:00:00.000Z",
    practiceSessionId: "practice-1",
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
    style: {
      mode: "neutral",
      confidence: 0,
      evidenceLabels: ["판단 보류"],
      message: "판단을 보류했습니다.",
    },
    quality: { state: "measured", reasons: [] },
    source: {
      kind: "server",
      sttEngine: "report-stt",
      deviceIdHash: null,
      baselineVersion: null,
    },
  };
  return {
    ...base,
    ...patch,
    fillers: { ...base.fillers, ...(patch.fillers as object | undefined) },
    voice: { ...base.voice, ...(patch.voice as object | undefined) },
  } as SlidePracticeReportRecord;
}
