import type { Deck, Slide } from "@orbit/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ElementPresentationState } from "../../slides/rendering/ReadOnlySlideCanvas";
import {
  computeSettledElementStates,
  createBaseElementStates,
  createSlideshowAnimationPlan
} from "./slideshowStepModel";
import {
  getSlideshowTransitionDurationMs,
  type SlideshowTransitionAnimation
} from "./slideshowTransitionTiming";

export {
  createSlideshowEntryTransitionTimeline,
  getSlideshowTransitionDurationMs
} from "./slideshowTransitionTiming";

export function useSlideshowTransitions(args: {
  deck: Deck;
  playInitialEntryAnimations?: boolean;
  reducedMotion: boolean;
  slide: Slide;
  stepIndex: number;
  triggerAnimationIds?: Iterable<string>;
}) {
  const playInitialEntryAnimations = args.playInitialEntryAnimations ?? true;
  const triggerAnimationIds = useMemo(
    () => [...(args.triggerAnimationIds ?? [])],
    [args.triggerAnimationIds]
  );
  const plan = useMemo(
    () =>
      createSlideshowAnimationPlan({
        slide: args.slide,
        triggerAnimationIds
      }),
    [args.slide, triggerAnimationIds]
  );
  const initialEntryPlan = useMemo(
    () =>
      createSlideshowAnimationPlan({
        slide: args.slide,
        transitionDurationMs: 0,
        triggerAnimationIds
      }),
    [args.slide, triggerAnimationIds]
  );
  const targetStates = useMemo(
    () =>
      computeSettledElementStates({
        deck: args.deck,
        slide: args.slide,
        stepIndex: args.stepIndex,
        triggerAnimationIds
      }),
    [args.deck, args.slide, args.stepIndex, triggerAnimationIds]
  );
  const baseStates = useMemo(
    () => createBaseElementStates(args.deck, args.slide),
    [args.deck, args.slide]
  );
  const [displayFrame, setDisplayFrame] = useState(() => ({
    slideId: args.slide.slideId,
    states:
      !args.reducedMotion &&
      playInitialEntryAnimations &&
      args.stepIndex === 0 &&
      initialEntryPlan.entryAnimations.length > 0
        ? createSlideshowTransitionStartStates(
            targetStates,
            initialEntryPlan.entryAnimations,
            baseStates
          )
        : targetStates
  }));
  const previousAddressRef = useRef<{
    slideId: string;
    stepIndex: number;
  } | null>(null);
  const frameRef = useRef<number | null>(null);
  const settledStatesRef = useRef(targetStates);

  useEffect(() => {
    const previousAddress = previousAddressRef.current;
    const previousSettledStates = settledStatesRef.current;
    previousAddressRef.current = {
      slideId: args.slide.slideId,
      stepIndex: args.stepIndex
    };
    settledStatesRef.current = targetStates;

    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    const isInitialEntry =
      previousAddress === null &&
      playInitialEntryAnimations &&
      args.stepIndex === 0;
    const isSlideChange =
      previousAddress !== null && previousAddress.slideId !== args.slide.slideId;
    const shouldPlaySlideEntry = isSlideChange && args.stepIndex === 0;
    const stepDelta =
      previousAddress === null ? 0 : args.stepIndex - previousAddress.stepIndex;
    const activePlan = isInitialEntry ? initialEntryPlan : plan;
    const transitionAnimations = isInitialEntry || shouldPlaySlideEntry
      ? activePlan.entryAnimations
      : stepDelta === 1
        ? plan.triggerSteps[args.stepIndex - 1]?.animations ?? []
        : [];
    const shouldPlayTransition = isInitialEntry || shouldPlaySlideEntry || stepDelta === 1;

    if (
      args.reducedMotion ||
      transitionAnimations.length === 0 ||
      !shouldPlayTransition
    ) {
      setDisplayFrame({ slideId: args.slide.slideId, states: targetStates });
      return;
    }

    const startStates = createSlideshowTransitionStartStates(
      targetStates,
      transitionAnimations,
      isInitialEntry || shouldPlaySlideEntry ? baseStates : previousSettledStates
    );
    const durationMs = getSlideshowTransitionDurationMs(transitionAnimations);
    const startedAt = performance.now();

    setDisplayFrame({ slideId: args.slide.slideId, states: startStates });

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);

      setDisplayFrame({
        slideId: args.slide.slideId,
        states: interpolateSlideshowTransitionStates({
          animations: transitionAnimations,
          baseStates,
          progress,
          startStates,
          targetStates,
          transitionDurationMs: durationMs
        })
      });

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
        setDisplayFrame({ slideId: args.slide.slideId, states: targetStates });
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [
    args.reducedMotion,
    args.slide.slideId,
    args.stepIndex,
    baseStates,
    initialEntryPlan,
    plan,
    playInitialEntryAnimations,
    targetStates
  ]);

  return {
    animationPlan: plan,
    elementStates: resolveSlideshowDisplayStates({
      baseStates,
      displaySlideId: displayFrame.slideId,
      displayStates: displayFrame.states,
      entryAnimations: plan.entryAnimations,
      reducedMotion: args.reducedMotion,
      slideId: args.slide.slideId,
      stepIndex: args.stepIndex,
      targetStates
    }),
    settledElementStates: targetStates
  };
}

export function resolveSlideshowDisplayStates(args: {
  baseStates: Record<string, ElementPresentationState>;
  displaySlideId: string;
  displayStates: Record<string, ElementPresentationState>;
  entryAnimations: SlideshowTransitionAnimation[];
  reducedMotion: boolean;
  slideId: string;
  stepIndex: number;
  targetStates: Record<string, ElementPresentationState>;
}) {
  if (args.displaySlideId === args.slideId) {
    return args.displayStates;
  }
  if (
    !args.reducedMotion &&
    args.stepIndex === 0 &&
    args.entryAnimations.length > 0
  ) {
    return createSlideshowTransitionStartStates(
      args.targetStates,
      args.entryAnimations,
      args.baseStates
    );
  }
  return args.targetStates;
}

export function createSlideshowTransitionStartStates(
  targetStates: Record<string, ElementPresentationState>,
  animations: SlideshowTransitionAnimation[],
  referenceStates: Record<string, ElementPresentationState> = targetStates
) {
  const states = cloneElementStates(targetStates);
  const initializedElementIds = new Set<string>();

  for (const animation of animations) {
    if (initializedElementIds.has(animation.elementId)) {
      continue;
    }
    const state = states[animation.elementId];

    if (!state) {
      continue;
    }
    initializedElementIds.add(animation.elementId);
    const referenceState = referenceStates[animation.elementId] ?? state;

    switch (animation.type) {
      case "appear":
      case "fade-in":
        state.visible = true;
        state.opacity = 0;
        break;
      case "zoom-in":
        state.visible = true;
        state.opacity = state.opacity ?? 1;
        state.scaleX = 0;
        state.scaleY = 0;
        break;
      case "disappear":
      case "fade-out":
      case "zoom-out":
        state.visible = true;
        state.opacity = referenceState.opacity ?? state.opacity ?? 1;
        state.scaleX = referenceState.scaleX ?? 1;
        state.scaleY = referenceState.scaleY ?? 1;
        break;
      case "rotate":
        state.rotation =
          referenceState.rotation ?? targetStates[animation.elementId]?.rotation ?? 0;
        break;
    }
  }

  return states;
}

export function interpolateSlideshowTransitionStates(args: {
  animations: SlideshowTransitionAnimation[];
  baseStates?: Record<string, ElementPresentationState>;
  progress: number;
  startStates: Record<string, ElementPresentationState>;
  targetStates: Record<string, ElementPresentationState>;
  transitionDurationMs?: number;
}) {
  if (args.progress >= 1) {
    return cloneElementStates(args.targetStates);
  }

  const states = cloneElementStates(args.startStates);
  const transitionDurationMs =
    args.transitionDurationMs ?? getSlideshowTransitionDurationMs(args.animations);

  for (const animation of args.animations) {
    const state = states[animation.elementId];

    if (!state) {
      continue;
    }

    const progress = applyDelay(animation, args.progress, transitionDurationMs);
    if (progress <= 0) {
      continue;
    }
    const base =
      args.baseStates?.[animation.elementId] ??
      args.targetStates[animation.elementId] ??
      state;
    const start = { ...state };

    switch (animation.type) {
      case "appear":
      case "fade-in":
        state.visible = true;
        state.opacity = lerp(start.opacity ?? 0, base.opacity ?? 1, progress);
        if (progress >= 1) {
          state.visible = true;
        }
        break;
      case "disappear":
      case "fade-out":
        state.visible = true;
        state.opacity = lerp(start.opacity ?? base.opacity ?? 1, 0, progress);
        if (progress >= 1) {
          state.visible = false;
        }
        break;
      case "zoom-in":
        state.visible = true;
        state.opacity = lerp(start.opacity ?? 0, base.opacity ?? 1, progress);
        state.scaleX = lerp(start.scaleX ?? 0, 1, progress);
        state.scaleY = lerp(start.scaleY ?? 0, 1, progress);
        if (progress >= 1) {
          state.visible = true;
        }
        break;
      case "zoom-out":
        state.visible = true;
        state.opacity = lerp(start.opacity ?? base.opacity ?? 1, 0, progress);
        state.scaleX = lerp(start.scaleX ?? base.scaleX ?? 1, 0, progress);
        state.scaleY = lerp(start.scaleY ?? base.scaleY ?? 1, 0, progress);
        if (progress >= 1) {
          state.visible = false;
        }
        break;
      case "rotate":
        state.rotation = (start.rotation ?? base.rotation ?? 0) + 360 * progress;
        if (progress >= 1) {
          state.rotation = base.rotation;
        }
        break;
    }
  }

  return states;
}

function applyDelay(
  animation: SlideshowTransitionAnimation,
  progress: number,
  transitionDurationMs: number
) {
  const safeTransitionDurationMs = Math.max(1, transitionDurationMs);
  const elapsedMs = progress * safeTransitionDurationMs;
  const effectiveDelayMs = Math.min(
    animation.transitionDelayMs ?? animation.delayMs,
    Math.max(0, safeTransitionDurationMs - 1)
  );
  const effectiveDurationMs = Math.max(
    1,
    animation.durationMs
  );
  const delayedProgress =
    (elapsedMs - effectiveDelayMs) / effectiveDurationMs;

  return Math.min(1, Math.max(0, delayedProgress));
}

function cloneElementStates(states: Record<string, ElementPresentationState>) {
  return Object.fromEntries(
    Object.entries(states).map(([elementId, state]) => [elementId, { ...state }])
  );
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}
