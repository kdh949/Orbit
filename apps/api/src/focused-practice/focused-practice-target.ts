import {
  normalizeFocusedPracticeSentenceText,
  splitFocusedPracticeSentences,
  type FocusedPracticeTargetScope,
} from "@orbit/shared/coaching";
import { type Deck } from "@orbit/shared/deck";
import { type RehearsalEvaluationSnapshot } from "@orbit/shared/rehearsals";
import { createHash } from "node:crypto";

export type FocusedPracticeTargetResolution = {
  compatibilityState: "current" | "stale";
  resolvedSlideIds: string[];
  staleReason: "DECK_UNAVAILABLE" | "SLIDE_CHANGED" | "SENTENCE_CHANGED" | null;
};

export class FocusedPracticeTargetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FocusedPracticeTargetValidationError";
  }
}

export function focusedPracticeSentenceSnapshotHash(sentence: string): string {
  return createHash("sha256")
    .update(normalizeFocusedPracticeSentenceText(sentence), "utf8")
    .digest("hex");
}

export function resolveFocusedPracticeTarget(input: {
  currentDeck: Deck | null;
  sourceSnapshot: RehearsalEvaluationSnapshot;
  targetScope: FocusedPracticeTargetScope;
}): FocusedPracticeTargetResolution {
  const sourceSlides = [...input.sourceSnapshot.slides].sort((left, right) => left.order - right.order);
  const sourceSlideIds = sourceSlides.map((slide) => slide.slideId);
  const expectedSlideIds = resolveSourceSlideIds(input.targetScope, sourceSlideIds);

  if (!input.currentDeck || input.currentDeck.deckId !== input.sourceSnapshot.deckId) {
    return stale(expectedSlideIds, "DECK_UNAVAILABLE");
  }

  const currentSlides = [...input.currentDeck.slides].sort((left, right) => left.order - right.order);
  const currentSlideIds = currentSlides.map((slide) => slide.slideId);

  if (input.targetScope.type === "sentence") {
    const sentenceTarget = input.targetScope;
    const slide = currentSlides.find((candidate) => candidate.slideId === sentenceTarget.slideId);
    const sentence = slide
      ? splitFocusedPracticeSentences(slide.speakerNotes)[sentenceTarget.sentenceIndex]
      : undefined;
    if (!sentence || focusedPracticeSentenceSnapshotHash(sentence) !== sentenceTarget.textSnapshotHash.toLowerCase()) {
      return stale(expectedSlideIds, "SENTENCE_CHANGED");
    }
    return current(expectedSlideIds);
  }

  if (input.targetScope.type === "slide-range") {
    const currentStart = currentSlideIds.indexOf(input.targetScope.startSlideId);
    const currentEnd = currentSlideIds.indexOf(input.targetScope.endSlideId);
    const currentRange = currentStart >= 0 && currentEnd >= currentStart
      ? currentSlideIds.slice(currentStart, currentEnd + 1)
      : [];
    return arraysEqual(currentRange, expectedSlideIds)
      ? current(expectedSlideIds)
      : stale(expectedSlideIds, "SLIDE_CHANGED");
  }

  if (input.targetScope.type === "opening" || input.targetScope.type === "closing") {
    const currentBoundary = input.targetScope.type === "opening"
      ? currentSlideIds[0]
      : currentSlideIds.at(-1);
    return currentBoundary === expectedSlideIds[0]
      ? current(expectedSlideIds)
      : stale(expectedSlideIds, "SLIDE_CHANGED");
  }

  return currentSlideIds.includes(input.targetScope.slideId)
    ? current(expectedSlideIds)
    : stale(expectedSlideIds, "SLIDE_CHANGED");
}

export function assertFocusedPracticeTimeline(
  targetScope: FocusedPracticeTargetScope,
  resolution: FocusedPracticeTargetResolution,
  timeline: Array<{ slideId: string }>,
) {
  const actualSlideIds = timeline.map((entry) => entry.slideId);
  const expectedSlideIds = targetScope.type === "opening" || targetScope.type === "closing"
    ? []
    : resolution.resolvedSlideIds;
  if (!arraysEqual(actualSlideIds, expectedSlideIds)) {
    throw new FocusedPracticeTargetValidationError(
      "Slide timeline must exactly match the focused-practice target order.",
    );
  }
}

function resolveSourceSlideIds(targetScope: FocusedPracticeTargetScope, sourceSlideIds: string[]) {
  if (targetScope.type === "opening" || targetScope.type === "closing") {
    const boundary = targetScope.type === "opening" ? sourceSlideIds[0] : sourceSlideIds.at(-1);
    if (!boundary) throw new FocusedPracticeTargetValidationError("Focused-practice source has no slides.");
    return [boundary];
  }

  if (targetScope.type === "slide" || targetScope.type === "sentence") {
    if (!sourceSlideIds.includes(targetScope.slideId)) {
      throw new FocusedPracticeTargetValidationError("Focused-practice target slide is not in the source snapshot.");
    }
    return [targetScope.slideId];
  }

  const startIndex = sourceSlideIds.indexOf(targetScope.startSlideId);
  const endIndex = sourceSlideIds.indexOf(targetScope.endSlideId);
  const range = startIndex >= 0 && endIndex >= startIndex
    ? sourceSlideIds.slice(startIndex, endIndex + 1)
    : [];
  if (range.length < 2 || range.length > 3) {
    throw new FocusedPracticeTargetValidationError(
      "Focused-practice slide range must be two or three consecutive source slides.",
    );
  }
  return range;
}

function current(resolvedSlideIds: string[]): FocusedPracticeTargetResolution {
  return { compatibilityState: "current", resolvedSlideIds, staleReason: null };
}

function stale(
  resolvedSlideIds: string[],
  staleReason: Exclude<FocusedPracticeTargetResolution["staleReason"], null>,
): FocusedPracticeTargetResolution {
  return { compatibilityState: "stale", resolvedSlideIds, staleReason };
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
