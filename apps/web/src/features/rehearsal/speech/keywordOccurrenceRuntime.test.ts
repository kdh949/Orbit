import { describe, expect, it } from "vitest";

import {
  evaluateKeywordOccurrenceTriggers,
  matchKeywordOccurrenceTriggers
} from "./keywordOccurrenceRuntime";

describe("matchKeywordOccurrenceTriggers", () => {
  const slide = {
    slideId: "slide_1",
    speakerNotes:
      "오늘은 AI 덱 생성 파이프라인을 소개합니다. 중간에도 AI를 언급합니다. 마지막에 AI를 말하면 이미지가 나타납니다.",
    keywords: [
      {
        keywordId: "kw_ai",
        text: "AI",
        synonyms: [],
        abbreviations: [],
        required: true
      }
    ],
    actions: [],
    animations: []
  };

  it("confidence 미제공을 100%로 만들지 않고 threshold를 명시적으로 우회한다", () => {
    const result = evaluateKeywordOccurrenceTriggers({
      slide,
      targetOccurrenceIds: ["kwo_slide_1_kw_ai_4_6"],
      transcript: "오늘은 AI",
      latestTranscript: "AI",
      confidence: null
    });

    expect(result.evaluations[0]?.evidence).toMatchObject({
      confidenceAvailable: false,
      confidenceValue: null,
      confidencePassed: true,
      confidencePolicy: "BYPASS_THRESHOLD_WHEN_UNAVAILABLE"
    });
    expect(result.matches).toHaveLength(1);
  });

  it("낮은 confidence로 탈락한 occurrence의 원인을 반환한다", () => {
    const result = evaluateKeywordOccurrenceTriggers({
      slide,
      targetOccurrenceIds: ["kwo_slide_1_kw_ai_4_6"],
      transcript: "오늘은 AI",
      latestTranscript: "AI",
      confidence: 0.4
    });

    expect(result.matches).toEqual([]);
    expect(result.evaluations[0]).toMatchObject({
      outcome: "rejected",
      reasons: expect.arrayContaining(["LOW_CONFIDENCE"])
    });
  });

  it("does not match a later keyword occurrence before script progress reaches its window", () => {
    const matches = matchKeywordOccurrenceTriggers({
      slide,
      targetOccurrenceIds: ["kwo_slide_1_kw_ai_47_49"],
      transcript: "오늘은 AI 덱 생성 파이프라인을 소개합니다.",
      latestTranscript: "AI",
      confidence: 0.95
    });

    expect(matches).toEqual([]);
  });

  it("does not match a shorter overlapping keyword beside its longer term", () => {
    const overlappingSlide = {
      ...slide,
      speakerNotes: "그래프 탐색을 설명합니다.",
      keywords: [
        {
          keywordId: "kw_search",
          text: "탐색",
          synonyms: [],
          abbreviations: [],
          required: true
        },
        {
          keywordId: "kw_graph_search",
          text: "그래프 탐색",
          synonyms: [],
          abbreviations: [],
          required: true
        }
      ]
    };
    const matches = matchKeywordOccurrenceTriggers({
      slide: overlappingSlide,
      targetOccurrenceIds: [
        "kwo_slide_1_kw_search_4_6",
        "kwo_slide_1_kw_graph_search_0_6"
      ],
      transcript: "그래프 탐색을 설명합니다",
      latestTranscript: "그래프 탐색",
      confidence: 0.95
    });

    expect(matches.map((match) => match.keywordId)).toEqual(["kw_graph_search"]);
  });

  it("matches the target occurrence when script progress is inside the occurrence window", () => {
    const matches = matchKeywordOccurrenceTriggers({
      slide,
      targetOccurrenceIds: ["kwo_slide_1_kw_ai_47_49"],
      transcript:
        "오늘은 AI 덱 생성 파이프라인을 소개합니다. 중간에도 AI를 언급합니다. 마지막에 AI를 말하면",
      latestTranscript: "AI",
      confidence: 0.95
    });

    expect(matches).toEqual([
      {
        keywordId: "kw_ai",
        occurrenceId: "kwo_slide_1_kw_ai_47_49",
        text: "AI",
        matchedScriptOffset: 47,
        currentCharOffset: 55
      }
    ]);
  });

  it("matches an occurrence at the beginning when one final result covers the whole sentence", () => {
    const matches = matchKeywordOccurrenceTriggers({
      slide,
      targetOccurrenceIds: ["kwo_slide_1_kw_ai_4_6"],
      previousTranscript: "",
      transcript: "오늘은 AI 덱 생성 파이프라인을 소개합니다.",
      latestTranscript: "오늘은 AI 덱 생성 파이프라인을 소개합니다.",
      confidence: 0.95
    });

    expect(matches).toEqual([
      {
        keywordId: "kw_ai",
        occurrenceId: "kwo_slide_1_kw_ai_4_6",
        text: "AI",
        matchedScriptOffset: 4,
        currentCharOffset: 24
      }
    ]);
  });

  it("uses the newly covered span to distinguish repeated keywords", () => {
    const matches = matchKeywordOccurrenceTriggers({
      slide,
      targetOccurrenceIds: ["kwo_slide_1_kw_ai_31_33"],
      previousTranscript: "오늘은 AI 덱 생성 파이프라인을 소개합니다.",
      transcript: "오늘은 AI 덱 생성 파이프라인을 소개합니다. 중간에도 AI를 언급합니다.",
      latestTranscript: "중간에도 AI를 언급합니다.",
      confidence: 0.95
    });

    expect(matches).toEqual([
      {
        keywordId: "kw_ai",
        occurrenceId: "kwo_slide_1_kw_ai_31_33",
        text: "AI",
        matchedScriptOffset: 31,
        currentCharOffset: 40
      }
    ]);
  });

  it("skips a consumed repeated occurrence when matching the next trigger", () => {
    const repeatedSlide = {
      ...slide,
      slideId: "slide_repeated",
      speakerNotes: "트리는 연결된 구조입니다. 트리는 사이클이 없습니다.",
      keywords: [
        {
          keywordId: "kw_tree",
          text: "트리는",
          synonyms: [],
          abbreviations: [],
          required: true
        }
      ]
    };
    const firstOccurrenceId = "kwo_slide_repeated_kw_tree_0_3";
    const secondOccurrenceId = "kwo_slide_repeated_kw_tree_15_18";

    const firstMatches = matchKeywordOccurrenceTriggers({
      slide: repeatedSlide,
      targetOccurrenceIds: [firstOccurrenceId, secondOccurrenceId],
      previousTranscript: "",
      transcript: "트리는",
      latestTranscript: "트리는",
      confidence: 0.95
    });
    const secondMatches = matchKeywordOccurrenceTriggers({
      slide: repeatedSlide,
      targetOccurrenceIds: [firstOccurrenceId, secondOccurrenceId],
      previousTranscript: "트리는",
      transcript: repeatedSlide.speakerNotes,
      latestTranscript: "트리는",
      confidence: 0.95,
      confirmedOccurrenceIds: [firstOccurrenceId]
    });

    expect(firstMatches.map((match) => match.occurrenceId)).toEqual([
      firstOccurrenceId
    ]);
    expect(secondMatches.map((match) => match.occurrenceId)).toEqual([
      secondOccurrenceId
    ]);
  });

  it("does not match an occurrence that was already confirmed in the slide session", () => {
    const matches = matchKeywordOccurrenceTriggers({
      slide,
      targetOccurrenceIds: ["kwo_slide_1_kw_ai_47_49"],
      transcript:
        "오늘은 AI 덱 생성 파이프라인을 소개합니다. 중간에도 AI를 언급합니다. 마지막에 AI를 말하면",
      latestTranscript: "AI",
      confidence: 0.95,
      confirmedOccurrenceIds: ["kwo_slide_1_kw_ai_47_49"]
    });

    expect(matches).toEqual([]);
  });

  it("does not match when transcript confidence is below the occurrence threshold", () => {
    const matches = matchKeywordOccurrenceTriggers({
      slide,
      targetOccurrenceIds: ["kwo_slide_1_kw_ai_47_49"],
      transcript:
        "오늘은 AI 덱 생성 파이프라인을 소개합니다. 중간에도 AI를 언급합니다. 마지막에 AI를 말하면",
      latestTranscript: "AI",
      confidence: 0.4
    });

    expect(matches).toEqual([]);
  });

});
