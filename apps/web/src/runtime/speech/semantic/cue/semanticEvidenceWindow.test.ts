import { describe, expect, it } from "vitest";

import { createSemanticEvidenceWindow } from "./semanticEvidenceWindow";

describe("semanticEvidenceWindow", () => {
  it("같은 슬라이드의 final segment를 8초 범위에서 결합한다", () => {
    const window = createSemanticEvidenceWindow();

    window.accept("slide_1", {
      text: "CAC가 높은 원인은",
      isFinal: true,
      timestampMs: [1_000, 3_000]
    });
    const evidence = window.accept("slide_1", {
      text: "초기 영업 비용입니다.",
      isFinal: true,
      timestampMs: [3_100, 5_000]
    });

    expect(evidence).toEqual({
      transcript: "CAC가 높은 원인은 초기 영업 비용입니다.",
      startMs: 1_000,
      endMs: 5_000
    });
  });

  it("오래된 segment를 버리고 transcript를 600자로 제한한다", () => {
    const window = createSemanticEvidenceWindow();
    window.accept("slide_1", {
      text: "오래된 근거",
      isFinal: true,
      timestampMs: [0, 1_000]
    });
    const evidence = window.accept("slide_1", {
      text: "가".repeat(700),
      isFinal: true,
      timestampMs: [9_000, 10_000]
    });

    expect(evidence.transcript).toHaveLength(600);
    expect(evidence.transcript).not.toContain("오래된 근거");
    expect(evidence.startMs).toBe(9_000);
    expect(evidence.endMs).toBe(10_000);
  });

  it("슬라이드별 증거를 분리한다", () => {
    const window = createSemanticEvidenceWindow();
    window.accept("slide_1", {
      text: "첫 슬라이드",
      isFinal: true,
      timestampMs: [0, 1_000]
    });

    expect(
      window.accept("slide_2", {
        text: "둘째 슬라이드",
        isFinal: true,
        timestampMs: [1_000, 2_000]
      })
    ).toEqual({
      transcript: "둘째 슬라이드",
      startMs: 1_000,
      endMs: 2_000
    });
  });
});
