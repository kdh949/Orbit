import type { DeckAnimation } from "@orbit/shared";
import { describe, expect, it } from "vitest";
import {
  createSlideshowEntryTransitionTimeline,
  getSequencedEntryTransitionDurationMs,
  getSlideshowTransitionDurationMs,
} from "./slideshowTransitionTiming";

describe("slideshowTransitionTiming", () => {
  it("preserves the authored duration and delay", () => {
    expect(
      getSlideshowTransitionDurationMs([
        createAnimation({
          animationId: "anim_fade_out",
          durationMs: 800,
          elementId: "el_target",
          order: 1,
          type: "fade-out",
          delayMs: 200
        })
      ])
    ).toBe(1000);
  });

  it("sequences entry animations by order groups before applying per-animation delay", () => {
    const sequencedAnimations = createSlideshowEntryTransitionTimeline([
      createAnimation({
        animationId: "anim_first",
        elementId: "el_first",
        order: 1,
        startMode: "on-slide-enter"
      }),
      createAnimation({
        animationId: "anim_same_second",
        elementId: "el_same_second",
        order: 2,
        durationMs: 200,
        startMode: "after-previous"
      }),
      createAnimation({
        animationId: "anim_second",
        elementId: "el_second",
        order: 2,
        delayMs: 50,
        startMode: "with-previous"
      })
    ]);

    expect(sequencedAnimations.map((animation) => animation.animationId)).toEqual([
      "anim_first",
      "anim_same_second",
      "anim_second"
    ]);
    expect(
      sequencedAnimations.map((animation) => animation.transitionDelayMs)
    ).toEqual([
      0,
      200,
      250
    ]);
    expect(getSequencedEntryTransitionDurationMs(sequencedAnimations)).toBe(450);
  });
});

function createAnimation(
  animation: Partial<DeckAnimation> & Pick<DeckAnimation, "animationId" | "elementId">
): DeckAnimation {
  return {
    type: "fade-in",
    order: 1,
    durationMs: 200,
    delayMs: 0,
    easing: "ease-out",
    ...animation
  };
}
