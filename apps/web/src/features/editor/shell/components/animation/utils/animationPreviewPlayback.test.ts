import { createDemoDeck } from "@orbit/editor-core";
import { describe, expect, it } from "vitest";

import { createEditorAnimationPreviewPlan } from "./animationPreviewPlayback";

describe("createEditorAnimationPreviewPlan", () => {
  it("creates visible start states for fade-in and settled hidden states for fade-out", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: [
        {
          animationId: "anim_fade_in",
          elementId: "el_1",
          type: "fade-in" as const,
          order: 1,
          startMode: "on-slide-enter" as const,
          durationMs: 400,
          delayMs: 0,
          easing: "ease-out" as const
        },
        {
          animationId: "anim_fade_out",
          elementId: "el_2",
          type: "fade-out" as const,
          order: 2,
          startMode: "after-previous" as const,
          durationMs: 300,
          delayMs: 100,
          easing: "ease-out" as const
        }
      ]
    };

    const plan = createEditorAnimationPreviewPlan(deck, slide);

    expect(plan).not.toBeNull();
    expect(plan?.timeline.map((animation) => animation.animationId)).toEqual([
      "anim_fade_in",
      "anim_fade_out"
    ]);
    expect(plan?.startStates.el_1?.visible).toBe(true);
    expect(plan?.startStates.el_1?.opacity).toBe(0);
    expect(plan?.startStates.el_2?.visible).toBe(true);
    expect(plan?.startStates.el_2?.opacity).toBe(1);
    expect(plan?.targetStates.el_1?.visible).toBe(true);
    expect(plan?.targetStates.el_1?.opacity).toBe(1);
    expect(plan?.targetStates.el_2?.visible).toBe(false);
    expect(plan?.targetStates.el_2?.opacity).toBe(0);
    expect(plan?.durationMs).toBeGreaterThan(400);
  });

  it("uses the shared root-chain offsets for entry and click preview playback", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: [
        {
          animationId: "anim_entry",
          elementId: "el_1",
          type: "fade-in" as const,
          order: 1,
          startMode: "on-slide-enter" as const,
          durationMs: 300,
          delayMs: 100,
          easing: "ease-out" as const
        },
        {
          animationId: "anim_click",
          elementId: "el_2",
          type: "fade-out" as const,
          order: 2,
          startMode: "on-click" as const,
          durationMs: 800,
          delayMs: 20,
          easing: "ease-out" as const
        },
        {
          animationId: "anim_with_click",
          elementId: "el_3",
          type: "fade-in" as const,
          order: 3,
          startMode: "with-previous" as const,
          durationMs: 100,
          delayMs: 50,
          easing: "ease-out" as const
        }
      ]
    };

    const plan = createEditorAnimationPreviewPlan(deck, slide);

    expect(
      plan?.timeline.map((animation) => ({
        animationId: animation.animationId,
        startMs: animation.transitionDelayMs
      }))
    ).toEqual([
      { animationId: "anim_entry", startMs: 100 },
      { animationId: "anim_click", startMs: 420 },
      { animationId: "anim_with_click", startMs: 450 }
    ]);
    expect(plan?.durationMs).toBe(1220);
  });

  it("returns null when the slide has no animations", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: []
    };

    expect(createEditorAnimationPreviewPlan(deck, slide)).toBeNull();
  });

  it("uses legacy action references when previewing missing start modes", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: [
        {
          animationId: "anim_entry",
          elementId: "el_1",
          type: "fade-in" as const,
          order: 1,
          durationMs: 300,
          delayMs: 0,
          easing: "ease-out" as const
        },
        {
          animationId: "anim_action",
          elementId: "el_2",
          type: "fade-in" as const,
          order: 2,
          durationMs: 300,
          delayMs: 0,
          easing: "ease-out" as const
        }
      ],
      actions: [
        {
          actionId: "act_preview",
          trigger: { kind: "cue" as const, cue: "다음" },
          effect: {
            kind: "play-animation" as const,
            animationId: "anim_action"
          }
        }
      ]
    };

    const plan = createEditorAnimationPreviewPlan(deck, slide);

    expect(
      plan?.timeline.map(({ animationId, rootKind }) => ({
        animationId,
        rootKind
      }))
    ).toEqual([
      { animationId: "anim_entry", rootKind: "slide-entry" },
      { animationId: "anim_action", rootKind: "click" }
    ]);
  });
});
