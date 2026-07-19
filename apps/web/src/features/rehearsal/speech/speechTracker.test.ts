import { describe, expect, it } from "vitest";
import type { PronunciationLexiconEntry } from "@orbit/shared";

import { createSpeechTracker } from "./speechTracker";

describe("SpeechTracker", () => {
  it("인사말은 진행률 분모에서 제외하고 다음 문장의 lexical evidence를 즉시 표시한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes:
        "안녕하세요. 이번 발표에서는 ORBIT 출시 목표를 공유하겠습니다. 마지막으로 실행 계획을 정리하겠습니다.",
      keywords: [],
    });

    expect(tracker.snapshot()).toMatchObject({
      matchableSentenceCount: 2,
      sentenceCoverage: 0,
      prompterProgress: {
        currentSentenceId: "sentence_2",
        hasCurrentLexicalEvidence: false,
        committedSentenceIds: []
      }
    });

    tracker.acceptResult({
      text: "이번 발표에서는 ORBIT 출시 목표",
      isFinal: false,
      timestampMs: [0, 500]
    });

    expect(tracker.snapshot()).toMatchObject({
      matchableSentenceCount: 2,
      prompterProgress: {
        phase: "candidate",
        currentSentenceId: "sentence_2",
        hasCurrentLexicalEvidence: true,
        committedSentenceIds: []
      }
    });
  });

  it("partial 전사에서도 키워드를 즉시 체크하고 final 문장 진행과 함께 유지한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes:
        "오르빗 리허설 화면은 발표 흐름을 점검합니다. 마지막 결론은 실시간 피드백입니다.",
      keywords: [
        {
          keywordId: "kw_orbit",
          text: "오르빗",
          synonyms: [],
          abbreviations: []
        }
      ]
    });

    const partialEvents = tracker.acceptResult({
      text: "오르빗 리허설 화면",
      isFinal: false,
      timestampMs: [0, 500]
    });
    expect(partialEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "sentence-covered",
          sentenceId: "sentence_1",
          matchKind: "covered"
        })
      ])
    );
    expect(partialEvents).toContainEqual({
      type: "keyword-hit",
      slideId: "slide_1",
      keywordId: "kw_orbit",
      atMs: 500
    });
    expect(tracker.snapshot()).toMatchObject({
      effectiveCoverage: 0.5,
      hitKeywordIds: ["kw_orbit"],
      prompterProgress: {
        phase: "candidate",
        currentSentenceId: "sentence_1",
        committedSentenceIds: []
      },
      finalSentenceCommitted: false,
    });

    const events = tracker.acceptResult({
      text: "오르빗 리허설 화면은 발표 흐름을 점검합니다",
      isFinal: true,
      timestampMs: [500, 1500]
    });

    expect(events.map((event) => event.type)).not.toContain("keyword-hit");
    expect(tracker.snapshot()).toMatchObject({
      sentenceCoverage: 0.5,
      finalSentenceSpoken: false,
      hitKeywordIds: ["kw_orbit"],
      prompterProgress: {
        currentSentenceId: "sentence_2",
        committedSentenceIds: ["sentence_1"]
      }
    });
  });

  it("한국어식 발음을 영문 term evidence로 사용하되 원문 의미 token도 요구한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes: "OpenAI API를 활용했습니다.",
      keywords: [
        {
          keywordId: "kw_openai",
          text: "OpenAI",
          synonyms: [],
          abbreviations: []
        },
        {
          keywordId: "kw_api",
          text: "API",
          synonyms: [],
          abbreviations: []
        }
      ],
      pronunciationEntries: [
        pronunciationEntry("openai", "OpenAI", "오픈에이아이", 0),
        pronunciationEntry("api", "API", "에이피아이", 7),
      ],
    });

    tracker.acceptResult({
      text: "오픈 에이아이 에이피아이를 활용했습니다",
      isFinal: false,
      timestampMs: [0, 500]
    });
    tracker.acceptResult({
      text: "오픈 에이아이 에이피아이를 활용했습니다",
      isFinal: true,
      timestampMs: [0, 1_000]
    });

    expect(tracker.snapshot()).toMatchObject({
      hitKeywordIds: ["kw_openai", "kw_api"],
      sentenceCoverage: 1,
    });
  });

  it("마지막 문장 발화와 hybrid coverage를 함께 계산한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      threshold: 0.7,
      speakerNotes:
        "첫 내용은 제품 맥락을 설명합니다. 두 번째 내용은 사용 흐름을 보여줍니다. 마지막 결론은 실시간 피드백입니다.",
      keywords: [],
    });

    const events = tracker.acceptResult({
      text: "제품 맥락을 설명합니다. 사용 흐름을 보여줍니다. 마지막 결론은 실시간 피드백입니다.",
      isFinal: true,
      timestampMs: [0, 2000]
    });
    const coverage = events.find((event) => event.type === "coverage-updated");

    expect(events.map((event) => event.type)).toContain("last-sentence-spoken");
    expect(coverage).toMatchObject({
      sentenceCoverage: 1,
      effectiveCoverage: 1
    });
    expect(coverage?.type === "coverage-updated" ? coverage.wordCoverage : 0).toBeGreaterThan(0.6);
    expect(tracker.snapshot()).toMatchObject({
      finalSentenceSpoken: true,
      finalSentenceCommitted: false,
      prompterProgress: {
        currentSentenceId: "sentence_1",
        committedSentenceIds: []
      }
    });
  });

  it("threshold 근처에서만 어절 보조 신호를 +/-10%p로 반영한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      threshold: 0.7,
      speakerNotes:
        "오르빗 화면은 자료를 정리합니다. 리허설 흐름은 시간을 점검합니다. 마지막 결론은 피드백입니다.",
      keywords: []
    });

    tracker.acceptResult({
      text: "오르빗 화면은 자료를 정리합니다. 리허설 흐름은 시간을 점검합니다. 마지막 결론은 다른 표현입니다.",
      isFinal: true,
      timestampMs: [0, 2000]
    });

    const snapshot = tracker.snapshot();
    expect(snapshot.sentenceCoverage).toBeCloseTo(2 / 3, 5);
    expect(snapshot.wordCoverage).toBeGreaterThan(snapshot.sentenceCoverage);
    expect(snapshot.effectiveCoverage).toBeLessThanOrEqual(snapshot.sentenceCoverage + 0.1);
    expect(snapshot.effectiveCoverage).toBeGreaterThan(snapshot.sentenceCoverage);
  });

  it("슬라이드 이탈 시 잠정 missing을 내고 복귀하면 전환 판정 상태만 리셋한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes: "오르빗 리허설 화면을 설명합니다.",
      keywords: [
        {
          keywordId: "kw_orbit",
          text: "오르빗",
          synonyms: [],
          abbreviations: []
        },
        {
          keywordId: "kw_timer",
          text: "타이머",
          synonyms: [],
          abbreviations: []
        }
      ]
    });

    tracker.acceptResult({
      text: "오르빗 리허설 화면을 설명합니다",
      isFinal: true,
      timestampMs: [0, 1000]
    });
    expect(tracker.exitSlide(1500)).toContainEqual({
      type: "keyword-missing",
      slideId: "slide_1",
      keywordId: "kw_timer",
      provisional: true,
      atMs: 1500
    });

    tracker.resetForSlideVisit();

    expect(tracker.snapshot()).toMatchObject({
      sentenceCoverage: 0,
      effectiveCoverage: 0,
      hitKeywordIds: ["kw_orbit"],
      finalSentenceCommitted: false,
      prompterProgress: {
        currentSentenceId: "sentence_1",
        committedSentenceIds: []
      }
    });
  });

  it("제어 문구와 겹치는 대본 문장은 coverage 후보에서 제외한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes: "다음 슬라이드. 제품 가치를 설명합니다.",
      controlPhrases: ["다음 슬라이드"],
      keywords: []
    });

    expect(tracker.snapshot().matchableSentenceCount).toBe(1);

    const commandEvents = tracker.acceptResult({
      text: "다음 슬라이드",
      isFinal: true,
      timestampMs: [0, 500]
    });

    expect(commandEvents.map((event) => event.type)).not.toContain("sentence-covered");
    expect(tracker.snapshot()).toMatchObject({
      sentenceCoverage: 0,
      effectiveCoverage: 0
    });

    tracker.acceptResult({
      text: "제품 가치를 설명합니다",
      isFinal: true,
      timestampMs: [500, 1500]
    });

    expect(tracker.snapshot()).toMatchObject({
      sentenceCoverage: 1,
      effectiveCoverage: 1
    });
  });

  it("speaker notes 줄 단위로 script coverage를 갱신한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes: [
        "첫 줄은 제품 맥락을 설명합니다. 같은 줄 보충 설명입니다.",
        "둘째 줄은 리허설 흐름을 보여줍니다.",
        "다음 슬라이드"
      ].join("\n"),
      controlPhrases: ["다음 슬라이드"],
      keywords: []
    });

    expect(tracker.snapshot().matchableSentenceCount).toBe(2);

    tracker.acceptResult({
      text: "제품 맥락을 설명합니다",
      isFinal: true,
      timestampMs: [0, 800]
    });

    expect(tracker.snapshot()).toMatchObject({
      coveredSentenceIds: ["sentence_1"],
      sentenceCoverage: 0.5
    });

    tracker.acceptResult({
      text: "리허설 흐름을 보여줍니다",
      isFinal: true,
      timestampMs: [800, 1600]
    });

    expect(tracker.snapshot()).toMatchObject({
      coveredSentenceIds: ["sentence_1", "sentence_2"],
      sentenceCoverage: 1,
      finalSentenceSpoken: false
    });
  });

  it("semantic sentence match는 중복 없이 sentence coverage와 마지막 문장 이벤트를 만든다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      threshold: 0.7,
      speakerNotes: "첫 내용은 제품 맥락입니다. 마지막 결론은 피드백입니다.",
      keywords: []
    });

    tracker.acceptResult({
      text: "같은 뜻의 다른 표현입니다",
      isFinal: true,
      timestampMs: [0, 1000]
    });

    const firstEvents = tracker.acceptSemanticSentenceMatch({
      sentenceId: "sentence_1",
      transcript: "같은 뜻의 다른 표현입니다",
      similarity: 0.82,
      atMs: 1100
    });
    const duplicateEvents = tracker.acceptSemanticSentenceMatch({
      sentenceId: "sentence_1",
      transcript: "같은 뜻의 다른 표현입니다",
      similarity: 0.84,
      atMs: 1200
    });
    const finalEvents = tracker.acceptSemanticSentenceMatch({
      sentenceId: "sentence_2",
      transcript: "마지막을 다르게 말했습니다",
      similarity: 0.9,
      atMs: 1500
    });

    expect(firstEvents.map((event) => event.type)).toEqual([
      "sentence-covered",
      "coverage-updated"
    ]);
    expect(firstEvents[0]).toMatchObject({
      type: "sentence-covered",
      matchKind: "paraphrased",
      similarity: 0.82
    });
    expect(duplicateEvents).toEqual([]);
    expect(finalEvents.map((event) => event.type)).toEqual([
      "sentence-covered",
      "last-sentence-spoken",
      "coverage-updated"
    ]);
    expect(tracker.snapshot()).toMatchObject({
      sentenceCoverage: 1,
      finalSentenceSpoken: true,
      prompterProgress: {
        currentSentenceId: "sentence_1",
        committedSentenceIds: []
      },
      finalSentenceCommitted: false
    });
  });

  it("partial lexical evidence는 final boundary 전까지 프롬프터를 넘기지 않는다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes:
        "첫 문장은 제품 맥락과 사용자 문제를 설명합니다. 둘째 문장은 해결 흐름을 정리합니다.",
      keywords: []
    });

    tracker.acceptResult({
      text: "첫 문장은 제품 맥락과 사용자 문제를 설명합니다",
      isFinal: false,
      timestampMs: [0, 900]
    });

    expect(tracker.snapshot()).toMatchObject({
      prompterProgress: {
        phase: "candidate",
        currentSentenceId: "sentence_1",
        committedSentenceIds: []
      }
    });

    tracker.acceptResult({
      text: "첫 문장은 제품 맥락과 사용자 문제를 설명합니다",
      isFinal: true,
      timestampMs: [900, 1200]
    });

    expect(tracker.snapshot()).toMatchObject({
      prompterProgress: {
        phase: "tracking",
        currentSentenceId: "sentence_2",
        committedSentenceIds: ["sentence_1"],
        lastCommittedSentenceId: "sentence_1"
      }
    });
  });

  it("timestamp만 달라진 동일 final을 재수신해도 다음 문장을 commit하지 않는다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes:
        "첫째 발표는 동일한 핵심 내용을 자세히 설명합니다. 둘째 발표는 동일한 핵심 내용을 자세히 설명합니다.",
      keywords: []
    });
    const finalResult = {
      text: "첫째 발표는 동일한 핵심 내용을 자세히 설명합니다",
      isFinal: true,
      timestampMs: [0, 1_000] as [number, number]
    };

    tracker.acceptResult(finalResult);
    const firstSnapshot = tracker.snapshot().prompterProgress;
    tracker.acceptResult({
      ...finalResult,
      timestampMs: [1_000, 1_200]
    });

    expect(tracker.snapshot().prompterProgress).toEqual(firstSnapshot);
    expect(firstSnapshot).toMatchObject({
      currentSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"]
    });
  });

  it("겹치는 현재 문장만 말한 final은 다음 문장 candidate로 승계하지 않는다", () => {
    const tracker = createOverlappingSentenceTracker();

    tracker.acceptResult(overlappingCurrentFinalResult());

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      phase: "tracking",
      currentSentenceId: "sentence_2",
      candidateSentenceId: null,
      committedSentenceIds: ["sentence_1"]
    });
    expect(tracker.acceptPrompterBoundary({ type: "pause-started", atMs: 1_600 })).toBe(false);
  });

  it("겹치는 두 문장을 모두 말한 final은 다음 문장 evidence를 승계한다", () => {
    const tracker = createOverlappingSentenceTracker();

    tracker.acceptResult(
      overlappingCurrentFinalResult(
        `${OVERLAPPING_FIRST_SENTENCE} ${OVERLAPPING_SECOND_SENTENCE}`
      )
    );

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      phase: "candidate",
      currentSentenceId: "sentence_2",
      candidateSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"]
    });
    expect(tracker.acceptPrompterBoundary({ type: "pause-started", atMs: 1_600 })).toBe(true);
  });

  it("다문장 final은 첫 문장만 commit하고 다음 문장을 새 revision candidate로 승계한다", () => {
    const tracker = createMultiSentenceTracker();

    tracker.acceptResult(combinedFinalResult());

    expect(tracker.snapshot()).toMatchObject({
      finalSentenceCommitted: false,
      prompterProgress: {
        revision: 1,
        phase: "candidate",
        currentSentenceId: "sentence_2",
        candidateSentenceId: "sentence_2",
        committedSentenceIds: ["sentence_1"],
        finalSentenceCommitted: false
      }
    });
  });

  it("다문장 final에서 승계한 다음 문장을 후속 pause boundary로 commit한다", () => {
    const tracker = createMultiSentenceTracker();
    tracker.acceptResult(combinedFinalResult());

    expect(tracker.acceptPrompterBoundary({ type: "pause-started", atMs: 1_600 })).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      finalSentenceCommitted: true,
      prompterProgress: {
        revision: 2,
        currentSentenceId: null,
        candidateSentenceId: null,
        committedSentenceIds: ["sentence_1", "sentence_2"],
        finalSentenceCommitted: true
      }
    });
  });

  it("동일 final 재전달은 승계 candidate를 유지하고 다음 문장을 commit하지 않는다", () => {
    const tracker = createMultiSentenceTracker();
    const result = combinedFinalResult();
    tracker.acceptResult(result);
    const carriedProgress = tracker.snapshot().prompterProgress;

    tracker.acceptResult({
      ...result,
      timestampMs: [1_000, 1_200],
      resultRevision: 2
    });

    expect(tracker.snapshot().prompterProgress).toEqual(carriedProgress);
    expect(carriedProgress).toMatchObject({
      phase: "candidate",
      currentSentenceId: "sentence_2",
      candidateSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"]
    });
  });

  it("새로운 distinct final은 승계 candidate의 별도 boundary로 동작한다", () => {
    const tracker = createMultiSentenceTracker();
    tracker.acceptResult(combinedFinalResult());

    tracker.acceptResult({
      text: "확인했습니다",
      isFinal: true,
      timestampMs: [1_000, 1_300],
      utteranceId: "utterance_2",
      resultRevision: 1
    });

    expect(tracker.snapshot()).toMatchObject({
      finalSentenceCommitted: true,
      prompterProgress: {
        currentSentenceId: null,
        committedSentenceIds: ["sentence_1", "sentence_2"],
        finalSentenceCommitted: true
      }
    });
  });

  it("weak lookahead evidence는 다음 문장 candidate로 승계하지 않는다", () => {
    const tracker = createMultiSentenceTracker();

    tracker.acceptResult({
      text: `${FIRST_PROMPTER_SENTENCE} 두 번째`,
      isFinal: true,
      timestampMs: [0, 1_000],
      utteranceId: "utterance_1",
      resultRevision: 1
    });

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      revision: 1,
      phase: "tracking",
      currentSentenceId: "sentence_2",
      candidateSentenceId: null,
      committedSentenceIds: ["sentence_1"]
    });
  });

  it("승계 evidence가 stale해진 뒤 이미 반영된 token이 와도 commit하지 않는다", () => {
    const tracker = createMultiSentenceTracker();
    tracker.acceptResult(combinedFinalResult());

    tracker.acceptResult({
      text: "두 번째",
      isFinal: true,
      timestampMs: [2_501, 2_800],
      utteranceId: "utterance_2",
      resultRevision: 1
    });
    expect(tracker.snapshot().prompterProgress).toMatchObject({
      phase: "tracking",
      currentSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"]
    });
  });

  it("같은 final에서 파생된 E5 결과는 승계 문장을 추가 commit하지 않는다", () => {
    const tracker = createMultiSentenceTracker();
    tracker.acceptResult(combinedFinalResult());

    tracker.acceptSemanticSentenceMatch({
      sentenceId: "sentence_2",
      transcript: "두 번째 문장을 같은 의미로 표현했습니다",
      similarity: 0.95,
      lexicalOverlap: 0.4,
      expectedPrompterRevision: 1,
      atMs: 1_000
    });

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      revision: 1,
      phase: "candidate",
      currentSentenceId: "sentence_2",
      candidateSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"],
      finalSentenceCommitted: false
    });
  });

  it("reset은 이전 revision의 승계 candidate를 폐기한다", () => {
    const tracker = createMultiSentenceTracker();
    tracker.acceptResult(combinedFinalResult());

    tracker.resetForSlideVisit();

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      revision: 2,
      phase: "tracking",
      currentSentenceId: "sentence_1",
      candidateSentenceId: null,
      committedSentenceIds: []
    });
    expect(tracker.acceptPrompterBoundary({ type: "pause-started", atMs: 1_600 })).toBe(false);
  });

  it("세 문장 final도 첫 문장만 commit하고 두 번째 문장까지만 승계한다", () => {
    const tracker = createMultiSentenceTracker(THIRD_PROMPTER_SENTENCE);

    tracker.acceptResult(
      combinedFinalResult(
        `${FIRST_PROMPTER_SENTENCE} ${SECOND_PROMPTER_SENTENCE} ${THIRD_PROMPTER_SENTENCE}`
      )
    );

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      revision: 1,
      phase: "candidate",
      currentSentenceId: "sentence_2",
      candidateSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"]
    });

    expect(tracker.acceptPrompterBoundary({ type: "pause-started", atMs: 1_600 })).toBe(true);
    expect(tracker.snapshot().prompterProgress).toMatchObject({
      revision: 2,
      phase: "tracking",
      currentSentenceId: "sentence_3",
      candidateSentenceId: null,
      committedSentenceIds: ["sentence_1", "sentence_2"]
    });
  });

  it("commit된 utterance의 후속 revision은 막고 새 utterance는 허용한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes:
        "첫째 발표는 동일한 핵심 내용을 자세히 설명합니다. 둘째 발표는 동일한 핵심 내용을 자세히 설명합니다.",
      keywords: []
    });

    tracker.acceptResult({
      text: "첫째 발표는 동일한 핵심 내용을 자세히 설명합니다",
      isFinal: true,
      timestampMs: [0, 1_000],
      utteranceId: "utterance_1",
      resultRevision: 1
    });
    tracker.acceptResult({
      text: "첫째 발표는 동일한 핵심 내용을 자세히 설명합니다",
      isFinal: true,
      timestampMs: [1_000, 1_200],
      utteranceId: "utterance_1",
      resultRevision: 2
    });

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      currentSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"]
    });

    tracker.acceptResult({
      text: "첫째 발표는 동일한 핵심 내용을 자세히 설명합니다",
      isFinal: true,
      timestampMs: [1_200, 2_000],
      utteranceId: "utterance_2",
      resultRevision: 1
    });

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      currentSentenceId: null,
      committedSentenceIds: ["sentence_1", "sentence_2"]
    });
  });

  it("identity가 없는 동일 transcript도 dedupe window 이후 새 발화로 처리한다", () => {
    let nowMs = 0;
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes:
        "첫째 발표는 동일한 핵심 내용을 자세히 설명합니다. 둘째 발표는 동일한 핵심 내용을 자세히 설명합니다.",
      keywords: [],
      now: () => nowMs
    });
    const result = {
      text: "첫째 발표는 동일한 핵심 내용을 자세히 설명합니다",
      isFinal: true,
      timestampMs: [0, 1_000] as [number, number]
    };

    tracker.acceptResult(result);
    nowMs = 2_001;
    tracker.acceptResult({ ...result, timestampMs: [2_000, 3_000] });

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      currentSentenceId: null,
      committedSentenceIds: ["sentence_1", "sentence_2"]
    });
  });

  it("manual previous 이후 identity 없는 동일 문장을 다시 commit할 수 있다", () => {
    let nowMs = 1_000;
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes: "반복해서 설명할 수 있는 발표 문장입니다.",
      keywords: [],
      now: () => nowMs
    });
    const result = {
      text: "반복해서 설명할 수 있는 발표 문장입니다",
      isFinal: true,
      timestampMs: [0, 1_000] as [number, number]
    };

    tracker.acceptResult(result);
    expect(tracker.manualPreviousPrompter(1_100)).toBe(true);
    nowMs = 1_100;
    tracker.acceptResult({ ...result, timestampMs: [1_100, 1_500] });

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      currentSentenceId: null,
      committedSentenceIds: ["sentence_1"],
      finalSentenceCommitted: true
    });
  });

  it("manual API는 coverage를 변경하지 않고 프롬프터 위치만 이동한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes: "첫 문장은 제품 맥락을 설명합니다. 둘째 문장은 해결 흐름을 정리합니다.",
      keywords: []
    });

    expect(tracker.manualNextPrompter(1_000)).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      coveredSentenceIds: [],
      prompterProgress: {
        currentSentenceId: "sentence_2",
        committedSentenceIds: ["sentence_1"]
      }
    });

    expect(tracker.manualPreviousPrompter(1_100)).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      coveredSentenceIds: [],
      prompterProgress: {
        currentSentenceId: "sentence_1",
        committedSentenceIds: []
      }
    });
  });

  it("skip API는 진행률을 올리지 않고 다음 문장부터 자동 인식을 계속한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes:
        "첫 문장은 제품 맥락을 설명합니다. 둘째 문장은 해결 흐름을 정리합니다.",
      keywords: []
    });

    expect(tracker.skipCurrentPrompter(1_000)).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      coveredSentenceIds: [],
      prompterProgress: {
        currentSentenceId: "sentence_2",
        committedSentenceIds: [],
        skippedSentenceIds: ["sentence_1"],
        finalSentenceCommitted: false
      }
    });

    tracker.acceptResult({
      text: "둘째 문장은 해결 흐름을 정리합니다",
      isFinal: true,
      timestampMs: [1_100, 2_000]
    });
    expect(tracker.snapshot()).toMatchObject({
      prompterProgress: {
        currentSentenceId: null,
        committedSentenceIds: ["sentence_2"],
        skippedSentenceIds: ["sentence_1"],
        finalSentenceCommitted: true
      }
    });
  });

  it("skip API는 마지막 문장에서 진행률을 올리지 않는다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes:
        "첫 문장은 제품 맥락을 설명합니다. 둘째 문장은 해결 흐름을 정리합니다.",
      keywords: []
    });

    expect(tracker.skipCurrentPrompter(1_000)).toBe(true);
    expect(tracker.skipCurrentPrompter(1_100)).toBe(false);
    expect(tracker.snapshot().prompterProgress).toMatchObject({
      currentSentenceId: "sentence_2",
      committedSentenceIds: [],
      finalSentenceCommitted: false
    });
  });

  it("pause boundary는 충분한 lexical candidate가 있을 때만 현재 문장을 commit한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes: "오르빗 리허설 화면은 발표 흐름을 점검합니다.",
      keywords: []
    });

    tracker.acceptResult({
      text: "오르빗 리허설 화면은 발표 흐름을 점검합니다",
      isFinal: false,
      timestampMs: [0, 800]
    });

    expect(tracker.acceptPrompterBoundary({ type: "pause-started", atMs: 900 })).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      finalSentenceCommitted: true,
      prompterProgress: {
        currentSentenceId: null,
        committedSentenceIds: ["sentence_1"]
      }
    });
  });

  it("다음 문장을 바로 읽으면 현재 문장을 체크하지 않고 한 문장 앞으로 복구한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes:
        "첫 문장은 제품 전략과 고객 문제를 구체적으로 설명합니다. 둘째 결론은 실행 일정과 협업 방향을 명확하게 정리합니다.",
      keywords: []
    });

    tracker.acceptResult({
      text: "둘째 결론은 실행 일정과 협업 방향을 명확하게 정리합니다",
      isFinal: true,
      timestampMs: [0, 1_000],
    });

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      currentSentenceId: null,
      committedSentenceIds: ["sentence_2"],
      skippedSentenceIds: ["sentence_1"],
      lastCommitSource: "lexical"
    });
  });

  it("E5 match는 lexical token이 있을 때만 현재 문장 commit을 보조한다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes:
        "오르빗 리허설은 발표자의 실제 전달 흐름과 핵심 메시지를 안정적으로 점검합니다.",
      keywords: []
    });

    tracker.acceptResult({
      text: "오르빗 리허설",
      isFinal: true,
      timestampMs: [0, 500]
    });
    expect(tracker.snapshot().prompterProgress?.finalSentenceCommitted).toBe(false);

    tracker.acceptSemanticSentenceMatch({
      sentenceId: "sentence_1",
      transcript: "오르빗 리허설을 통해 핵심 전달을 점검했습니다",
      similarity: 0.94,
      lexicalOverlap: 0.25,
      matchKind: "paraphrased",
      atMs: 500
    });

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      currentSentenceId: null,
      committedSentenceIds: ["sentence_1"],
      lastCommitSource: "semantic-assisted",
      finalSentenceCommitted: true,
    });
  });

  it("이전 prompter revision의 E5 결과는 현재 문장을 commit하지 않는다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes:
        "오르빗 리허설은 발표자의 실제 전달 흐름과 핵심 메시지를 안정적으로 점검합니다.",
      keywords: []
    });

    tracker.acceptResult({
      text: "오르빗 리허설",
      isFinal: false,
      timestampMs: [0, 500]
    });
    tracker.acceptSemanticSentenceMatch({
      sentenceId: "sentence_1",
      transcript: "오르빗 리허설을 통해 핵심 전달을 점검했습니다",
      similarity: 0.94,
      lexicalOverlap: 0.25,
      matchKind: "paraphrased",
      expectedPrompterRevision: 1,
      atMs: 500
    });

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      revision: 0,
      currentSentenceId: "sentence_1",
      committedSentenceIds: [],
      finalSentenceCommitted: false,
    });
  });

  it("semantic coverage event는 transcript, speakerNotes, similarity 원문을 노출하지 않는다", () => {
    const tracker = createSpeechTracker({
      slideId: "slide_1",
      speakerNotes: "보안상 대본 원문입니다.",
      keywords: []
    });

    const events = tracker.acceptSemanticSentenceMatch({
      sentenceId: "sentence_1",
      transcript: "보안상 final transcript입니다",
      similarity: 0.88,
      matchKind: "paraphrased",
      lexicalOverlap: 0.2,
      atMs: 1000
    });

    for (const event of events) {
      expect(Object.keys(event)).not.toContain("transcript");
      expect(Object.keys(event)).not.toContain("speakerNotes");
      expect(JSON.stringify(event)).not.toContain("보안상 final transcript");
      expect(JSON.stringify(event)).not.toContain("보안상 대본 원문");
    }
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
        origin: "static" as const,
        confidence: 1,
        enabled: true,
      },
    ],
    confidence: 1,
    status: "active" as const,
    scriptOccurrences: [
      { slideId: "slide_1", start, end: start + sourceText.length },
    ],
  };
}

const FIRST_PROMPTER_SENTENCE =
  "첫 번째 문장은 제품 전략과 고객 문제를 명확하게 설명합니다";
const SECOND_PROMPTER_SENTENCE =
  "두 번째 문장은 실행 일정과 협업 방향을 구체적으로 정리합니다";
const THIRD_PROMPTER_SENTENCE =
  "세 번째 문장은 다음 단계와 책임 범위를 마지막으로 안내합니다";
const OVERLAPPING_FIRST_SENTENCE =
  "첫째 발표는 동일한 핵심 내용을 자세히 설명합니다";
const OVERLAPPING_SECOND_SENTENCE =
  "둘째 발표는 동일한 핵심 내용을 자세히 설명합니다";

function createOverlappingSentenceTracker() {
  return createSpeechTracker({
    slideId: "slide_1",
    speakerNotes: `${OVERLAPPING_FIRST_SENTENCE}. ${OVERLAPPING_SECOND_SENTENCE}.`,
    keywords: []
  });
}

function overlappingCurrentFinalResult(text = OVERLAPPING_FIRST_SENTENCE) {
  return {
    text,
    isFinal: true,
    timestampMs: [0, 1_000] as [number, number],
    utteranceId: "utterance_1",
    resultRevision: 1
  };
}

function createMultiSentenceTracker(thirdSentence?: string) {
  return createSpeechTracker({
    slideId: "slide_1",
    speakerNotes:
      [FIRST_PROMPTER_SENTENCE, SECOND_PROMPTER_SENTENCE, thirdSentence]
        .filter(Boolean)
        .join(". ") + ".",
    keywords: []
  });
}

function combinedFinalResult(text = `${FIRST_PROMPTER_SENTENCE} ${SECOND_PROMPTER_SENTENCE}`) {
  return {
    text,
    isFinal: true,
    timestampMs: [0, 1_000] as [number, number],
    utteranceId: "utterance_1",
    resultRevision: 1
  };
}
