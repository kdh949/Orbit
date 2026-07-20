import type { Deck, DeckPatch } from "@orbit/shared";

export type SlideTargetDuration = {
  estimatedSeconds: number;
  slideId: string;
  title: string;
};

export function distributeTargetDuration(
  targetDurationMinutes: number,
  slides: Pick<Deck["slides"][number], "slideId" | "title">[],
): SlideTargetDuration[] {
  const totalSeconds = Math.round(targetDurationMinutes * 60);
  const baseSeconds = Math.floor(totalSeconds / slides.length);
  const remainder = totalSeconds % slides.length;

  return slides.map((slide, index) => ({
    estimatedSeconds: baseSeconds + (index < remainder ? 1 : 0),
    slideId: slide.slideId,
    title: slide.title,
  }));
}

export function createTargetDurationDraft(deck: Deck): SlideTargetDuration[] {
  const fallback = distributeTargetDuration(
    deck.targetDurationMinutes,
    deck.slides,
  );

  return deck.slides.map((slide, index) => ({
    estimatedSeconds:
      slide.estimatedSeconds ?? fallback[index]?.estimatedSeconds ?? 1,
    slideId: slide.slideId,
    title: slide.title,
  }));
}

export function createTargetDurationPatch(
  deck: Deck,
  targetDurationMinutes: number,
  durations: SlideTargetDuration[],
): DeckPatch | null {
  if (
    !Number.isInteger(targetDurationMinutes) ||
    targetDurationMinutes < 1 ||
    targetDurationMinutes > 120
  ) {
    throw new Error(
      "Target duration must be an integer between 1 and 120 minutes.",
    );
  }

  const durationBySlideId = new Map(
    durations.map((duration) => [duration.slideId, duration]),
  );
  const estimatedSeconds = deck.slides.map((slide) => {
    const seconds = durationBySlideId.get(slide.slideId)?.estimatedSeconds;
    if (!Number.isInteger(seconds) || (seconds ?? 0) < 1) {
      throw new Error(`Invalid target duration for slide ${slide.slideId}.`);
    }
    return seconds!;
  });

  if (
    estimatedSeconds.reduce((sum, seconds) => sum + seconds, 0) !==
    targetDurationMinutes * 60
  ) {
    throw new Error(
      "Slide target durations must equal the deck target duration.",
    );
  }

  const operations: DeckPatch["operations"] = [];
  if (deck.targetDurationMinutes !== targetDurationMinutes) {
    operations.push({ type: "update_deck", targetDurationMinutes });
  }
  deck.slides.forEach((slide, index) => {
    const duration = durationBySlideId.get(slide.slideId)!;
    const seconds = estimatedSeconds[index]!;
    const titleChanged = slide.title !== duration.title;
    const durationChanged = slide.estimatedSeconds !== seconds;
    if (titleChanged || durationChanged) {
      operations.push({
        type: "update_slide",
        slideId: slide.slideId,
        ...(titleChanged ? { title: duration.title } : {}),
        ...(durationChanged ? { estimatedSeconds: seconds } : {}),
      });
    }
  });

  return operations.length > 0
    ? {
        baseVersion: deck.version,
        deckId: deck.deckId,
        operations,
        source: "user",
      }
    : null;
}

export function formatTargetDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
