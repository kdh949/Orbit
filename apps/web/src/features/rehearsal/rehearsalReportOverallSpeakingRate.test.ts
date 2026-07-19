import { describe, expect, it } from "vitest";
import { resolveOverallSpeakingRate } from "./rehearsalReportOverallSpeakingRate";

type SlideRateOptions = {
  activeSpeechSeconds: number;
  characterCount: number;
  charactersPerSecond?: number | null;
  measurementState?: "measured" | "unmeasured";
  reasonCode?: string | null;
};

function makeInput(options: {
  charactersPerMinute?: number | null;
  measurementState?: "measured" | "unmeasured";
  slides?: SlideRateOptions[];
}) {
  return {
    metrics: {
      charactersPerMinute: options.charactersPerMinute ?? null,
      measurements: {
        charactersPerMinute: {
          measurementState: options.measurementState ?? "unmeasured",
        },
      },
    },
    slideInsights: (options.slides ?? []).map((speakingRate) => ({
      speakingRate: {
        activeSpeechSeconds: speakingRate.activeSpeechSeconds,
        characterCount: speakingRate.characterCount,
        charactersPerSecond: speakingRate.charactersPerSecond ?? null,
        measurementState: speakingRate.measurementState ?? "unmeasured",
        reasonCode: speakingRate.reasonCode ?? "INSUFFICIENT_SLIDE_SPEECH",
      },
    })),
  };
}

describe("resolveOverallSpeakingRate", () => {
  it("측정된 전체 발화 속도를 우선 사용한다", () => {
    expect(
      resolveOverallSpeakingRate(
        makeInput({
          charactersPerMinute: 318.4,
          measurementState: "measured",
          slides: [{ activeSpeechSeconds: 10, characterCount: 10 }],
        }),
      ),
    ).toEqual({
      charactersPerMinute: 318,
      slideCount: 0,
      source: "overall",
    });
  });

  it("슬라이드 화면에 표시되는 속도만 평균낸다", () => {
    expect(
      resolveOverallSpeakingRate(
        makeInput({
          slides: [
            {
              activeSpeechSeconds: 30,
              characterCount: 100,
              charactersPerSecond: 4.28,
              measurementState: "measured",
              reasonCode: null,
            },
            {
              activeSpeechSeconds: 20,
              characterCount: 40,
              charactersPerSecond: 4.53,
              measurementState: "measured",
              reasonCode: null,
            },
            {
              activeSpeechSeconds: 1,
              characterCount: 8,
              measurementState: "unmeasured",
              reasonCode: "INSUFFICIENT_SLIDE_SPEECH",
            },
          ],
        }),
      ),
    ).toEqual({
      charactersPerMinute: 265,
      slideCount: 2,
      source: "slide-average",
    });
  });

  it("기준 슬라이드 부족으로 비교만 불가능한 속도는 평균에 포함한다", () => {
    expect(
      resolveOverallSpeakingRate(
        makeInput({
          slides: [
            {
              activeSpeechSeconds: 10,
              characterCount: 40,
              measurementState: "unmeasured",
              reasonCode: "BASELINE_UNAVAILABLE",
            },
          ],
        }),
      ),
    ).toEqual({
      charactersPerMinute: 240,
      slideCount: 1,
      source: "slide-average",
    });
  });

  it("화면에 표시할 수 있는 슬라이드 속도가 없으면 확인 불가를 반환한다", () => {
    expect(resolveOverallSpeakingRate(makeInput({}))).toEqual({
      charactersPerMinute: null,
      slideCount: 0,
      source: "unavailable",
    });
  });
});
