import type { Deck, RehearsalReport } from "@orbit/shared";
import { describe, expect, it } from "vitest";
import { buildLongSilenceDetails } from "./RehearsalReportTestMetricDetails";

describe("buildLongSilenceDetails", () => {
  it("5초 이상 침묵을 발생한 슬라이드 시간 구간에 연결한다", () => {
    const deck = {
      slides: [{ slideId: "slide_1" }, { slideId: "slide_2" }],
    } as unknown as Deck;
    const report = {
      metrics: { durationSeconds: 20 },
      silenceAnalysis: {
        segments: [
          { durationSeconds: 4, endSeconds: 9, startSeconds: 5 },
          { durationSeconds: 6, endSeconds: 18, startSeconds: 12 },
        ],
      },
      slideTimings: [
        { actualSeconds: 10, slideId: "slide_1", targetSeconds: 10 },
        { actualSeconds: 10, slideId: "slide_2", targetSeconds: 10 },
      ],
    } as unknown as RehearsalReport;

    const details = buildLongSilenceDetails(deck, report);

    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      durationSeconds: 6,
      slideIndex: 1,
      startSeconds: 12,
    });
  });
});
