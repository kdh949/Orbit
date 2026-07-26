import { describe, expect, it } from "vitest";

import {
  defaultSpeechTrackingConfig,
  mergeSpeechTrackingConfig,
  speechTrackingAdviceEventTypes
} from "./speechTrackingConfig";
import type { SpeechTrackingEvent } from "./speechTrackingEvents";

describe("speechTrackingConfig", () => {
  it("P3 결정값을 기본 설정으로 노출한다", () => {
    expect(defaultSpeechTrackingConfig.particleStopwords).toEqual([
      "은",
      "는",
      "이",
      "가",
      "을",
      "를",
      "의",
      "에",
      "에서",
      "에게",
      "께",
      "한테",
      "으로",
      "로",
      "와",
      "과",
      "랑",
      "이랑",
      "하고",
      "도",
      "만",
      "까지",
      "부터",
      "조차",
      "마저",
      "밖에",
      "처럼",
      "보다",
      "같이",
      "마다",
      "나",
      "이나",
      "든",
      "이든",
      "요"
    ]);
    expect(defaultSpeechTrackingConfig.phraseCandidateLimit).toBe(3);
    expect(defaultSpeechTrackingConfig.diceThreshold).toBe(0.75);
    expect(defaultSpeechTrackingConfig.matchingTailCharacters).toBe(40);
    expect(defaultSpeechTrackingConfig.hybridCoverage).toEqual({
      sentenceWeight: 0.7,
      wordWeight: 0.3,
      correctionWindow: 0.1
    });
    expect(defaultSpeechTrackingConfig.paceAdvice).toEqual({
      slowWpm: 85,
      fastWpm: 130,
      movingAverageWindowMs: 30000
    });
    expect(defaultSpeechTrackingConfig.adviceReentryCooldownMs).toBe(15000);
    expect(defaultSpeechTrackingConfig.biasPhraseBudget).toBe(48);
    expect(defaultSpeechTrackingConfig.commonPhraseBlacklist).toEqual([
      "감사합니다",
      "안녕하세요",
      "말씀드리겠습니다",
      "살펴보겠습니다",
      "설명드리겠습니다",
      "시작하겠습니다",
      "마무리하겠습니다",
      "그렇기 때문에",
      "이와 같이"
    ]);
  });

  it("설정 override를 병합해도 기본 객체를 변경하지 않는다", () => {
    const merged = mergeSpeechTrackingConfig({
      diceThreshold: 0.8,
      hybridCoverage: { wordWeight: 0.4 },
      paceAdvice: { fastWpm: 140 },
      commonPhraseBlacklist: ["테스트 상투구"]
    });

    expect(merged.diceThreshold).toBe(0.8);
    expect(merged.hybridCoverage).toEqual({
      sentenceWeight: 0.7,
      wordWeight: 0.4,
      correctionWindow: 0.1
    });
    expect(merged.paceAdvice).toEqual({
      slowWpm: 85,
      fastWpm: 140,
      movingAverageWindowMs: 30000
    });
    expect(merged.commonPhraseBlacklist).toEqual(["테스트 상투구"]);
    expect(defaultSpeechTrackingConfig.diceThreshold).toBe(0.75);
    expect(defaultSpeechTrackingConfig.commonPhraseBlacklist).toContain("감사합니다");
  });

  it("조언 이벤트 타입을 run meta와 UI가 공유할 수 있게 고정한다", () => {
    expect(speechTrackingAdviceEventTypes).toEqual([
      "pace-too-fast",
      "pace-too-slow",
      "slide-overtime"
    ]);
  });
});

describe("SpeechTrackingEvent", () => {
  it("로그와 run meta 소비 이벤트는 전사나 대본 원문을 담지 않는다", () => {
    const events: SpeechTrackingEvent[] = [
      {
        type: "sentence-covered",
        slideId: "slide_1",
        sentenceId: "sentence_1",
        matchKind: "covered",
        atMs: 1000
      },
      {
        type: "coverage-updated",
        slideId: "slide_1",
        sentenceCoverage: 0.5,
        wordCoverage: 0.4,
        effectiveCoverage: 0.47,
        atMs: 1200
      },
      {
        type: "last-sentence-spoken",
        slideId: "slide_1",
        sentenceId: "sentence_2",
        atMs: 1400
      },
      {
        type: "keyword-hit",
        slideId: "slide_1",
        keywordId: "kw_1",
        atMs: 1500
      },
      {
        type: "keyword-missing",
        slideId: "slide_1",
        keywordId: "kw_2",
        provisional: true,
        atMs: 2000
      },
      {
        type: "advice-event",
        slideId: "slide_1",
        adviceType: "pace-too-fast",
        atMs: 3000
      }
    ];

    for (const event of events) {
      expect(Object.keys(event)).not.toContain("transcript");
      expect(Object.keys(event)).not.toContain("speakerNotes");
      expect(Object.keys(event)).not.toContain("rawAudio");
      expect(JSON.stringify(event)).not.toContain("발표자 대본 원문");
    }
  });
});
