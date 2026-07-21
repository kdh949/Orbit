import { describe, expect, it } from "vitest";
import {
  calculateNormalizedKoreanCer,
  normalizeCerText,
  summarizeRealtimeWhisperMetrics
} from "./realtimeWhisperSpikeMetrics";

describe("realtimeWhisperSpikeMetrics", () => {
  it("summarizes first-delta, commit-to-final, and end-to-end latency", () => {
    expect(
      summarizeRealtimeWhisperMetrics([
        {
          turnId: 1,
          itemId: "item_1",
          speechStartedAtMs: 100,
          firstDeltaAtMs: 300,
          committedAtMs: 600,
          completedAtMs: 800,
          transcript: "첫 문장",
          partialCount: 2
        },
        {
          turnId: 2,
          itemId: "item_2",
          speechStartedAtMs: 1000,
          firstDeltaAtMs: 1400,
          committedAtMs: 1700,
          completedAtMs: 2100,
          transcript: "둘째 문장",
          partialCount: 3
        }
      ])
    ).toEqual({
      completedTurns: 2,
      firstDeltaLatencyMedianMs: 200,
      firstDeltaLatencyP95Ms: 400,
      commitToFinalMedianMs: 200,
      commitToFinalP95Ms: 400,
      onsetToFinalMedianMs: 700,
      onsetToFinalP95Ms: 1100
    });
  });

  it("calculates Korean CER after removing spacing and punctuation noise", () => {
    expect(normalizeCerText("안녕하세요, ORBIT! ")).toBe("안녕하세요orbit");
    expect(calculateNormalizedKoreanCer("오르빗입니다", "오르빗 입니다."))
      .toBe(0);
    expect(calculateNormalizedKoreanCer("가나다", "가마"))
      .toBeCloseTo(2 / 3);
  });
});
