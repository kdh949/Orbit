import { describe, expect, it } from "vitest";

import {
  createDefaultPhraseExtractor,
  normalizeSpeechText,
  stripKoreanParticle
} from "./phraseExtractor";

describe("normalizeSpeechText", () => {
  it("대본과 전사에 같은 정규화 규칙을 적용한다", () => {
    expect(normalizeSpeechText(" Orbit으로  설명합니다! ")).toBe(
      "orbit설명합니다"
    );
    expect(stripKoreanParticle("오르빗으로")).toBe("오르빗");
    expect(stripKoreanParticle("나")).toBe("나");
  });
});

describe("PhraseExtractor", () => {
  it("빈 대본은 빈 문장 목록을 반환한다", () => {
    const extractor = createDefaultPhraseExtractor();

    expect(extractor.extract("   \n  ")).toEqual([]);
  });

  it("상투구와 컨트롤 구절 후보를 제외하고 마지막 문장을 표시한다", () => {
    const extractor = createDefaultPhraseExtractor({
      controlPhrases: ["다음으로 넘어가"]
    });

    const sentences = extractor.extract(
      "안녕하세요. 다음으로 넘어가 설명합니다. 오르빗 리허설 화면은 발표 흐름을 점검합니다."
    );

    expect(sentences).toHaveLength(3);
    expect(sentences[0]).toMatchObject({
      sentenceId: "sentence_1",
      index: 0,
      isFinalTrigger: false,
      matchable: false,
      candidates: []
    });
    expect(sentences[1].candidates.map((candidate) => candidate.text)).not.toContain(
      "다음으로 넘어가"
    );
    expect(sentences[2]).toMatchObject({
      sentenceId: "sentence_3",
      index: 2,
      isFinalTrigger: true,
      matchable: true
    });
    expect(sentences[2].candidates.length).toBeGreaterThan(0);
    expect(sentences[2].candidates.length).toBeLessThanOrEqual(3);
  });

  it("블랙리스트 표현만 제거하고 주변의 식별 가능한 토큰은 후보로 유지한다", () => {
    const extractor = createDefaultPhraseExtractor();

    const [sentence] = extractor.extract(
      "ORBIT을 안녕하세요 소개하겠습니다."
    );

    expect(sentence).toMatchObject({
      matchable: true
    });
    expect(sentence?.candidates.map((candidate) => candidate.text)).toContain(
      "ORBIT을 소개하겠습니다"
    );
    expect(
      sentence?.candidates.every(
        (candidate) => !candidate.text.includes("안녕하세요")
      )
    ).toBe(true);
  });

  it("명시적인 speaker notes 줄바꿈을 문장부호보다 우선하는 대본 줄로 사용한다", () => {
    const extractor = createDefaultPhraseExtractor();

    const sentences = extractor.extract(
      [
        "첫 줄은 문제와 배경을 설명합니다. 같은 줄의 세부 내용도 유지합니다.",
        "둘째 줄은 해결 방향을 공유합니다.",
        "마지막 줄은 다음 행동을 정리합니다."
      ].join("\n")
    );

    expect(sentences.map((sentence) => sentence.text)).toEqual([
      "첫 줄은 문제와 배경을 설명합니다. 같은 줄의 세부 내용도 유지합니다",
      "둘째 줄은 해결 방향을 공유합니다",
      "마지막 줄은 다음 행동을 정리합니다"
    ]);
    expect(sentences.map((sentence) => sentence.index)).toEqual([0, 1, 2]);
    expect(sentences[2]).toMatchObject({
      isFinalTrigger: true,
      matchable: true
    });
  });

  it("문장 간 공유 후보는 제거하되 마지막 문장 후보를 보호한다", () => {
    const extractor = createDefaultPhraseExtractor();

    const sentences = extractor.extract(
      [
        "첫 번째 문장은 오르빗 리허설 화면 장점을 설명합니다.",
        "마지막 문장은 오르빗 리허설 화면 결론을 정리합니다."
      ].join(" ")
    );

    const firstCandidates = sentences[0].candidates.map(
      (candidate) => candidate.normalizedText
    );
    const finalCandidates = sentences[1].candidates.map(
      (candidate) => candidate.normalizedText
    );

    expect(sentences[0].matchable).toBe(true);
    expect(sentences[1].matchable).toBe(true);
    expect(finalCandidates.length).toBeGreaterThan(0);
    expect(firstCandidates).not.toContain("오르빗리허설화면");
    expect(finalCandidates).toContain("오르빗리허설화면");
  });

  it("보충 후보가 없으면 문장을 매칭 불가로 표시한다", () => {
    const extractor = createDefaultPhraseExtractor();

    const sentences = extractor.extract(
      "공유 후보만 남습니다. 공유 후보만 남습니다."
    );

    expect(sentences[0]).toMatchObject({
      matchable: false,
      candidates: []
    });
    expect(sentences[1]).toMatchObject({
      isFinalTrigger: true,
      matchable: true
    });
  });
});
