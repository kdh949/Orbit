import type { DeckSlideAction, Slide } from "@orbit/shared/deck";

import { deriveKeywordOccurrences } from "../keywords/keywordOccurrences";

export type LegacyKeywordTriggerRepairConfidence =
  | "high"
  | "medium"
  | "low"
  | "none";

export type LegacyKeywordTriggerRepairSuggestion = {
  actionId: string;
  keywordId: string;
  suggestedOccurrenceId: string | null;
  confidence: LegacyKeywordTriggerRepairConfidence;
  reason: string;
};

export function suggestLegacyKeywordTriggerRepairs(
  slide: Slide
): LegacyKeywordTriggerRepairSuggestion[] {
  const legacyActionsByKeywordId = groupLegacyKeywordActionsByKeywordId(slide.actions);
  const occurrencesByKeywordId = groupOccurrencesByKeywordId(slide);

  return [...legacyActionsByKeywordId.entries()].flatMap(
    ([keywordId, legacyActions]) => {
      const occurrences = occurrencesByKeywordId.get(keywordId) ?? [];

      if (occurrences.length === 0) {
        return legacyActions.map((action) =>
          createSuggestion(action, null, "none", "matching occurrence not found")
        );
      }

      if (occurrences.length === 1) {
        return legacyActions.map((action) =>
          createSuggestion(
            action,
            occurrences[0]!.occurrenceId,
            "high",
            "only one matching occurrence exists"
          )
        );
      }

      if (legacyActions.length === occurrences.length) {
        return legacyActions.map((action, index) =>
          createSuggestion(
            action,
            occurrences[index]!.occurrenceId,
            "medium",
            "legacy action order matches occurrence order"
          )
        );
      }

      if (legacyActions.length === 1) {
        return [
          createSuggestion(
            legacyActions[0]!,
            occurrences.at(-1)!.occurrenceId,
            "low",
            "multiple occurrences exist; last occurrence is only a manual repair hint"
          )
        ];
      }

      return legacyActions.map((action) =>
        createSuggestion(
          action,
          null,
          "none",
          "legacy action count does not match occurrence count"
        )
      );
    }
  );
}

function groupLegacyKeywordActionsByKeywordId(actions: DeckSlideAction[]) {
  const actionsByKeywordId = new Map<string, DeckSlideAction[]>();

  for (const action of actions) {
    if (action.trigger.kind !== "keyword") {
      continue;
    }

    const actions = actionsByKeywordId.get(action.trigger.keywordId) ?? [];
    actions.push(action);
    actionsByKeywordId.set(action.trigger.keywordId, actions);
  }

  return actionsByKeywordId;
}

function groupOccurrencesByKeywordId(slide: Slide) {
  const occurrencesByKeywordId = new Map<
    string,
    ReturnType<typeof deriveKeywordOccurrences>
  >();

  for (const occurrence of deriveKeywordOccurrences(slide)) {
    const occurrences = occurrencesByKeywordId.get(occurrence.keywordId) ?? [];
    occurrences.push(occurrence);
    occurrencesByKeywordId.set(occurrence.keywordId, occurrences);
  }

  return occurrencesByKeywordId;
}

function createSuggestion(
  action: DeckSlideAction,
  suggestedOccurrenceId: string | null,
  confidence: LegacyKeywordTriggerRepairConfidence,
  reason: string
): LegacyKeywordTriggerRepairSuggestion {
  if (action.trigger.kind !== "keyword") {
    throw new Error("legacy keyword trigger repair requires a keyword trigger");
  }

  return {
    actionId: action.actionId,
    keywordId: action.trigger.keywordId,
    suggestedOccurrenceId,
    confidence,
    reason
  };
}
