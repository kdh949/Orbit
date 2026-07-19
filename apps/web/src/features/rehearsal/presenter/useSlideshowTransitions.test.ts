import fs from "node:fs";
import path from "node:path";
import type { DeckAnimation } from "@orbit/shared";
import { describe, expect, it } from "vitest";
import {
  createSlideshowEntryTransitionTimeline,
  createSlideshowTransitionStartStates,
  getSlideshowTransitionDurationMs,
  interpolateSlideshowTransitionStates,
  resolveSlideshowDisplayStates
} from "./useSlideshowTransitions";

const fadeOutAnimation: DeckAnimation = {
  animationId: "anim_fade_out",
  elementId: "el_target",
  type: "fade-out",
  order: 1,
  durationMs: 800,
  delayMs: 200,
  easing: "ease-out"
};

describe("useSlideshowTransitions helpers", () => {
  it("preserves individual animation duration and delay", () => {
    expect(getSlideshowTransitionDurationMs([fadeOutAnimation])).toBe(1000);
  });

  it("creates visible start states for exit animations", () => {
    const startStates = createSlideshowTransitionStartStates(
      {
        el_target: {
          opacity: 0,
          scaleX: 1,
          scaleY: 1,
          visible: false
        }
      },
      [fadeOutAnimation],
      {
        el_target: {
          opacity: 0.55,
          scaleX: 1,
          scaleY: 1,
          visible: true
        }
      }
    );

    expect(startStates.el_target).toMatchObject({
      opacity: 0.55,
      scaleX: 1,
      scaleY: 1,
      visible: true
    });
  });

  it("keeps rotate transient and restores final rotation", () => {
    const animation: DeckAnimation = {
      animationId: "anim_rotate",
      elementId: "el_target",
      type: "rotate",
      order: 1,
      durationMs: 400,
      delayMs: 0,
      easing: "ease-out"
    };
    const targetStates = {
      el_target: {
        rotation: 15,
        visible: true
      }
    };
    const startStates = createSlideshowTransitionStartStates(targetStates, [
      animation
    ]);
    const half = interpolateSlideshowTransitionStates({
      animations: [animation],
      progress: 0.5,
      startStates,
      targetStates
    });
    const done = interpolateSlideshowTransitionStates({
      animations: [animation],
      progress: 1,
      startStates,
      targetStates
    });

    expect(half.el_target?.rotation).toBe(195);
    expect(done.el_target?.rotation).toBe(15);
  });

  it("uses the step group duration when interpolating simultaneous animations", () => {
    const shortAnimation: DeckAnimation = {
      animationId: "anim_short",
      elementId: "el_short",
      type: "fade-in",
      order: 1,
      durationMs: 200,
      delayMs: 0,
      easing: "ease-out"
    };
    const longAnimation: DeckAnimation = {
      animationId: "anim_long",
      elementId: "el_long",
      type: "fade-in",
      order: 1,
      durationMs: 500,
      delayMs: 0,
      easing: "ease-out"
    };
    const startStates = {
      el_short: { opacity: 0, visible: true },
      el_long: { opacity: 0, visible: true }
    };
    const targetStates = {
      el_short: { opacity: 1, visible: true },
      el_long: { opacity: 1, visible: true }
    };

    const states = interpolateSlideshowTransitionStates({
      animations: [shortAnimation, longAnimation],
      progress: 0.4,
      startStates,
      targetStates,
      transitionDurationMs: 500
    });

    expect(states.el_short?.opacity).toBe(1);
    expect(states.el_long?.opacity).toBe(0.4);
  });

  it("plays delayed animations across the computed transition window", () => {
    const delayedAnimation: DeckAnimation = {
      animationId: "anim_delayed",
      elementId: "el_delayed",
      type: "fade-in",
      order: 1,
      durationMs: 400,
      delayMs: 400,
      easing: "ease-out"
    };
    const startStates = {
      el_delayed: { opacity: 0, visible: true }
    };
    const targetStates = {
      el_delayed: { opacity: 1, visible: true }
    };
    const transitionDurationMs = getSlideshowTransitionDurationMs([delayedAnimation]);

    const states = interpolateSlideshowTransitionStates({
      animations: [delayedAnimation],
      progress: 1,
      startStates,
      targetStates,
      transitionDurationMs
    });

    expect(states.el_delayed).toMatchObject({ opacity: 1, visible: true });
  });

  it("composes sequential effects on the same element from each prior keyframe", () => {
    const animations = [
      {
        animationId: "anim_enter",
        elementId: "el_target",
        type: "fade-in" as const,
        order: 1,
        startMode: "on-click" as const,
        durationMs: 100,
        delayMs: 0,
        easing: "linear" as const,
        transitionDelayMs: 0
      },
      {
        animationId: "anim_exit",
        elementId: "el_target",
        type: "fade-out" as const,
        order: 2,
        startMode: "after-previous" as const,
        durationMs: 100,
        delayMs: 0,
        easing: "linear" as const,
        transitionDelayMs: 100
      }
    ];
    const baseStates = {
      el_target: { opacity: 1, visible: true }
    };
    const targetStates = {
      el_target: { opacity: 0, visible: false }
    };
    const startStates = createSlideshowTransitionStartStates(
      targetStates,
      animations,
      baseStates
    );
    const opacityAt = (progress: number) =>
      interpolateSlideshowTransitionStates({
        animations,
        baseStates,
        progress,
        startStates,
        targetStates,
        transitionDurationMs: 200
      }).el_target?.opacity;

    expect(opacityAt(0.25)).toBe(0.5);
    expect(opacityAt(0.5)).toBe(1);
    expect(opacityAt(0.75)).toBe(0.5);
    expect(opacityAt(1)).toBe(0);
  });

  it("builds entry autoplay timeline by order groups", () => {
    const firstOrder: DeckAnimation = {
      animationId: "anim_first",
      elementId: "el_first",
      type: "fade-in",
      order: 1,
      startMode: "on-slide-enter",
      durationMs: 100,
      delayMs: 0,
      easing: "ease-out"
    };
    const secondOrder: DeckAnimation = {
      animationId: "anim_second",
      elementId: "el_second",
      type: "fade-in",
      order: 2,
      startMode: "with-previous",
      durationMs: 100,
      delayMs: 50,
      easing: "ease-out"
    };
    const sameSecondOrder: DeckAnimation = {
      animationId: "anim_same_second",
      elementId: "el_same_second",
      type: "fade-in",
      order: 2,
      startMode: "after-previous",
      durationMs: 200,
      delayMs: 0,
      easing: "ease-out"
    };

    const timeline = createSlideshowEntryTransitionTimeline([
      firstOrder,
      sameSecondOrder,
      secondOrder
    ]);

    expect(timeline.map((animation) => animation.animationId)).toEqual([
      "anim_first",
      "anim_same_second",
      "anim_second"
    ]);
    expect(timeline.map((animation) => animation.transitionDelayMs)).toEqual([
      0,
      100,
      150
    ]);
    expect(getSlideshowTransitionDurationMs(timeline)).toBe(300);
  });

  it("uses the new slide's settled state on the first reduced-motion commit", () => {
    const oldDisplayStates = {
      el_old: { opacity: 1, visible: true }
    };
    const newTargetStates = {
      el_new: { opacity: 0, visible: false }
    };

    expect(
      resolveSlideshowDisplayStates({
        baseStates: { el_new: { opacity: 1, visible: true } },
        displaySlideId: "slide_old",
        displayStates: oldDisplayStates,
        entryAnimations: [fadeOutAnimation],
        reducedMotion: true,
        slideId: "slide_new",
        stepIndex: 0,
        targetStates: newTargetStates
      })
    ).toBe(newTargetStates);
  });

  it("does not replay entry transitions when restoring a later slide step", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/features/rehearsal/presenter/useSlideshowTransitions.ts"
      ),
      "utf8"
    );
    const effectStart = source.indexOf("useEffect(() =>");
    const effectEnd = source.indexOf("const startStates =");
    const transitionSelectionBlock = source.slice(effectStart, effectEnd);

    expect(transitionSelectionBlock).toContain("isSlideChange && args.stepIndex === 0");
  });
});
