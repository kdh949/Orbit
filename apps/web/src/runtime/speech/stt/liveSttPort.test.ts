import { describe, expect, it } from "vitest";
import {
  LiveSttError,
  mapPartialTranscriptToLiveSttResult,
  normalizeLiveSttBiasPhrases,
} from "./liveSttPort";

describe("liveSttPort", () => {
  it("partial transcript event를 LiveSttResult로 변환한다", () => {
    expect(
      mapPartialTranscriptToLiveSttResult(
        {
          type: "partial-transcript",
          transcript: "오르빗 발표",
          isFinal: true,
          confidence: 0.72,
        },
        1500,
      ),
    ).toEqual({
      text: "오르빗 발표",
      isFinal: true,
      confidence: 0.72,
      timestampMs: [1500, 1500],
    });
  });

  it("confidence가 null이면 결과에서 생략한다", () => {
    expect(
      mapPartialTranscriptToLiveSttResult(
        {
          type: "partial-transcript",
          transcript: "중간 인식",
          isFinal: false,
          confidence: null,
        },
        250,
      ),
    ).toEqual({
      text: "중간 인식",
      isFinal: false,
      timestampMs: [250, 250],
    });
  });

  it("bias phrase를 trim, 공백 정규화, 중복 제거한다", () => {
    expect(
      normalizeLiveSttBiasPhrases([
        { text: "  오르빗  ", weight: 1 },
        { text: "오르빗", weight: 1 },
        { text: "Live   STT", weight: 1 },
        { text: "", weight: 1 },
      ]),
    ).toEqual([
      { text: "오르빗", weight: 1 },
      { text: "Live STT", weight: 1 },
    ]);
  });

  it("weighted bias phrase metadata를 보존하고 높은 weight 중복을 유지한다", () => {
    expect(
      normalizeLiveSttBiasPhrases([
        {
          text: "  결재  ",
          weight: 0.4,
          source: "keyword",
          keywordId: "kw_old",
          canonicalText: "결재",
        },
        {
          text: "결재",
          weight: 1.4,
          source: "synonym",
          keywordId: "kw_new",
          canonicalText: "결제",
        },
        {
          text: "Live   STT",
          weight: -0.2,
          source: "legacy",
        },
      ]),
    ).toEqual([
      {
        text: "결재",
        weight: 1,
        source: "synonym",
        keywordId: "kw_new",
        canonicalText: "결제",
      },
      {
        text: "Live STT",
        weight: 0,
        source: "legacy",
      },
    ]);
  });

  it("typed error 이름을 고정한다", () => {
    const error = new LiveSttError("start_failed", "시작 실패");

    expect(error.name).toBe("LiveSttError");
    expect(error.code).toBe("start_failed");
    expect(error.message).toBe("시작 실패");
  });
});
