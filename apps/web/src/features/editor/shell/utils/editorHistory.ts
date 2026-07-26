import type { Deck } from "@orbit/shared/deck";
import { resolveSelectedSlideId } from "../slideRailModel";

export type HistoryEntry = {
  deck: Deck;
  slideId: string | null;
};

export function resolveHistoryNavigation(args: {
  currentDeck: Deck;
  currentSlideId: string | null;
  stack: HistoryEntry[];
}) {
  const targetEntry = args.stack.at(-1);

  if (!targetEntry) {
    return null;
  }

  return {
    currentEntry: {
      deck: args.currentDeck,
      slideId: resolveSelectedSlideId(
        args.currentDeck.slides,
        args.currentSlideId
      )
    },
    nextStack: args.stack.slice(0, -1),
    targetEntry,
    targetSlideId: resolveSelectedSlideId(
      targetEntry.deck.slides,
      targetEntry.slideId
    )
  };
}

export function appendAppliedDesignProposalHistory(args: {
  currentDeck: Deck;
  currentSlideId: string | null;
  undoStack: HistoryEntry[];
}) {
  return [
    ...args.undoStack.slice(-49),
    {
      deck: args.currentDeck,
      slideId: resolveSelectedSlideId(
        args.currentDeck.slides,
        args.currentSlideId
      )
    }
  ];
}
