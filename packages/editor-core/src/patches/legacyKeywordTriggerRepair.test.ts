import { describe, expect, it } from "vitest";

import type { Deck } from "@orbit/shared/deck";
import { createDemoDeck } from "../index";
import { createUpdateAnimationKeywordTriggerPatch } from "./actionOperations";
import { suggestLegacyKeywordTriggerRepairs } from "./legacyKeywordTriggerRepair";

describe("legacy keyword trigger repair", () => {
  it("suggests a high confidence repair when exactly one occurrence exists", () => {
    const deck = createDemoDeck();
    const slide = withLegacyKeywordActions(deck, {
      speakerNotes: "ORBIT 대본으로 설명합니다.",
      actions: [{ actionId: "act_1", keywordId: "kw_1", animationId: "anim_1" }]
    });

    expect(suggestLegacyKeywordTriggerRepairs(slide)).toEqual([
      {
        actionId: "act_1",
        keywordId: "kw_1",
        suggestedOccurrenceId: "kwo_slide_1_kw_1_0_5",
        confidence: "high",
        reason: "only one matching occurrence exists"
      }
    ]);
  });

  it("maps legacy actions to repeated occurrences by order when counts match", () => {
    const deck = createDemoDeck();
    const slide = withLegacyKeywordActions(deck, {
      speakerNotes: "ORBIT 흐름은 ORBIT 대본으로 설명합니다.",
      actions: [
        { actionId: "act_1", keywordId: "kw_1", animationId: "anim_1" },
        { actionId: "act_2", keywordId: "kw_1", animationId: "anim_2" }
      ]
    });

    expect(suggestLegacyKeywordTriggerRepairs(slide)).toEqual([
      {
        actionId: "act_1",
        keywordId: "kw_1",
        suggestedOccurrenceId: "kwo_slide_1_kw_1_0_5",
        confidence: "medium",
        reason: "legacy action order matches occurrence order"
      },
      {
        actionId: "act_2",
        keywordId: "kw_1",
        suggestedOccurrenceId: "kwo_slide_1_kw_1_10_15",
        confidence: "medium",
        reason: "legacy action order matches occurrence order"
      }
    ]);
  });

  it("suggests the last occurrence with low confidence for one legacy action and many occurrences", () => {
    const deck = createDemoDeck();
    const slide = withLegacyKeywordActions(deck, {
      speakerNotes: "ORBIT 흐름은 ORBIT 대본으로 설명합니다.",
      actions: [{ actionId: "act_1", keywordId: "kw_1", animationId: "anim_1" }]
    });

    expect(suggestLegacyKeywordTriggerRepairs(slide)).toEqual([
      {
        actionId: "act_1",
        keywordId: "kw_1",
        suggestedOccurrenceId: "kwo_slide_1_kw_1_10_15",
        confidence: "low",
        reason:
          "multiple occurrences exist; last occurrence is only a manual repair hint"
      }
    ]);
  });

  it("returns no occurrence suggestion when the keyword does not appear in speaker notes", () => {
    const deck = createDemoDeck();
    const slide = withLegacyKeywordActions(deck, {
      speakerNotes: "다른 대본으로 설명합니다.",
      actions: [{ actionId: "act_1", keywordId: "kw_1", animationId: "anim_1" }]
    });

    expect(suggestLegacyKeywordTriggerRepairs(slide)).toEqual([
      {
        actionId: "act_1",
        keywordId: "kw_1",
        suggestedOccurrenceId: null,
        confidence: "none",
        reason: "matching occurrence not found"
      }
    ]);
  });

  it("keeps ambiguous multi-action mismatches as manual repair only", () => {
    const deck = createDemoDeck();
    const slide = withLegacyKeywordActions(deck, {
      speakerNotes: "ORBIT 흐름은 ORBIT 대본과 ORBIT 사례로 설명합니다.",
      actions: [
        { actionId: "act_1", keywordId: "kw_1", animationId: "anim_1" },
        { actionId: "act_2", keywordId: "kw_1", animationId: "anim_2" }
      ]
    });

    expect(suggestLegacyKeywordTriggerRepairs(slide)).toEqual([
      {
        actionId: "act_1",
        keywordId: "kw_1",
        suggestedOccurrenceId: null,
        confidence: "none",
        reason: "legacy action count does not match occurrence count"
      },
      {
        actionId: "act_2",
        keywordId: "kw_1",
        suggestedOccurrenceId: null,
        confidence: "none",
        reason: "legacy action count does not match occurrence count"
      }
    ]);
  });

  it("updates a legacy animation trigger to the explicitly selected occurrence", () => {
    const deck = createDemoDeck();
    const slide = withLegacyKeywordActions(deck, {
      speakerNotes: "ORBIT 흐름은 ORBIT 대본으로 설명합니다.",
      actions: [{ actionId: "act_1", keywordId: "kw_1", animationId: "anim_1" }]
    });
    const deckWithSlide = {
      ...deck,
      slides: [slide, ...deck.slides.slice(1)]
    };

    expect(
      createUpdateAnimationKeywordTriggerPatch(
        deckWithSlide,
        slide.slideId,
        "anim_1",
        "kw_1",
        "kwo_slide_1_kw_1_10_15"
      )
    ).toMatchObject({
      operations: [
        {
          type: "update_slide_action",
          actionId: "act_1",
          action: {
            trigger: {
              kind: "keyword-occurrence",
              keywordId: "kw_1",
              occurrenceId: "kwo_slide_1_kw_1_10_15"
            }
          }
        }
      ]
    });
  });
});

function withLegacyKeywordActions(
  deck: Deck,
  options: {
    speakerNotes: string;
    actions: Array<{
      actionId: string;
      keywordId: string;
      animationId: string;
    }>;
  }
): Deck["slides"][number] {
  return {
    ...deck.slides[0]!,
    speakerNotes: options.speakerNotes,
    animations: options.actions.map((action, index) => ({
      animationId: action.animationId,
      elementId: "el_1",
      order: index + 1,
      type: "fade-in",
      durationMs: 300,
      delayMs: 0,
      easing: "ease-out"
    })),
    actions: options.actions.map((action) => ({
      actionId: action.actionId,
      trigger: {
        kind: "keyword" as const,
        keywordId: action.keywordId
      },
      effect: {
        kind: "play-animation" as const,
        animationId: action.animationId
      }
    }))
  };
}
