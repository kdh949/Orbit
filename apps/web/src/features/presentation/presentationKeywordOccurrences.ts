import { deriveKeywordOccurrences, type Slide } from "@orbit/shared";

import { getKeywordOccurrenceTriggerIdsForSlide } from "../../runtime/presentation/playback/triggeredActionPlayback";

export function getPresentationHighlightedKeywordOccurrences(slide: Slide | null) {
  if (!slide) {
    return undefined;
  }

  const targetOccurrenceIds = new Set([
    ...getKeywordOccurrenceTriggerIdsForSlide(slide),
    ...slide.keywords.flatMap((keyword) => keyword.requiredOccurrenceIds ?? []),
  ]);

  if (targetOccurrenceIds.size === 0) {
    return [];
  }

  return deriveKeywordOccurrences(slide).filter((occurrence) =>
    targetOccurrenceIds.has(occurrence.occurrenceId),
  );
}
