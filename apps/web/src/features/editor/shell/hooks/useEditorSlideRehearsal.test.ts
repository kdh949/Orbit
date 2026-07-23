import { createDemoDeck } from "@orbit/editor-core";
import { describe, expect, it } from "vitest";

import {
  buildEditorSlideRehearsalBiasPhrases,
  createEditorSlideRehearsalSpeechTracker,
  getEditorLiveAudioLevelPercent,
  getHitSlideKeywordIds,
  notifyEditorSlideRehearsalSpeechResult
} from "./useEditorSlideRehearsal";

describe("useEditorSlideRehearsal utilities", () => {
  it("현재 슬라이드의 제목과 키워드를 음성 인식 힌트로 만든다", () => {
    const slide = createDemoDeck().slides[0]!;
    const phrases = buildEditorSlideRehearsalBiasPhrases(slide);

    expect(phrases.some((phrase) => phrase.text === slide.title)).toBe(true);
    expect(
      slide.keywords.every((keyword) =>
        phrases.some(
          (phrase) =>
            phrase.keywordId === keyword.keywordId &&
            phrase.text === keyword.text,
        ),
      ),
    ).toBe(true);
  });

  it("동의어와 약어 발화도 체크포인트 달성으로 처리한다", () => {
    const slide = createDemoDeck().slides[0]!;
    slide.keywords = [
      {
        abbreviations: ["STT"],
        keywordId: "kw_voice",
        required: true,
        synonyms: ["음성 변환"],
        text: "음성 인식",
      },
    ];

    expect(getHitSlideKeywordIds(slide, "STT 결과를 확인합니다")).toEqual([
      "kw_voice",
    ]);
    expect(
      getHitSlideKeywordIds(slide, "음성 변환 결과를 확인합니다"),
    ).toEqual(["kw_voice"]);
  });

  it("음량 dB를 0~100 범위로 제한한다", () => {
    expect(
      getEditorLiveAudioLevelPercent({
        isLikelySilence: false,
        peak: 1,
        peakDb: 0,
        rms: 1,
        rmsDb: 10,
        type: "audio-level",
      }),
    ).toBe(100);
    expect(
      getEditorLiveAudioLevelPercent({
        isLikelySilence: true,
        peak: 0,
        peakDb: -80,
        rms: 0,
        rmsDb: -80,
        type: "audio-level",
      }),
    ).toBe(0);
  });

  it("같은 final 결과가 반복돼도 대본 문장을 두 번 넘기지 않는다", () => {
    const slide = createDemoDeck().slides[0]!;
    slide.speakerNotes =
      "첫 번째 핵심 내용을 차분하게 설명합니다. 두 번째 비교 결과를 이어서 설명합니다. 마지막 결론을 정리합니다.";
    const tracker = createEditorSlideRehearsalSpeechTracker(slide);
    const result = {
      isFinal: true,
      text: "첫 번째 핵심 내용을 차분하게 설명합니다",
      timestampMs: [0, 1_000] as [number, number]
    };

    tracker.acceptResult(result);
    tracker.acceptResult(result);

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      committedSentenceIds: ["sentence_1"],
      currentSentenceId: "sentence_2"
    });
  });

  it("애니메이션 consumer 예외를 transcript 없이 격리한다", () => {
    const slide = createDemoDeck().slides[0]!;
    const logs: string[] = [];
    const event = {
      finalTranscript: "민감한 transcript",
      hitKeywordIds: [],
      interimTranscript: "",
      result: {
        text: "민감한 transcript",
        isFinal: true,
        timestampMs: [0, 100] as [number, number]
      },
      slide,
      transcript: "민감한 transcript"
    };

    expect(() =>
      notifyEditorSlideRehearsalSpeechResult(
        () => {
          throw new Error("animation failed");
        },
        event,
        (entry) => logs.push(entry)
      )
    ).not.toThrow();
    expect(JSON.parse(logs[0]!)).toMatchObject({
      event: "editor_slide_rehearsal.animation_consumer_failed",
      slideId: slide.slideId,
      errorName: "Error"
    });
    expect(logs[0]).not.toContain(event.transcript);
  });
});
