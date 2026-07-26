import type { Deck } from "@orbit/shared/deck";
import { useEffect, useRef, useState } from "react";
import type { SlideWindowRef } from "../../../runtime/presentation/displayManager";
import {
  prepareSlideAssets,
  retainSlideAssetWindow,
} from "../../slides/rendering/slideImageCache";
import {
  createSlideAssetNavigationGate,
  type SlideNavigationRequest,
  type SlideNavigationResult,
} from "../../presenter-shell/presenter/slideAssetNavigationGate";

export type RehearsalDisplayRole =
  | "presenter"
  | "slide-receiver"
  | "slide-surface";
export type RehearsalAudienceOutputMode = "slide" | "screen-share" | "black";

export function useRehearsalPresentation(options: {
  deck: Deck | null;
  initialSlideIndex: number;
  initialStepIndex: number;
}) {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(
    options.initialSlideIndex,
  );
  const [presenterStepIndex, setPresenterStepIndex] = useState(
    options.initialStepIndex,
  );
  const [displayRole, setDisplayRole] =
    useState<RehearsalDisplayRole>("presenter");
  const [audienceOutputMode, setAudienceOutputMode] =
    useState<RehearsalAudienceOutputMode>("slide");
  const [slideReceiverMessage, setSlideReceiverMessage] = useState("");
  const [isSlidePreparationPending, setIsSlidePreparationPending] =
    useState(false);
  const deckRef = useRef<Deck | null>(options.deck);
  const currentSlideIndexRef = useRef(options.initialSlideIndex);
  const presenterStepIndexRef = useRef(options.initialStepIndex);
  const slideWindowRef = useRef<SlideWindowRef | null>(null);
  const navigationGateRef = useRef<ReturnType<
    typeof createSlideAssetNavigationGate
  > | null>(null);

  if (navigationGateRef.current === null) {
    navigationGateRef.current = createSlideAssetNavigationGate({
      commit: (request) => {
        commitSlidePosition(request.targetSlideIndex, request.stepIndex);
        const deckSnapshot = deckRef.current;
        if (deckSnapshot) {
          retainSlideAssetWindow(deckSnapshot, request.targetSlideIndex);
        }
      },
      onPendingChange: setIsSlidePreparationPending,
      prepare: async (request) => {
        const deckSnapshot = deckRef.current;
        const slide = deckSnapshot?.slides[request.targetSlideIndex];
        if (!deckSnapshot || !slide) return;
        await prepareSlideAssets(deckSnapshot, slide);
      },
    });
  }

  useEffect(() => {
    deckRef.current = options.deck;
  }, [options.deck]);

  useEffect(() => {
    currentSlideIndexRef.current = currentSlideIndex;
  }, [currentSlideIndex]);

  useEffect(() => {
    presenterStepIndexRef.current = presenterStepIndex;
  }, [presenterStepIndex]);

  function commitSlidePosition(slideIndex: number, stepIndex: number) {
    currentSlideIndexRef.current = slideIndex;
    presenterStepIndexRef.current = stepIndex;
    setCurrentSlideIndex(slideIndex);
    setPresenterStepIndex(stepIndex);
  }

  function commitPresenterStep(stepIndex: number) {
    presenterStepIndexRef.current = stepIndex;
    setPresenterStepIndex(stepIndex);
  }

  function resetSlideDisplayToBeginning() {
    commitSlidePosition(0, 0);
  }

  function requestPreparedSlideChange(
    request: SlideNavigationRequest,
  ): Promise<SlideNavigationResult> {
    const deckSnapshot = deckRef.current;
    if (!deckSnapshot || deckSnapshot.slides.length === 0) {
      return Promise.resolve("ignored");
    }

    const targetSlideIndex = Math.min(
      deckSnapshot.slides.length - 1,
      Math.max(0, request.targetSlideIndex),
    );
    const normalizedRequest = { ...request, targetSlideIndex };
    const gate = navigationGateRef.current;

    if (
      targetSlideIndex === currentSlideIndexRef.current &&
      gate &&
      !gate.isPending()
    ) {
      commitPresenterStep(request.stepIndex);
      return Promise.resolve("committed");
    }

    return gate?.request(normalizedRequest) ?? Promise.resolve("ignored");
  }

  return {
    audienceOutputMode,
    commitPresenterStep,
    commitSlidePosition,
    currentSlideIndex,
    currentSlideIndexRef,
    displayRole,
    isSlidePreparationPending,
    presenterStepIndex,
    presenterStepIndexRef,
    resetSlideDisplayToBeginning,
    requestPreparedSlideChange,
    setAudienceOutputMode,
    setCurrentSlideIndex,
    setDisplayRole,
    setPresenterStepIndex,
    setSlideReceiverMessage,
    slideReceiverMessage,
    slideWindowRef,
    cancelPendingNavigation: () => navigationGateRef.current?.cancel(),
  };
}
