import { describe, expect, it } from "vitest";

import type { BrowserSpeechRecognition } from "./browserSpeechRecognition";
import {
  applyWebSpeechPhrases,
  isWebSpeechPhrasesSupported,
  toWebSpeechPhrases,
} from "./webSpeechPhrases";

describe("webSpeechPhrases", () => {
  it("recognition phrases와 SpeechRecognitionPhrase 생성자가 있으면 지원으로 판단한다", () => {
    const recognition = fakeRecognition({ phrases: [] });

    expect(
      isWebSpeechPhrasesSupported(recognition, {
        SpeechRecognitionPhrase: FakeSpeechRecognitionPhrase,
      }),
    ).toBe(true);
  });

  it("phrases 프로퍼티나 생성자가 없으면 미지원으로 판단한다", () => {
    expect(
      isWebSpeechPhrasesSupported(fakeRecognition(), {
        SpeechRecognitionPhrase: FakeSpeechRecognitionPhrase,
      }),
    ).toBe(false);
    expect(
      isWebSpeechPhrasesSupported(fakeRecognition({ phrases: [] }), {}),
    ).toBe(false);
  });

  it("weight를 boost로 변환하고 범위를 clamp한다", () => {
    const phrases = toWebSpeechPhrases(
      [
        { text: "오르빗", weight: 1 },
        { text: "결재", weight: 0.45 },
        { text: "낮은 값", weight: -1 },
        { text: "높은 값", weight: 2 },
      ],
      { SpeechRecognitionPhrase: FakeSpeechRecognitionPhrase },
    );

    expect(phrases).toEqual([
      new FakeSpeechRecognitionPhrase("오르빗", 5),
      new FakeSpeechRecognitionPhrase("결재", 2.8),
      new FakeSpeechRecognitionPhrase("낮은 값", 1),
      new FakeSpeechRecognitionPhrase("높은 값", 5),
    ]);
  });

  it("지원 환경이면 recognition.phrases를 교체하고 true를 반환한다", () => {
    const recognition = fakeRecognition({ phrases: [] });

    expect(
      applyWebSpeechPhrases(recognition, [{ text: "오르빗", weight: 1 }], {
        SpeechRecognitionPhrase: FakeSpeechRecognitionPhrase,
      }),
    ).toBe(true);
    expect(recognition.phrases).toEqual([
      new FakeSpeechRecognitionPhrase("오르빗", 5),
    ]);
  });

  it("미지원이거나 적용 중 오류가 나면 false를 반환하고 기존 phrases를 유지한다", () => {
    const unsupported = fakeRecognition();

    expect(
      applyWebSpeechPhrases(unsupported, [{ text: "오르빗", weight: 1 }], {
        SpeechRecognitionPhrase: FakeSpeechRecognitionPhrase,
      }),
    ).toBe(false);

    const throwing = fakeRecognitionWithThrowingPhrases([
      new FakeSpeechRecognitionPhrase("기존", 1),
    ]);
    expect(
      applyWebSpeechPhrases(throwing, [{ text: "오르빗", weight: 1 }], {
        SpeechRecognitionPhrase: FakeSpeechRecognitionPhrase,
      }),
    ).toBe(false);
    expect(throwing.phrases).toEqual([
      new FakeSpeechRecognitionPhrase("기존", 1),
    ]);
  });
});

class FakeSpeechRecognitionPhrase {
  constructor(
    readonly phrase: string,
    readonly boost: number,
  ) {}
}

function fakeRecognition(
  overrides: Partial<BrowserSpeechRecognition> = {},
): BrowserSpeechRecognition {
  return {
    continuous: false,
    interimResults: false,
    lang: "",
    maxAlternatives: 0,
    onresult: null,
    onerror: null,
    onend: null,
    start() {},
    stop() {},
    abort() {},
    ...overrides,
  };
}

function fakeRecognitionWithThrowingPhrases(
  initialPhrases: FakeSpeechRecognitionPhrase[],
): BrowserSpeechRecognition {
  let phrases = initialPhrases;
  const recognition = fakeRecognition({ phrases });
  Object.defineProperty(recognition, "phrases", {
    get: () => phrases,
    set: () => {
      throw new Error("phrases unsupported");
    },
    configurable: true,
  });
  return recognition;
}
