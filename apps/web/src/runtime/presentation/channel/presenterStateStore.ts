import type { Deck } from "@orbit/shared/deck";
import type { SemanticCapabilityStatusItem } from "../../speech/semantic/semanticCapabilityStatus";
import type { SemanticUtteranceDebugState } from "../../speech/semantic/semanticSpeechDebug";
import type { SpeechTrackerSnapshot } from "../../speech/tracking/speechTrackingEvents";
import { clampSlideshowStepIndex } from "../slideshow/slideshowStepModel";

export type PresenterHighlightState = {
  active: boolean;
  elementId: string;
};

export type AudienceOutputMode = "slide" | "screen-share" | "black";

export type PresenterTimingState = {
  canStartLiveStt: boolean;
  currentSlideElapsedSeconds: number;
  currentSlideTargetSeconds: number;
  displayedSeconds: number;
  elapsedSeconds: number;
  isLiveSttActive: boolean;
  isPaused?: boolean;
  isRunning: boolean;
  liveStatus: string;
  mode: "stopwatch" | "timer";
  timerDurationSeconds: number;
};

export type PresenterSpeechState = {
  coveredSentenceIds: string[];
  coveredSentenceMatchKinds: Record<string, "covered" | "paraphrased">;
  matchableSentenceCount: number;
  semanticDebug: SemanticUtteranceDebugState;
  semanticMatchingEnabled: boolean;
  snapshot: SpeechTrackerSnapshot | null;
  semanticCapabilityItems?: SemanticCapabilityStatusItem[];
};

export type PresenterSlideshowState = {
  audienceOutputMode: AudienceOutputMode;
  highlights: PresenterHighlightState[];
  slideId: string;
  slideIndex: number;
  speech?: PresenterSpeechState;
  stepIndex: number;
  timing?: PresenterTimingState;
};

export type PresenterSlideshowCommand =
  | { type: "next-step"; maxStepIndex: number }
  | { type: "next-slide"; slideCount: number; slides: Deck["slides"] }
  | { type: "previous-slide"; slides: Deck["slides"] }
  | { type: "set-slide"; slideIndex: number; slides: Deck["slides"] }
  | { type: "set-highlight"; active: boolean; elementId: string };

export function createPresenterSlideshowState(
  deck: Deck,
): PresenterSlideshowState {
  const firstSlide = deck.slides[0];

  return {
    audienceOutputMode: "slide",
    highlights: [],
    slideId: firstSlide?.slideId ?? "",
    slideIndex: 0,
    stepIndex: 0,
  };
}

export function applyPresenterSlideshowCommand(
  state: PresenterSlideshowState,
  command: PresenterSlideshowCommand,
): PresenterSlideshowState {
  switch (command.type) {
    case "next-step": {
      const maxStepIndex = Math.max(0, command.maxStepIndex);

      if (state.stepIndex < maxStepIndex) {
        return {
          ...state,
          stepIndex: clampSlideshowStepIndex(state.stepIndex + 1, maxStepIndex),
        };
      }

      return state;
    }
    case "next-slide":
      return moveToSlide(state, command.slides, state.slideIndex + 1);
    case "previous-slide":
      return moveToSlide(state, command.slides, state.slideIndex - 1);
    case "set-slide":
      return moveToSlide(state, command.slides, command.slideIndex);
    case "set-highlight":
      return {
        ...state,
        highlights: upsertHighlight(state.highlights, {
          active: command.active,
          elementId: command.elementId,
        }),
      };
  }
}

export function nextStepOrSlide(args: {
  maxStepIndex: number;
  slides: Deck["slides"];
  state: PresenterSlideshowState;
}) {
  const stepped = applyPresenterSlideshowCommand(args.state, {
    type: "next-step",
    maxStepIndex: args.maxStepIndex,
  });

  if (stepped !== args.state || args.state.stepIndex < args.maxStepIndex) {
    return stepped;
  }

  if (args.state.slideIndex >= args.slides.length - 1) {
    return args.state;
  }

  return applyPresenterSlideshowCommand(args.state, {
    type: "next-slide",
    slideCount: args.slides.length,
    slides: args.slides,
  });
}

function moveToSlide(
  state: PresenterSlideshowState,
  slides: Deck["slides"],
  nextSlideIndex: number,
) {
  if (slides.length === 0) {
    return {
      ...state,
      slideId: "",
      slideIndex: 0,
      stepIndex: 0,
    };
  }

  const slideIndex = Math.min(Math.max(0, nextSlideIndex), slides.length - 1);

  return {
    ...state,
    slideId: slides[slideIndex]?.slideId ?? state.slideId,
    slideIndex,
    // 슬라이드 이동은 항상 복원 가능한 진입 상태에서 시작한다.
    stepIndex: 0,
  };
}

function upsertHighlight(
  highlights: PresenterHighlightState[],
  nextHighlight: PresenterHighlightState,
) {
  return [
    ...highlights.filter(
      (highlight) => highlight.elementId !== nextHighlight.elementId,
    ),
    nextHighlight,
  ];
}
