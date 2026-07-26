import { describe, expect, it } from "vitest";

import type { Slide } from "@orbit/shared/deck";

import { findDanglingKeywordOccurrenceActions } from "./keywordOccurrenceDiagnostics";

function createSlide(
  actions: Slide["actions"]
): Pick<Slide, "slideId" | "speakerNotes" | "keywords" | "actions"> {
  return {
    slideId: "slide_1",
    speakerNotes: "AI 흐름을 설명하고 마지막에 AI를 강조합니다.",
    keywords: [
      {
        keywordId: "kw_ai",
        text: "AI",
        synonyms: [],
        abbreviations: [],
        required: true
      }
    ],
    actions
  };
}

describe("findDanglingKeywordOccurrenceActions", () => {
  it("returns occurrence actions whose target disappears after speaker notes change", () => {
    const danglingActions = findDanglingKeywordOccurrenceActions(
      createSlide([
        {
          actionId: "act_1",
          trigger: {
            kind: "keyword-occurrence",
            keywordId: "kw_ai",
            occurrenceId: "kwo_slide_1_kw_ai_17_19"
          },
          effect: {
            kind: "go-to-next-slide"
          }
        }
      ]),
      "앞에 추가 AI 흐름을 설명하고 마지막에 AI를 강조합니다."
    );

    expect(danglingActions).toEqual([
      {
        slideId: "slide_1",
        actionId: "act_1",
        keywordId: "kw_ai",
        occurrenceId: "kwo_slide_1_kw_ai_17_19",
        effectKind: "go-to-next-slide"
      }
    ]);
  });

  it("does not return occurrence actions that still target a current occurrence", () => {
    const danglingActions = findDanglingKeywordOccurrenceActions(
      createSlide([
        {
          actionId: "act_1",
          trigger: {
            kind: "keyword-occurrence",
            keywordId: "kw_ai",
            occurrenceId: "kwo_slide_1_kw_ai_17_19"
          },
          effect: {
            kind: "play-animation",
            animationId: "anim_1"
          }
        }
      ]),
      "AI 흐름을 설명하고 마지막에 AI를 강조합니다."
    );

    expect(danglingActions).toEqual([]);
  });

  it("ignores legacy keyword actions", () => {
    const danglingActions = findDanglingKeywordOccurrenceActions(
      createSlide([
        {
          actionId: "act_1",
          trigger: {
            kind: "keyword",
            keywordId: "kw_ai"
          },
          effect: {
            kind: "go-to-next-slide"
          }
        }
      ]),
      "앞에 추가 AI 흐름을 설명하고 마지막에 AI를 강조합니다."
    );

    expect(danglingActions).toEqual([]);
  });
});
