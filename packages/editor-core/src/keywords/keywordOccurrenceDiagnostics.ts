import type { DeckSlideAction, Slide } from "@orbit/shared/deck";

import { deriveKeywordOccurrences } from "./keywordOccurrences";

export type DanglingKeywordOccurrenceAction = {
  slideId: string;
  actionId: string;
  keywordId: string;
  occurrenceId: string;
  effectKind: DeckSlideAction["effect"]["kind"];
};

export function findDanglingKeywordOccurrenceActions(
  slide: Pick<Slide, "slideId" | "speakerNotes" | "keywords" | "actions">,
  nextSpeakerNotes: string
): DanglingKeywordOccurrenceAction[] {
  const nextOccurrenceIds = new Set(
    deriveKeywordOccurrences({
      slideId: slide.slideId,
      speakerNotes: nextSpeakerNotes,
      keywords: slide.keywords
    }).map((occurrence) => occurrence.occurrenceId)
  );

  return slide.actions.flatMap((action) => {
    if (action.trigger.kind !== "keyword-occurrence") {
      return [];
    }

    if (nextOccurrenceIds.has(action.trigger.occurrenceId)) {
      return [];
    }

    return [
      {
        slideId: slide.slideId,
        actionId: action.actionId,
        keywordId: action.trigger.keywordId,
        occurrenceId: action.trigger.occurrenceId,
        effectKind: action.effect.kind
      }
    ];
  });
}
