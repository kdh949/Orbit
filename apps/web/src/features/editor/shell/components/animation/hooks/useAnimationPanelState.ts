import type { DeckAnimation } from "@orbit/shared/deck";
import { useEffect, useMemo, useState } from "react";

import type { AnimationPanelMode, SupportedAnimationType } from "../types";

export function useAnimationPanelState(
  animations: DeckAnimation[],
  preferredAnimationId?: string | null
) {
  const [selectedAnimationId, setSelectedAnimationId] = useState<string | null>(
    animations[0]?.animationId ?? null
  );
  const [creationType, setCreationType] =
    useState<SupportedAnimationType | null>(null);

  useEffect(() => {
    if (
      preferredAnimationId &&
      animations.some((animation) => animation.animationId === preferredAnimationId)
    ) {
      setSelectedAnimationId(preferredAnimationId);
      setCreationType(null);
    }
  }, [animations, preferredAnimationId]);

  useEffect(() => {
    if (!creationType) {
      return;
    }

    const createdAnimation = animations.find(
      (animation) => animation.type === creationType
    );

    if (!createdAnimation) {
      return;
    }

    setSelectedAnimationId(createdAnimation.animationId);
    setCreationType(null);
  }, [animations, creationType]);

  useEffect(() => {
    if (creationType !== null) {
      return;
    }

    if (
      selectedAnimationId &&
      animations.some((animation) => animation.animationId === selectedAnimationId)
    ) {
      return;
    }

    setSelectedAnimationId(animations[0]?.animationId ?? null);
  }, [animations, creationType, selectedAnimationId]);

  const selectedAnimation = useMemo(
    () =>
      selectedAnimationId
        ? animations.find(
            (animation) => animation.animationId === selectedAnimationId
          ) ?? null
        : null,
    [animations, selectedAnimationId]
  );

  const mode: AnimationPanelMode = selectedAnimation
    ? "editing-existing"
    : creationType
      ? "creating-new"
      : "idle";

  function selectAnimation(animationId: string) {
    setSelectedAnimationId(animationId);
    setCreationType(null);
  }

  function startCreating(type: SupportedAnimationType) {
    setSelectedAnimationId(null);
    setCreationType(type);
  }

  return {
    creationType,
    mode,
    selectAnimation,
    selectedAnimation,
    selectedAnimationId,
    startCreating
  };
}
