import { createAnimationTimeline } from "@orbit/editor-core";
import type { DeckAnimation } from "@orbit/shared";

export type SlideshowTransitionAnimation = DeckAnimation & {
  timelineStartMs?: number;
  transitionDelayMs?: number;
};

export function createSlideshowEntryTransitionTimeline(
  animations: DeckAnimation[],
  transitionDurationMs = 0
): SlideshowTransitionAnimation[] {
  const timeline = createAnimationTimeline({
    animations,
    transitionDurationMs
  });

  return timeline.entryRoots.flatMap((root) =>
    root.effects.map((animation) => ({
      ...animation,
      timelineStartMs: animation.startMs,
      transitionDelayMs: animation.startMs
    }))
  );
}

export function sequenceEntryAnimationsByOrder(animations: DeckAnimation[]) {
  return createSlideshowEntryTransitionTimeline(animations);
}

export function getSequencedEntryTransitionDurationMs(
  animations: SlideshowTransitionAnimation[]
) {
  return getSlideshowTransitionDurationMs(animations);
}

export function getSlideshowTransitionDurationMs(
  animations: SlideshowTransitionAnimation[]
) {
  return Math.max(
    0,
    ...animations.map(
      (animation) =>
        (animation.transitionDelayMs ?? animation.delayMs) +
        Math.max(1, animation.durationMs)
    )
  );
}
