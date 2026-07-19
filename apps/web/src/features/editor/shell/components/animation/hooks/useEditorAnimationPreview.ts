import type { Deck, Slide } from "@orbit/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { interpolateSlideshowTransitionStates } from "../../../../../rehearsal/presenter/useSlideshowTransitions";
import { useReducedMotion } from "../../../../../rehearsal/presenter/useReducedMotion";
import type { ElementPresentationState } from "../../../../../slides/rendering";
import { createEditorAnimationPreviewPlan } from "../utils/animationPreviewPlayback";

const finalStateHoldMs = 180;

export function useEditorAnimationPreview(args: {
  deck: Deck;
  slide: Slide | null;
}) {
  const { deck, slide } = args;
  const reducedMotion = useReducedMotion();
  const [elementStates, setElementStates] = useState<
    Record<string, ElementPresentationState> | null
  >(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const frameRef = useRef<number | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const plan = useMemo(
    () => (slide ? createEditorAnimationPreviewPlan(deck, slide) : null),
    [deck, slide]
  );

  const cancelPlayback = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    setIsPlaying(false);
    setElementStates(null);
  }, []);

  useEffect(() => cancelPlayback, [cancelPlayback]);
  useEffect(() => {
    cancelPlayback();
  }, [cancelPlayback, slide?.slideId]);

  const play = useCallback(() => {
    if (!plan) {
      return;
    }

    cancelPlayback();
    setIsPlaying(true);

    if (reducedMotion) {
      setElementStates(plan.targetStates);
      resetTimerRef.current = setTimeout(cancelPlayback, finalStateHoldMs);
      return;
    }

    const startedAt = performance.now();
    setElementStates(plan.startStates);

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / plan.durationMs);

      setElementStates(
        interpolateSlideshowTransitionStates({
          animations: plan.timeline,
          baseStates: plan.baseStates,
          progress,
          startStates: plan.startStates,
          targetStates: plan.targetStates,
          transitionDurationMs: plan.durationMs
        })
      );

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      frameRef.current = null;
      setElementStates(plan.targetStates);
      resetTimerRef.current = setTimeout(cancelPlayback, finalStateHoldMs);
    };

    frameRef.current = requestAnimationFrame(tick);
  }, [cancelPlayback, plan, reducedMotion]);

  return {
    canPlay: Boolean(plan),
    elementStates,
    isPlaying,
    play
  };
}
