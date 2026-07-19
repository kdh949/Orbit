import { useState } from "react";
import type { DeckAnimationStartMode } from "@orbit/shared";

import type { SupportedAnimationType } from "../types";

type AnimationDraftState = Record<
  SupportedAnimationType,
  {
    delayMs: number;
    durationMs: number;
    startMode: DeckAnimationStartMode;
  }
>;

const initialDraftState: AnimationDraftState = {
  "fade-in": {
    delayMs: 0,
    durationMs: 400,
    startMode: "on-click"
  },
  "fade-out": {
    delayMs: 0,
    durationMs: 400,
    startMode: "on-click"
  }
};

export function useAnimationDrafts() {
  const [draftByType, setDraftByType] = useState<AnimationDraftState>(initialDraftState);

  function updateDraft(
    type: SupportedAnimationType,
    patch: Partial<AnimationDraftState[SupportedAnimationType]>
  ) {
    setDraftByType((current) => ({
      ...current,
      [type]: {
        ...current[type],
        ...patch
      }
    }));
  }

  return {
    draftByType,
    updateDraft
  };
}
