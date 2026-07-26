import { describe, expect, it } from "vitest";

import type { Slide } from "@orbit/shared/deck";

import { deriveKeywordOccurrences } from "./keywordOccurrences";

function createSlide(
  speakerNotes: string,
  keywords: Slide["keywords"]
): Pick<Slide, "slideId" | "speakerNotes" | "keywords"> {
  return {
    slideId: "slide_1",
    speakerNotes,
    keywords
  };
}

describe("deriveKeywordOccurrences", () => {
  it("creates distinct occurrence ids for repeated keyword text", () => {
    const occurrences = deriveKeywordOccurrences(
      createSlide("AI 흐름을 설명하고 마지막에 AI를 강조합니다.", [
        {
          keywordId: "kw_ai",
          text: "AI",
          synonyms: [],
          abbreviations: [],
          required: true
        }
      ])
    );

    expect(occurrences).toMatchObject([
      {
        occurrenceId: "kwo_slide_1_kw_ai_0_2",
        slideId: "slide_1",
        keywordId: "kw_ai",
        text: "AI",
        start: 0,
        end: 2,
        occurrenceIndex: 0
      },
      {
        occurrenceId: "kwo_slide_1_kw_ai_17_19",
        slideId: "slide_1",
        keywordId: "kw_ai",
        text: "AI",
        start: 17,
        end: 19,
        occurrenceIndex: 1
      }
    ]);
  });

  it("maps synonym and abbreviation matches to the original keyword id", () => {
    const occurrences = deriveKeywordOccurrences(
      createSlide("발표 도우미를 소개하고 OBT 약어도 설명합니다.", [
        {
          keywordId: "kw_orbit",
          text: "ORBIT",
          synonyms: ["발표 도우미"],
          abbreviations: ["OBT"],
          required: true
        }
      ])
    );

    expect(occurrences).toMatchObject([
      {
        occurrenceId: "kwo_slide_1_kw_orbit_0_6",
        keywordId: "kw_orbit",
        text: "발표 도우미",
        occurrenceIndex: 0
      },
      {
        occurrenceId: "kwo_slide_1_kw_orbit_13_16",
        keywordId: "kw_orbit",
        text: "OBT",
        occurrenceIndex: 1
      }
    ]);
  });

  it("prefers longer terms when keyword matches overlap", () => {
    const occurrences = deriveKeywordOccurrences(
      createSlide("AI Agent가 작업을 수행합니다.", [
        {
          keywordId: "kw_ai",
          text: "AI",
          synonyms: [],
          abbreviations: [],
          required: true
        },
        {
          keywordId: "kw_ai_agent",
          text: "AI Agent",
          synonyms: [],
          abbreviations: [],
          required: true
        }
      ])
    );

    expect(occurrences).toMatchObject([
      {
        occurrenceId: "kwo_slide_1_kw_ai_agent_0_8",
        keywordId: "kw_ai_agent",
        text: "AI Agent",
        start: 0,
        end: 8
      }
    ]);
  });
});
