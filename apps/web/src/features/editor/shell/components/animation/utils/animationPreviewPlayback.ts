import type { Deck, Slide } from "@orbit/shared";

import {
  createBaseElementStates,
  computeSettledElementStates,
  createSlideshowAnimationPlan,
  type PlannedSlideshowAnimation
} from "../../../../../rehearsal/presenter/slideshowStepModel";
import {
  createSlideshowTransitionStartStates,
  getSlideshowTransitionDurationMs
} from "../../../../../rehearsal/presenter/useSlideshowTransitions";
import type { ElementPresentationState } from "../../../../../slides/rendering";

export type EditorAnimationPreviewPlan = {
  baseStates: Record<string, ElementPresentationState>;
  durationMs: number;
  startStates: Record<string, ElementPresentationState>;
  targetStates: Record<string, ElementPresentationState>;
  timeline: PlannedSlideshowAnimation[];
};

export function createEditorAnimationPreviewPlan(
  deck: Deck,
  slide: Slide
): EditorAnimationPreviewPlan | null {
  if (slide.animations.length === 0) {
    return null;
  }

  const triggerAnimationIds = slide.actions.flatMap((action) =>
    action.effect.kind === "play-animation"
      ? [action.effect.animationId]
      : []
  );
  const animationPlan = createSlideshowAnimationPlan({
    slide,
    triggerAnimationIds
  });
  const timeline = createPreviewTimeline(animationPlan);

  if (timeline.length === 0) {
    return null;
  }

  const targetStates = computeSettledElementStates({
    deck,
    slide,
    stepIndex: animationPlan.maxStepIndex,
    triggerAnimationIds
  });
  const baseStates = createBaseElementStates(deck, slide);
  const startStates = createSlideshowTransitionStartStates(
    targetStates,
    timeline,
    baseStates
  );

  return {
    baseStates,
    durationMs: getSlideshowTransitionDurationMs(timeline),
    startStates,
    targetStates,
    timeline
  };
}

function createPreviewTimeline(
  plan: ReturnType<typeof createSlideshowAnimationPlan>
) {
  let nextStepStartMs = plan.entryDurationMs;
  const timeline: PlannedSlideshowAnimation[] = [...plan.entryAnimations];

  for (const step of plan.triggerSteps) {
    timeline.push(
      ...step.animations.map((animation) => ({
        ...animation,
        timelineStartMs: nextStepStartMs + animation.timelineStartMs,
        transitionDelayMs: nextStepStartMs + animation.timelineStartMs
      }))
    );
    nextStepStartMs += step.durationMs;
  }

  return timeline;
}
