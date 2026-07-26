import { describe, expect, it } from "vitest";

import { matchKeywordOccurrenceTriggers } from "./keywordOccurrenceRuntime";

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
