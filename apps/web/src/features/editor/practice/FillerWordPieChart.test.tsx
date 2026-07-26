import type { SlidePracticeReport } from "@orbit/shared/slide-practice";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildFillerWordChartItems,
  FillerWordPieChart,
} from "./FillerWordPieChart";
import { PracticeResult } from "./SlidePracticePanel";

describe("FillerWordPieChart", () => {
  it("습관어가 3개면 3개 항목만 표시한다", () => {
    const html = renderToStaticMarkup(
      <FillerWordPieChart
        totalCount={6}
        details={[
          { word: "음", count: 3 },
          { word: "어", count: 2 },
          { word: "그러니까", count: 1 },
        ]}
      />,
    );

    expect(html.match(/editor-practice-filler-legend-item/g)).toHaveLength(3);
    expect(html).toContain("음");
    expect(html).toContain("3회");
    expect(html).not.toContain("기타");
  });

  it("습관어가 6개 이상이면 상위 5개와 기타로 묶는다", () => {
    const items = buildFillerWordChartItems([
      { word: "음", count: 6 },
      { word: "어", count: 5 },
      { word: "그", count: 4 },
      { word: "그러니까", count: 3 },
      { word: "뭐랄까", count: 2 },
      { word: "약간", count: 2 },
      { word: "아", count: 1 },
    ], 23);

    expect(items).toHaveLength(6);
    expect(items.at(-1)).toMatchObject({ word: "기타", count: 3 });
  });

  it("습관어가 없으면 빈 상태를 표시한다", () => {
    const html = renderToStaticMarkup(
      <FillerWordPieChart totalCount={0} details={[]} />,
    );

    expect(html).toContain("감지된 습관어가 없습니다.");
    expect(html).not.toContain("<svg");
  });

  it("슬라이드 리포트에는 데시벨, 말 속도, 개선할 점만 표시한다", () => {
    const html = renderToStaticMarkup(<PracticeResult report={practiceReport()} />);

    expect(html).toContain("데시벨 변화");
    expect(html).toContain("말 속도 변화");
    expect(html).toContain("개선할 점");
    expect(html).toContain("시간별 데시벨 세로 막대 그래프");
    expect(html).toContain("시간별 말 속도 선 그래프");
    expect(html).toContain("습관어 줄이기");
    expect(html).toContain("측정된 실제 대본");
    expect(html).toContain("대본과 연결한 방법");
    expect(html).toContain("다른 연습 방법");
    expect(html).toContain("말 속도");
    expect(html).toContain("음량 변화폭");
    expect(html).toContain("리듬 규칙성");
    expect(html).not.toContain("30초 연습");
    expect(html).not.toContain("습관어 사용 비율");
    expect(html).not.toContain("판단 근거");
    expect(html).not.toContain(">AI 코칭<");
    expect(html).not.toContain("권장 범위");
  });

  it("이전 기록은 그래프와 AI 코칭이 없는 상태를 명시한다", () => {
    const baseReport = practiceReport();
    const html = renderToStaticMarkup(<PracticeResult report={{
      ...baseReport,
      reportVersion: 1,
      loudnessSamples: undefined,
      speedSamples: undefined,
      coaching: undefined,
    }} />);

    expect(html).toContain(
      "이전 분석 버전의 기록이라 시간별 데시벨 그래프가 없습니다. 새 연습부터 제공됩니다.",
    );
    expect(html).toContain(
      "이전 분석 버전의 기록이라 시간별 말 속도 그래프가 없습니다. 새 연습부터 제공됩니다.",
    );
    expect(html).toContain("이전 연습 기록에는 AI 개선점이 없습니다.");
  });

  it("v2 분석 실패는 그래프가 비어 있는 실제 이유를 표시한다", () => {
    const baseReport = practiceReport();
    const html = renderToStaticMarkup(<PracticeResult report={{
      ...baseReport,
      loudnessSamples: [],
      speedSamples: [],
      quality: {
        state: "partial",
        reasons: ["audio-analysis-unavailable", "stt-unavailable"],
      },
    }} />);

    expect(html).toContain(
      "오디오를 해석하지 못해 시간별 데시벨 데이터를 만들지 못했습니다.",
    );
    expect(html).toContain(
      "음성 전사를 사용할 수 없어 말 속도 그래프를 만들지 못했습니다.",
    );
  });

  it("v2 발화량이 부족하면 충분한 연습 시간을 안내한다", () => {
    const baseReport = practiceReport();
    const html = renderToStaticMarkup(<PracticeResult report={{
      ...baseReport,
      speedSamples: [],
      quality: {
        state: "unmeasured",
        reasons: ["insufficient-speech"],
      },
    }} />);

    expect(html).toContain(
      "발화량이 부족해 말 속도 그래프를 만들지 못했습니다. 10초 이상 말해 주세요.",
    );
  });

  it("개선점이 없으면 승인된 성공 문구를 그대로 표시한다", () => {
    const baseReport = practiceReport();
    const html = renderToStaticMarkup(<PracticeResult report={{
      ...baseReport,
      coaching: {
        status: "not-needed",
        summary: "정말 잘했어요 개선점이 없어요!!",
        issueCodes: [],
        items: [],
        practicePlan: null,
        model: null,
        policyVersion: 1,
        promptVersion: 1,
        generatedAt: null,
      },
    }} />);

    expect(html).toContain("정말 잘했어요 개선점이 없어요!!");
  });
});

type LegacySlidePracticeReport = Exclude<SlidePracticeReport, { reportVersion: 3 }>;

function practiceReport(): LegacySlidePracticeReport {
  return {
    reportVersion: 2,
    metricDefinitionVersion: 1,
    classifierVersion: 1,
    practiceSessionId: "practice-1",
    projectId: "project-1",
    deckId: "deck-1",
    deckVersion: 1,
    slideId: "slide-1",
    slideOrder: 0,
    startedAt: "2026-07-17T00:00:00.000Z",
    durationMs: 10_000,
    syllableCount: 50,
    meanRecognitionConfidence: 0.9,
    fillers: {
      policyVersion: 1,
      totalCount: 3,
      details: [{ word: "음", count: 3 }],
    },
    voice: {
      activeSpeechMs: 1_300,
      pauseRatio: 0.87,
      pitchMedianHz: 120,
      pitchSpanHz: 34.3,
      pitchValidRatio: 0.9,
      loudnessDb: -20,
      loudnessMadDb: 2,
      syllablesPerSecond: 17.5,
      signalToNoiseDb: 18,
      breathinessRatio: 0.1,
      clarityRatio: 0.9,
      rhythmRegularity: 0.8,
      clippingRatio: 0,
    },
    loudnessSamples: [
      { startMs: 0, endMs: 1_000, loudnessDb: -48 },
      { startMs: 1_000, endMs: 2_000, loudnessDb: -38 },
      { startMs: 2_000, endMs: 3_000, loudnessDb: -26 },
    ],
    speedSamples: [
      { startMs: 0, endMs: 5_000, syllablesPerSecond: 3.8 },
      { startMs: 5_000, endMs: 10_000, syllablesPerSecond: 4.4 },
    ],
    coaching: {
      status: "succeeded",
      summary: "습관어를 줄이면 핵심이 더 분명해집니다.",
      issueCodes: ["filler-use"],
      items: [{
        category: "filler",
        title: "습관어 줄이기",
        reason: "연결 표현이 반복됩니다.",
        action: "핵심 문장부터 시작해 보세요.",
        practiceTip: "추천 문장을 세 번 읽어 보세요.",
        scriptEdit: null,
        scriptEvidence: {
          originalText: "그러니까 이 기능을 통해서 사용자 경험을 개선할 수 있습니다.",
          alignment: "matched",
          startMs: 0,
          endMs: 3_000,
          issueCodes: ["filler-use"],
          metrics: {
            syllablesPerSecond: 5.2,
            loudnessDb: -34,
            pauseBeforeMs: null,
            pauseAfterMs: 300,
            pitchSpanHz: 34.3,
            fillerTotalCount: 3,
            fillerWords: ["음"],
            loudnessVariationDb: 2,
            rhythmRegularity: 0.8,
          },
        },
      }],
      practicePlan: null,
      model: "gpt-test",
      policyVersion: 1,
      promptVersion: 2,
      generatedAt: "2026-07-17T00:00:10.000Z",
    },
    style: {
      mode: "lullaby",
      confidence: 0.8,
      evidenceLabels: ["낮은 말 속도"],
      message: "자장가처럼 차분해요.",
    },
    quality: { state: "measured", reasons: [] },
    source: {
      kind: "browser",
      sttEngine: "web-speech",
      deviceIdHash: null,
      baselineVersion: null,
    },
  };
}
