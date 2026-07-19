import { createDemoDeck } from "@orbit/editor-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  RehearsalSlideTimingOverview,
  speakingRateLabel,
} from "./RehearsalSlideTimingOverview";

const deck = createDemoDeck();
const firstSlide = deck.slides[0]!;
const secondSlide = deck.slides[1]!;

const unsupportedSpeakingRate = {
  metricDefinitionVersion: 1 as const,
  measurementState: "unmeasured" as const,
  reasonCode: "UNSUPPORTED_LANGUAGE" as const,
  charactersPerSecond: null,
  baselineCharactersPerSecond: null,
  relativeRateRatio: null,
  paceCategory: null,
  activeSpeechSeconds: 0,
  characterCount: 0,
};

describe("RehearsalSlideTimingOverview", () => {
  it("renders the graph and slide selector as one compact timing explorer", () => {
    const html = renderTimingOverview();

    expect(html).toContain("rrd-timing-explorer");
    expect(html).toContain('aria-label="소요 시간 슬라이드 선택"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("rrd-timing-slide-option-times");
    expect(html).toContain("권장 이내");
    expect(html).toContain("1번 슬라이드");
    expect(html).toContain("소요</dt><dd>27초");
    expect(html).toContain("권장</dt><dd>1분 15초");
    expect(html).toContain("권장보다 48초 짧아요");
    expect(html).not.toContain("rrd-slide-detail-list");
    expect(html).toContain("rrd-overview-panel-wide");
  });

  it("maps every speaking-rate state independently from slide selection", () => {
    expect(speakingRateLabel(unsupportedSpeakingRate)).toBe(
      "발화 언어를 확인할 수 없어요",
    );
    expect(
      speakingRateLabel({
        metricDefinitionVersion: 1,
        measurementState: "measured",
        reasonCode: null,
        charactersPerSecond: 5,
        baselineCharactersPerSecond: 4,
        relativeRateRatio: 1.25,
        paceCategory: "faster",
        activeSpeechSeconds: 10,
        characterCount: 50,
      }),
    ).toBe("이번 발표 기준보다 빠른 편");
  });

  it("keeps speaking-rate failure copy scoped to the selected slide summary", () => {
    const html = renderTimingOverview();

    expect(html).toContain("발화 언어를 확인할 수 없어요");
    expect(html).not.toContain("분석할 발화가 부족해요");
  });
});

function renderTimingOverview() {
  return renderToStaticMarkup(
    <RehearsalSlideTimingOverview
      deck={deck}
      formatDuration={(seconds) => {
        const rounded = Math.round(seconds);
        const minutes = Math.floor(rounded / 60);
        const remainingSeconds = rounded % 60;
        return minutes > 0
          ? `${minutes}분 ${remainingSeconds.toString().padStart(2, "0")}초`
          : `${remainingSeconds}초`;
      }}
      slideTimings={[
        { slideId: firstSlide.slideId, targetSeconds: 75, actualSeconds: 27 },
        { slideId: secondSlide.slideId, targetSeconds: 75, actualSeconds: 46 },
      ]}
      slideInsights={[
        {
          slideId: firstSlide.slideId,
          fillerWordCount: 0,
          longSilenceCount: 0,
          speakingRate: unsupportedSpeakingRate,
        },
        {
          slideId: secondSlide.slideId,
          fillerWordCount: 0,
          longSilenceCount: 0,
          speakingRate: unsupportedSpeakingRate,
        },
      ]}
    />,
  );
}
