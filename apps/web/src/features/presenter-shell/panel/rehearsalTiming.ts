import type { Deck, Slide } from "@orbit/shared";

import type { AdviceEventType, PaceAdviceConfig } from "../../../runtime/speech/tracking/speechTrackingConfig";
import type { LiveSttResult } from "../../../runtime/speech/stt/liveSttPort";

export type RehearsalTimingSlide = Pick<Slide, "estimatedSeconds">;

export type RehearsalTimingDeck = Pick<Deck, "targetDurationMinutes"> & {
  slides: readonly RehearsalTimingSlide[];
};

export type RehearsalTimingSnapshot = {
  deckTargetSeconds: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  currentSlideElapsedSeconds: number;
  currentSlideTargetSeconds: number;
  currentSlideOvertime: boolean;
};

export type FinalTranscriptWpmOptions = {
  segments: readonly LiveSttResult[];
  nowMs: number;
  startedAtMs: number;
  windowMs?: number;
};

export type PaceAdviceThresholds = Pick<PaceAdviceConfig, "slowWpm" | "fastWpm">;

export type TimingPaceState = "too-slow" | "normal" | "too-fast";

export type TimingAdviceState = {
  pace: TimingPaceState;
  slideOvertime: boolean;
};

export function getDeckTargetSeconds(deck: Pick<Deck, "targetDurationMinutes">) {
  return Math.max(1, Math.round(deck.targetDurationMinutes * 60));
}

export function getSlideTargetSeconds(
  deck: RehearsalTimingDeck,
  slide: RehearsalTimingSlide
) {
  if (slide.estimatedSeconds) {
    return slide.estimatedSeconds;
  }

  return Math.max(1, Math.round(getDeckTargetSeconds(deck) / deck.slides.length));
}

export function createRehearsalTimingSnapshot(options: {
  deck: RehearsalTimingDeck;
  currentSlide: RehearsalTimingSlide;
  startedAtMs: number;
  slideEnteredAtMs: number;
  nowMs: number;
}): RehearsalTimingSnapshot {
  const deckTargetSeconds = getDeckTargetSeconds(options.deck);
  const elapsedSeconds = millisecondsToSeconds(options.nowMs - options.startedAtMs);
  const currentSlideElapsedSeconds = millisecondsToSeconds(
    options.nowMs - options.slideEnteredAtMs
  );
  const currentSlideTargetSeconds = getSlideTargetSeconds(
    options.deck,
    options.currentSlide
  );

  return {
    deckTargetSeconds,
    elapsedSeconds,
    remainingSeconds: deckTargetSeconds - elapsedSeconds,
    currentSlideElapsedSeconds,
    currentSlideTargetSeconds,
    currentSlideOvertime: currentSlideElapsedSeconds > currentSlideTargetSeconds
  };
}

export function calculateFinalTranscriptWpm(options: FinalTranscriptWpmOptions) {
  const windowMs = options.windowMs ?? 30000;
  const elapsedNowMs = Math.max(0, options.nowMs - options.startedAtMs);
  const denominatorMs = Math.min(windowMs, elapsedNowMs);

  if (denominatorMs <= 0) {
    return 0;
  }

  const windowStartElapsedMs = Math.max(0, elapsedNowMs - windowMs);
  const wordCount = options.segments
    .filter((segment) => segment.isFinal)
    .filter((segment) => {
      const [, endMs] = segment.timestampMs;
      return endMs >= windowStartElapsedMs && endMs <= elapsedNowMs;
    })
    .reduce((total, segment) => total + countWhitespaceWords(segment.text), 0);

  return Math.round(wordCount / (denominatorMs / 60000));
}

export function getTimingAdviceState(options: {
  wordsPerMinute: number;
  currentSlideOvertime: boolean;
  paceAdvice: PaceAdviceThresholds;
}): TimingAdviceState {
  let pace: TimingPaceState = "normal";

  if (options.wordsPerMinute > options.paceAdvice.fastWpm) {
    pace = "too-fast";
  } else if (
    options.wordsPerMinute > 0 &&
    options.wordsPerMinute < options.paceAdvice.slowWpm
  ) {
    pace = "too-slow";
  }

  return {
    pace,
    slideOvertime: options.currentSlideOvertime
  };
}

export function getTimingAdviceTransitions(
  previous: TimingAdviceState,
  current: TimingAdviceState
): AdviceEventType[] {
  const events: AdviceEventType[] = [];

  if (!previous.slideOvertime && current.slideOvertime) {
    events.push("slide-overtime");
  }

  if (previous.pace !== current.pace) {
    if (current.pace === "too-fast") {
      events.push("pace-too-fast");
    } else if (current.pace === "too-slow") {
      events.push("pace-too-slow");
    }
  }

  return events;
}

function millisecondsToSeconds(milliseconds: number) {
  return Math.max(0, Math.round(milliseconds / 1000));
}

function countWhitespaceWords(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return 0;
  }

  return trimmed.split(/\s+/).length;
}
