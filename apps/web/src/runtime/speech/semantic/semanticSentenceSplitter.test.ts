import { describe, expect, it } from "vitest";

import { createDefaultPhraseExtractor } from "../tracking/phraseExtractor";
import { splitSpeakerNotesIntoSemanticSentences } from "./semanticSentenceSplitter";

describe("splitSpeakerNotesIntoSemanticSentences", () => {
  it("canonical 문장 경계와 terminal punctuation 제거 규칙을 사용한다", () => {
    expect(texts("Hello. Next.")).toEqual(["Hello", "Next"]);
    expect(texts("Hello.Next.")).toEqual(["Hello", "Next"]);
    expect(texts("문장 하나.문장 둘.")).toEqual(["문장 하나", "문장 둘"]);
  });

  it("질문과 느낌표를 terminal punctuation 문장 경계로 인정한다", () => {
    expect(texts("질문인가요? 다음입니다! 끝.")).toEqual([
      "질문인가요",
      "다음입니다",
      "끝"
    ]);
    expect(texts("Version 1.2 is ready? Next!")).toEqual([
      "Version 1.2 is ready",
      "Next"
    ]);
  });

  it("CJK terminal punctuation과 ellipsis를 문장 경계로 인정한다", () => {
    expect(texts("첫 문장。둘째 문장？셋째 문장！마지막…")).toEqual([
      "첫 문장",
      "둘째 문장",
      "셋째 문장",
      "마지막"
    ]);
  });

  it("숫자 사이 마침표는 소수점으로 보고 경계에서 제외한다", () => {
    expect(texts("Version 1.2 is ready. Next.")).toEqual([
      "Version 1.2 is ready",
      "Next"
    ]);
    expect(texts("Price is 3.14. Next.")).toEqual([
      "Price is 3.14",
      "Next"
    ]);
  });

  it("마침표로 닫히지 않은 마지막 조각도 semantic matching 대상에 포함한다", () => {
    expect(texts("First sentence. Last sentence without period")).toEqual([
      "First sentence",
      "Last sentence without period"
    ]);
  });

  it("NFC 정규화와 CRLF 정규화를 적용하고 offset과 final trigger를 보존한다", () => {
    const sentences = splitSpeakerNotesIntoSemanticSentences(
      "Cafe\u0301 line.\r\nSecond line"
    );

    expect(sentences).toEqual([
      {
        sentenceId: "sentence_1",
        text: "Café line",
        index: 0,
        startOffset: 0,
        endOffset: 9,
        isFinalTrigger: false
      },
      {
        sentenceId: "sentence_2",
        text: "Second line",
        index: 1,
        startOffset: 10,
        endOffset: 21,
        isFinalTrigger: true
      }
    ]);
  });

  it("공백뿐인 입력은 빈 배열을 반환한다", () => {
    expect(splitSpeakerNotesIntoSemanticSentences(" \n\t ")).toEqual([]);
  });

  it("phrase extractor와 sentence ID, text, index를 동일하게 유지한다", () => {
    const notes = "첫 줄의 설명입니다. 같은 줄을 유지합니다.\n둘째 줄입니다.";
    const lexicalSentences = createDefaultPhraseExtractor().extract(notes);
    const semanticSentences = splitSpeakerNotesIntoSemanticSentences(notes);

    expect(
      semanticSentences.map(({ sentenceId, text, index, isFinalTrigger }) => ({
        sentenceId,
        text,
        index,
        isFinalTrigger
      }))
    ).toEqual(
      lexicalSentences.map(({ sentenceId, text, index, isFinalTrigger }) => ({
        sentenceId,
        text,
        index,
        isFinalTrigger
      }))
    );
  });
});

function texts(input: string) {
  return splitSpeakerNotesIntoSemanticSentences(input).map((sentence) => sentence.text);
}
