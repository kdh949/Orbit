import type { DeckAnimation } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import {
  animationTimelineDiagnosticLimit,
  createAnimationTimeline,
  type AnimationStartMode,
  type TimelineAnimationInput
} from "./animationTimeline";

describe("animationTimeline", () => {
  it("stable-sorts logical order without treating duplicate order as concurrency", () => {
    const plan = createAnimationTimeline({
      animations: [
        createAnimation("anim_z", { order: 2, startMode: "on-click" }),
        createAnimation("anim_b", { order: 1, startMode: "on-slide-enter" }),
        createAnimation("anim_a", { order: 1, startMode: "after-previous" })
      ]
    });

    expect(plan.effects.map((effect) => effect.animationId)).toEqual([
      "anim_b",
      "anim_a",
      "anim_z"
    ]);
    expect(plan.effects.map((effect) => effect.sourceIndex)).toEqual([1, 2, 0]);
    expect(plan.entryRoots[0]?.effects.map((effect) => effect.animationId)).toEqual([
      "anim_b",
      "anim_a"
    ]);
  });

  it("computes all four modes from explicit base references", () => {
    const plan = createAnimationTimeline({
      animations: [
        createAnimation("anim_entry", {
          delayMs: 100,
          durationMs: 300,
          order: 1,
          startMode: "on-slide-enter"
        }),
        createAnimation("anim_with_entry", {
          delayMs: 50,
          durationMs: 200,
          order: 2,
          startMode: "with-previous"
        }),
        createAnimation("anim_after_with", {
          delayMs: 25,
          durationMs: 100,
          order: 3,
          startMode: "after-previous"
        }),
        createAnimation("anim_click", {
          delayMs: 10,
          durationMs: 800,
          order: 4,
          startMode: "on-click"
        }),
        createAnimation("anim_with_click", {
          delayMs: 20,
          durationMs: 100,
          order: 5,
          startMode: "with-previous"
        }),
        createAnimation("anim_after_click", {
          delayMs: 30,
          durationMs: 200,
          order: 6,
          startMode: "after-previous"
        })
      ]
    });

    expect(
      plan.entryRoots[0]?.effects.map(({ animationId, startMs, endMs }) => ({
        animationId,
        endMs,
        startMs
      }))
    ).toEqual([
      { animationId: "anim_entry", startMs: 100, endMs: 400 },
      { animationId: "anim_with_entry", startMs: 50, endMs: 250 },
      { animationId: "anim_after_with", startMs: 275, endMs: 375 }
    ]);
    expect(
      plan.clickSteps[0]?.effects.map(({ animationId, startMs, endMs }) => ({
        animationId,
        endMs,
        startMs
      }))
    ).toEqual([
      { animationId: "anim_click", startMs: 10, endMs: 810 },
      { animationId: "anim_with_click", startMs: 20, endMs: 120 },
      { animationId: "anim_after_click", startMs: 150, endMs: 350 }
    ]);
    expect(plan.totalDurationMs).toBe(1210);
  });

  it("anchors an orphan after-previous to the destination transition end", () => {
    const plan = createAnimationTimeline({
      animations: [
        createAnimation("anim_orphan_after", {
          delayMs: 50,
          durationMs: 100,
          order: 1,
          startMode: "after-previous"
        }),
        createAnimation("anim_with_orphan", {
          delayMs: 10,
          durationMs: 50,
          order: 2,
          startMode: "with-previous"
        })
      ],
      transitionDurationMs: 700
    });

    expect(plan.entryRoots[0]?.effects.map((effect) => effect.startMs)).toEqual([
      750,
      710
    ]);
    expect(plan.diagnostics).toEqual([
      {
        animationId: "anim_orphan_after",
        code: "orphan-after-previous"
      }
    ]);
  });

  it("keeps missing-target diagnostics bounded", () => {
    const animations = Array.from(
      { length: animationTimelineDiagnosticLimit + 5 },
      (_, index) =>
        createAnimation(`anim_missing_${index.toString().padStart(3, "0")}`, {
          elementId: `el_missing_${index}`,
          order: index + 1,
          startMode: index === 0 ? "on-slide-enter" : "after-previous"
        })
    );
    const plan = createAnimationTimeline({ animations, targetElementIds: [] });

    expect(plan.effects).toHaveLength(animationTimelineDiagnosticLimit + 5);
    expect(plan.diagnostics).toHaveLength(animationTimelineDiagnosticLimit);
    expect(plan.diagnosticsTruncatedCount).toBe(5);
  });

  it("preserves legacy action-referenced order groups", () => {
    const plan = createAnimationTimeline({
      animations: [
        createAnimation("anim_entry_root", { order: 1, startMode: undefined }),
        createAnimation("anim_entry_follower", { order: 1, startMode: undefined }),
        createAnimation("anim_click_root", { order: 2, startMode: undefined }),
        createAnimation("anim_click_follower", { order: 2, startMode: undefined })
      ],
      legacyOnClickAnimationIds: ["anim_click_follower"]
    });

    expect(plan.entryRoots[0]?.effects.map((effect) => effect.startMode)).toEqual([
      "on-slide-enter",
      "with-previous"
    ]);
    expect(plan.clickSteps[0]?.effects.map((effect) => effect.startMode)).toEqual([
      "on-click",
      "with-previous"
    ]);
  });
});

function createAnimation(
  animationId: string,
  patch: Partial<DeckAnimation> & {
    startMode?: AnimationStartMode;
  } = {}
): TimelineAnimationInput {
  return {
    animationId,
    delayMs: 0,
    durationMs: 400,
    easing: "ease-out",
    elementId: `el_${animationId}`,
    order: 1,
    type: "fade-in",
    ...patch
  };
}
