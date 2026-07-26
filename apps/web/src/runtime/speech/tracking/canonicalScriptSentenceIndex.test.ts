import { describe, expect, it } from "vitest";

import { createCanonicalScriptSentenceIndex } from "./canonicalScriptSentenceIndex";

describe("createCanonicalScriptSentenceIndex", () => {
  it("NFC/NFD와 CRLF/LF 입력에 동일한 문장 인덱스를 만든다", () => {
    const nfc = createCanonicalScriptSentenceIndex(
      "Caf\u00e9 발표를 시작합니다.\n다음 내용을 설명합니다."
    );
    const nfd = createCanonicalScriptSentenceIndex(
      "Cafe\u0301 발표를 시작합니다.\r\n다음 내용을 설명합니다."
    );

    expect(nfd).toEqual(nfc);
  });

  it("비어 있지 않은 명시적 줄이 둘 이상이면 줄을 tracking 단위로 우선한다", () => {
    const index = createCanonicalScriptSentenceIndex(
      "첫 줄입니다. 같은 줄은 유지합니다.\n\n둘째 줄입니다."
    );

    expect(index.sentences.map((sentence) => sentence.text)).toEqual([
      "첫 줄입니다. 같은 줄은 유지합니다",
      "둘째 줄입니다"
    ]);
  });

  it("명시적 줄이 하나면 문장부호로 나누되 소수점은 경계에서 제외한다", () => {
    const index = createCanonicalScriptSentenceIndex(
      "성장률은 3.14입니다. 다음은 CJK 문장입니다。마지막인가요？！"
    );

    expect(index.sentences.map((sentence) => sentence.text)).toEqual([
      "성장률은 3.14입니다",
      "다음은 CJK 문장입니다",
      "마지막인가요"
    ]);
  });

  it("연속 말줄임표를 하나의 문장 경계로 정규화한다", () => {
    const index = createCanonicalScriptSentenceIndex(
      "잠시 생각합니다…… 다음 설명을 이어갑니다."
    );

    expect(index.sentences.map((sentence) => sentence.text)).toEqual([
      "잠시 생각합니다",
      "다음 설명을 이어갑니다"
    ]);
  });

  it("안정적인 sentence ID와 정규화된 source offset을 제공한다", () => {
    const index = createCanonicalScriptSentenceIndex(
      "첫 문장을 설명합니다. 둘째 문장을 정리합니다."
    );

    expect(index.sourceText).toBe(
      "첫 문장을 설명합니다 둘째 문장을 정리합니다"
    );
    expect(index.sentences).toMatchObject([
      { sentenceId: "sentence_1", index: 0, isFinalTrigger: false },
      { sentenceId: "sentence_2", index: 1, isFinalTrigger: true }
    ]);
    for (const sentence of index.sentences) {
      expect(
        Array.from(index.sourceText)
          .slice(sentence.startOffset, sentence.endOffset)
          .join("")
      ).toBe(sentence.text);
    }
  });

  it("surrogate pair가 있어도 Unicode code point offset으로 문장을 가리킨다", () => {
    const index = createCanonicalScriptSentenceIndex(
      "😀 첫 문장을 설명합니다. 둘째 🚀 문장을 정리합니다."
    );

    expect(index.sentences).toMatchObject([
      { text: "😀 첫 문장을 설명합니다", startOffset: 0, endOffset: 13 },
      { text: "둘째 🚀 문장을 정리합니다", startOffset: 14, endOffset: 28 }
    ]);
    expect(Array.from(index.sourceText)).toHaveLength(28);
    for (const sentence of index.sentences) {
      expect(
        Array.from(index.sourceText)
          .slice(sentence.startOffset, sentence.endOffset)
          .join("")
      ).toBe(sentence.text);
    }
  });
});
