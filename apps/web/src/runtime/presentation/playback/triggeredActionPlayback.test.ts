import { describe, expect, it } from "vitest";

import type { Slide } from "@orbit/shared/deck";

import {
  getTriggerAnimationIdsForSlide,
  getKeywordOccurrenceTriggerIdsForSlide,
  restoreSlidePlaybackAtStep,
  resolveManualAnimationPlaybackUpdate,
  resolveKeywordOccurrenceTriggeredActions,
  resolveKeywordTriggeredActions
} from "./triggeredActionPlayback";
import { createSlideshowAnimationPlan } from "../../../runtime/presentation/slideshow/slideshowStepModel";

describe("triggeredActionPlayback", () => {
  it("keeps legacy keyword and keyword occurrence trigger resolution separate", () => {
    const slide = createSlide();

    expect(
      resolveKeywordTriggeredActions(slide, "kw_other").map((action) => action.actionId)
    ).toEqual(["act_legacy_other"]);
    expect(
      resolveKeywordOccurrenceTriggeredActions(
        slide,
        "kw_ai",
        "kwo_slide_1_kw_ai_47_49"
      ).map((action) => action.actionId)
    ).toEqual(["act_occurrence"]);
    expect(getKeywordOccurrenceTriggerIdsForSlide(slide)).toEqual([
      "kwo_slide_1_kw_ai_47_49"
    ]);
  });

  it("does not resolve broad legacy keyword actions for a keyword controlled by occurrences", () => {
    const slide = createSlide();

    expect(resolveKeywordTriggeredActions(slide, "kw_ai")).toEqual([]);
  });

  it("keeps a legacy keyword next-slide action available beside occurrence animations", () => {
    const baseSlide = createSlide();
    const slide = {
      ...baseSlide,
      actions: [
        ...baseSlide.actions,
        {
          actionId: "act_legacy_advance",
          trigger: { kind: "keyword" as const, keywordId: "kw_ai" },
          effect: { kind: "go-to-next-slide" as const }
        }
      ]
    };

    expect(
      resolveKeywordTriggeredActions(slide, "kw_ai").map((action) => action.actionId)
    ).toEqual(["act_legacy_advance"]);
  });

  it("consumes an occurrence action when manual progression plays its step", () => {
    const slide = createSlide();
    const slideAnimationPlan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: getTriggerAnimationIdsForSlide(slide)
    });
    const update = resolveManualAnimationPlaybackUpdate({
      playbackState: { playedAnimationIds: ["anim_legacy"] },
      presenterStepIndex: 1,
      slide,
      slideAnimationPlan
    });

    expect(update.playbackState.playedAnimationIds).toEqual([
      "anim_legacy",
      "anim_occurrence"
    ]);
    expect(update.presenterStepIndex).toBe(2);
    expect(update.consumedOccurrenceIds).toEqual([
      "kwo_slide_1_kw_ai_47_49"
    ]);
    expect(update.shouldAdvanceSlide).toBe(false);
  });

  it("plays action-free click steps and advances only after the final step", () => {
    const baseSlide = createSlide();
    const slide = {
      ...baseSlide,
      actions: [],
      animations: [
        {
          ...baseSlide.animations[0]!,
          animationId: "anim_manual",
          startMode: "on-click" as const
        }
      ]
    };
    const slideAnimationPlan = createSlideshowAnimationPlan({ slide });
    const firstUpdate = resolveManualAnimationPlaybackUpdate({
      playbackState: { playedAnimationIds: [] },
      presenterStepIndex: 0,
      slide,
      slideAnimationPlan
    });
    const finalUpdate = resolveManualAnimationPlaybackUpdate({
      playbackState: firstUpdate.playbackState,
      presenterStepIndex: firstUpdate.presenterStepIndex,
      slide,
      slideAnimationPlan
    });

    expect(firstUpdate.playbackState.playedAnimationIds).toEqual(["anim_manual"]);
    expect(firstUpdate.shouldAdvanceSlide).toBe(false);
    expect(finalUpdate.shouldAdvanceSlide).toBe(true);
  });

  it("reconstructs played animations and consumed occurrences for a recovery step", () => {
    const slide = createSlide();
    const slideAnimationPlan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: getTriggerAnimationIdsForSlide(slide),
    });

    expect(
      restoreSlidePlaybackAtStep({
        slide,
        slideAnimationPlan,
        stepIndex: 1,
      }),
    ).toEqual({
      consumedOccurrenceIds: [],
      playbackState: { playedAnimationIds: ["anim_legacy"] },
      presenterStepIndex: 1,
    });
    expect(
      restoreSlidePlaybackAtStep({
        slide,
        slideAnimationPlan,
        stepIndex: 99,
      }),
    ).toEqual({
      consumedOccurrenceIds: ["kwo_slide_1_kw_ai_47_49"],
      playbackState: {
        playedAnimationIds: ["anim_legacy", "anim_occurrence"],
      },
      presenterStepIndex: 2,
    });
  });
});

function createSlide(): Slide {
  return {
    kind: "content",
    slideId: "slide_1",
    order: 1,
    title: "AI",
    thumbnailUrl: "",
    style: {},
    speakerNotes:
      "오늘은 AI 덱 생성 파이프라인을 소개합니다. 중간에도 AI를 언급합니다. 마지막에 AI를 말하면 이미지가 나타납니다.",
    keywords: [
      {
        keywordId: "kw_ai",
        text: "AI",
        synonyms: [],
        abbreviations: [],
        required: true
      },
      {
        keywordId: "kw_other",
        text: "ORBIT",
        synonyms: [],
        abbreviations: [],
        required: false
      }
    ],
    semanticCues: [],
    elements: [],
    animations: [
      {
        animationId: "anim_legacy",
        elementId: "el_1",
        type: "fade-in",
        order: 1,
        durationMs: 400,
        delayMs: 0,
        easing: "ease-out"
      },
      {
        animationId: "anim_occurrence",
        elementId: "el_2",
        type: "fade-in",
        order: 2,
        durationMs: 400,
        delayMs: 0,
        easing: "ease-out"
      }
    ],
    actions: [
      {
        actionId: "act_legacy_ai",
        trigger: {
          kind: "keyword",
          keywordId: "kw_ai"
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_legacy"
        }
      },
      {
        actionId: "act_legacy_other",
        trigger: {
          kind: "keyword",
          keywordId: "kw_other"
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_legacy"
        }
      },
      {
        actionId: "act_occurrence",
        trigger: {
          kind: "keyword-occurrence",
          keywordId: "kw_ai",
          occurrenceId: "kwo_slide_1_kw_ai_47_49"
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_occurrence"
        }
      }
    ],
    aiNotes: {
      emphasisPoints: [],
      sourceEvidence: []
    }
  };
}
