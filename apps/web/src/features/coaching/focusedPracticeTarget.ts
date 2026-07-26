import {
  splitFocusedPracticeSentences,
  type FocusedPracticeAttempt,
  type FocusedPracticeTargetScope,
} from "@orbit/shared/coaching";
import { type Deck } from "@orbit/shared/deck";

export type FocusedPracticeRangeTransition = {
  enteredAtMs: number;
  slideId: string;
};

export const FOCUSED_PRACTICE_MIN_DURATION_SECONDS = 30;
export const FOCUSED_PRACTICE_MAX_DURATION_SECONDS = 60;

const SENTENCE_CHARACTERS_PER_SECOND = 4;
const SLIDE_CHARACTERS_PER_SECOND = 3.5;

export type FocusedPracticeDurationGuidance = {
  seconds: number;
  targetLabel: string;
};

export function resolveFocusedPracticeSlideIds(
  deck: Deck,
  targetScope: FocusedPracticeTargetScope,
): string[] {
  const slideIds = [...deck.slides]
    .sort((left, right) => left.order - right.order)
    .map((slide) => slide.slideId);
  if (targetScope.type === "opening") return slideIds.slice(0, 1);
  if (targetScope.type === "closing") return slideIds.slice(-1);
  if (targetScope.type === "slide" || targetScope.type === "sentence") {
    return slideIds.includes(targetScope.slideId) ? [targetScope.slideId] : [];
  }

  const startIndex = slideIds.indexOf(targetScope.startSlideId);
  const endIndex = slideIds.indexOf(targetScope.endSlideId);
  return startIndex >= 0 && endIndex >= startIndex
    ? slideIds.slice(startIndex, endIndex + 1)
    : [];
}

export function resolveFocusedPracticeSentence(
  deck: Deck,
  targetScope: FocusedPracticeTargetScope,
): string | null {
  if (targetScope.type !== "sentence") return null;
  const slide = deck.slides.find((candidate) => candidate.slideId === targetScope.slideId);
  return slide
    ? splitFocusedPracticeSentences(slide.speakerNotes)[targetScope.sentenceIndex] ?? null
    : null;
}

export function resolveFocusedPracticeDurationGuidance(
  deck: Deck,
  targetScope: FocusedPracticeTargetScope,
): FocusedPracticeDurationGuidance {
  const targetLabel = focusedPracticeDurationTargetLabel(targetScope);

  if (targetScope.type === "sentence") {
    const sentence = resolveFocusedPracticeSentence(deck, targetScope) ?? "";
    return {
      seconds: clampRecommendedDuration(
        countSpokenCharacters(sentence) / SENTENCE_CHARACTERS_PER_SECOND,
      ),
      targetLabel,
    };
  }

  const slideIds = resolveFocusedPracticeSlideIds(deck, targetScope);
  const seconds = slideIds.reduce((total, slideId) => {
    const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
    if (!slide) return total;

    const timingPlan = slide.aiNotes?.timingPlan;
    const storedSeconds = timingPlan?.targetSpokenSeconds
      ?? timingPlan?.targetSeconds
      ?? slide.estimatedSeconds
      ?? timingPlan?.targetSecondsPerSlide;

    return total + (storedSeconds
      ?? countSpokenCharacters(slide.speakerNotes) / SLIDE_CHARACTERS_PER_SECOND);
  }, 0);

  return {
    seconds: clampRecommendedDuration(seconds),
    targetLabel,
  };
}

export function buildFocusedPracticeTimeline(
  targetScope: FocusedPracticeTargetScope,
  resolvedSlideIds: string[],
  durationMs: number,
  rangeTransitions: FocusedPracticeRangeTransition[] = [],
): FocusedPracticeAttempt["slideTimeline"] {
  if (targetScope.type === "opening" || targetScope.type === "closing") return [];
  if (targetScope.type !== "slide-range") {
    return resolvedSlideIds[0]
      ? [{ slideId: resolvedSlideIds[0], enteredAtMs: 0, exitedAtMs: durationMs }]
      : [];
  }

  return rangeTransitions.map((transition, index) => ({
    slideId: transition.slideId,
    enteredAtMs: Math.min(durationMs, Math.max(0, transition.enteredAtMs)),
    exitedAtMs: Math.min(
      durationMs,
      Math.max(transition.enteredAtMs, rangeTransitions[index + 1]?.enteredAtMs ?? durationMs),
    ),
  }));
}

function clampRecommendedDuration(seconds: number): number {
  return Math.min(
    FOCUSED_PRACTICE_MAX_DURATION_SECONDS,
    Math.max(FOCUSED_PRACTICE_MIN_DURATION_SECONDS, Math.ceil(seconds)),
  );
}

function countSpokenCharacters(text: string): number {
  return Array.from(text.normalize("NFC"))
    .filter((character) => /[\p{L}\p{N}]/u.test(character))
    .length;
}

function focusedPracticeDurationTargetLabel(
  targetScope: FocusedPracticeTargetScope,
): string {
  if (targetScope.type === "sentence") return "문장 기준";
  if (targetScope.type === "slide-range") return "연속 장표 기준";
  if (targetScope.type === "opening") return "도입부 기준";
  if (targetScope.type === "closing") return "마무리 기준";
  return "장표 기준";
}
