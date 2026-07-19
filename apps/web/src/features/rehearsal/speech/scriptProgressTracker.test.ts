import { describe, expect, it } from "vitest";

import { createScriptProgressTracker } from "./scriptProgressTracker";
import type { PronunciationLexiconEntry } from "@orbit/shared";

describe("scriptProgressTracker", () => {
  it("partial 결과로 원문 위치를 단조 증가시킨다", () => {
    const tracker = createScriptProgressTracker(
      "오늘은 오르빗의 실시간 리허설 진행을 설명합니다.",
    );

    const first = tracker.acceptResult({
      text: "오늘은 오르빗의",
      isFinal: false,
    });
    const unrelated = tracker.acceptResult({
      text: "완전히 다른 이야기",
      isFinal: false,
    });

    expect(first.charOffset).toBeGreaterThan(0);
    expect(first).toMatchObject({
      sentenceId: "sentence_1",
      sentenceTotalChars: 26
    });
    expect(unrelated.charOffset).toBe(first.charOffset);
  });

  it("문자와 단어 fuzzy match를 함께 사용한다", () => {
    const tracker = createScriptProgressTracker(
      "생성형 AI 초안을 안정적으로 추적합니다.",
    );

    const first = tracker.acceptResult({
      text: "생성형 AI 초안를 안정적으러 추적합니다",
      isFinal: false
    });
    const confirmed = tracker.acceptResult({
      text: "생성형 AI 초안를 안정적으러 추적합니다",
      isFinal: true,
    });

    expect(first.confidence).toBe("candidate");
    expect(confirmed.confidence).toBe("confirmed");
    expect(confirmed.ratio).toBeGreaterThan(0.8);
  });

  it("큰 점프는 반복 결과가 합의할 때까지 확정하지 않는다", () => {
    const script =
      "첫 번째 근거를 설명하고 두 번째 지표를 비교한 뒤 마지막 결론을 전달합니다.";
    const tracker = createScriptProgressTracker(script);

    const candidate = tracker.acceptResult({ text: script, isFinal: false });
    const confirmed = tracker.acceptResult({ text: script, isFinal: true });

    expect(candidate).toMatchObject({ charOffset: 0, confidence: "candidate" });
    expect(confirmed.charOffset).toBe(confirmed.totalChars);
    expect(confirmed.confidence).toBe("confirmed");
  });

  it("final 이후 다음 발화는 확정 위치부터 이어서 매칭한다", () => {
    const tracker = createScriptProgressTracker(
      "첫 번째 흐름을 설명합니다. 두 번째 결과를 확인합니다.",
    );

    tracker.acceptResult({ text: "첫 번째 흐름을 설명합니다", isFinal: false });
    const firstFinal = tracker.acceptResult({
      text: "첫 번째 흐름을 설명합니다",
      isFinal: true,
    });
    tracker.acceptResult({ text: "두 번째 결과를 확인합니다", isFinal: false });
    const secondFinal = tracker.acceptResult({
      text: "두 번째 결과를 확인합니다",
      isFinal: true
    });

    expect(secondFinal.charOffset).toBeGreaterThan(firstFinal.charOffset);
    expect(secondFinal.ratio).toBeGreaterThan(0.9);
    expect(secondFinal).toMatchObject({
      sentenceId: "sentence_2",
      sentenceRatio: 1
    });
  });

  it("슬라이드 재방문 시 진행 상태를 초기화한다", () => {
    const tracker = createScriptProgressTracker("오르빗 리허설을 시작합니다.");
    tracker.acceptResult({
      text: "오르빗 리허설을 시작합니다",
      isFinal: false
    });
    tracker.acceptResult({ text: "오르빗 리허설을 시작합니다", isFinal: true });

    tracker.reset();

    expect(tracker.snapshot()).toMatchObject({
      charOffset: 0,
      confidence: "none",
      ratio: 0,
      sentenceId: "sentence_1",
      sentenceCharOffset: 0,
      sentenceRatio: 0
    });
  });

  it("canonical 문장 offset을 기준으로 현재 문장 진행률을 계산한다", () => {
    const tracker = createScriptProgressTracker(
      "첫 번째 문장을 설명합니다. 두 번째 문장을 정리합니다."
    );

    tracker.acceptResult({ text: "첫 번째 문장을 설명합니다", isFinal: false });
    const first = tracker.acceptResult({
      text: "첫 번째 문장을 설명합니다",
      isFinal: true
    });

    expect(first).toMatchObject({
      sentenceId: "sentence_1",
      sentenceRatio: 1
    });

    tracker.acceptResult({ text: "두 번째 문장을", isFinal: false });
    const second = tracker.acceptResult({
      text: "두 번째 문장을",
      isFinal: false,
    });

    expect(second.sentenceId).toBe("sentence_2");
    expect(second.sentenceCharOffset).toBeGreaterThan(0);
    expect(second.sentenceRatio).toBeLessThan(1);
  });

  it("emoji가 포함된 canonical offset으로 다음 문장 진행률을 계산한다", () => {
    const tracker = createScriptProgressTracker(
      "😀 첫 문장을 설명합니다. 둘째 🚀 문장을 정리합니다."
    );

    tracker.acceptResult({ text: "😀 첫 문장을 설명합니다", isFinal: false });
    const first = tracker.acceptResult({
      text: "😀 첫 문장을 설명합니다",
      isFinal: true,
    });
    tracker.acceptResult({ text: "둘째 🚀 문장을", isFinal: false });
    const second = tracker.acceptResult({
      text: "둘째 🚀 문장을",
      isFinal: false,
    });

    expect(first).toMatchObject({
      totalChars: 28,
      sentenceId: "sentence_1",
      sentenceTotalChars: 13,
      sentenceRatio: 1
    });
    expect(second.sentenceId).toBe("sentence_2");
    expect(second.sentenceCharOffset).toBeGreaterThan(0);
    expect(second.sentenceRatio).toBeLessThan(1);
  });

  it("영문 대본과 한국어식 발음을 canonical term으로 정렬한다", () => {
    const tracker = createScriptProgressTracker("OpenAI API를 활용했습니다.", {
      pronunciationEntries: [
        pronunciationEntry("openai", "OpenAI", "오픈에이아이", 0),
        pronunciationEntry("api", "API", "에이피아이", 7),
      ],
      slideId: "slide_1",
    });

    tracker.acceptResult({
      text: "오픈 에이아이 에이피아이를 활용했습니다",
      isFinal: false,
    });
    const result = tracker.acceptResult({
      text: "오픈 에이아이 에이피아이를 활용했습니다",
      isFinal: true,
    });

    expect(result.confidence).toBe("confirmed");
    expect(result.ratio).toBeGreaterThan(0.9);
  });
});

function pronunciationEntry(
  canonicalKey: string,
  sourceText: string,
  alias: string,
  start: number,
): PronunciationLexiconEntry {
  return {
    id: `pron_${canonicalKey}`,
    sourceText,
    normalizedSource: sourceText.toLocaleLowerCase("en-US"),
    canonicalText: sourceText,
    canonicalKey,
    category: canonicalKey === "api" ? "acronym" : "product",
    aliases: [
      {
        text: alias,
        normalizedText: alias,
        origin: "static",
        confidence: 1,
        enabled: true,
      },
    ],
    confidence: 1,
    status: "active",
    scriptOccurrences: [
      { slideId: "slide_1", start, end: start + sourceText.length },
    ],
  };
}
