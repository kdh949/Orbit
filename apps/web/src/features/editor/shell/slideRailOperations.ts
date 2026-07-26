import type { Deck, DeckPatch } from "@orbit/shared/deck";

export function createSlideRailReorderPatch(
  deck: Deck,
  orderedSlideIds: readonly string[]
): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "reorder_slides",
        slideOrders: orderedSlideIds.map((slideId, index) => ({
          slideId,
          order: index + 1
        }))
      }
    ]
  };
}

export function createDeleteSlidePatch(deck: Deck, slideId: string): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [{ type: "delete_slide", slideId }]
  };
}

export function getAddedSlideId(patch: DeckPatch) {
  return (
    patch.operations.find((operation) => operation.type === "add_slide")?.slide
      .slideId ?? null
  );
}

export function moveSlideId(
  orderedSlideIds: readonly string[],
  slideId: string,
  direction: "down" | "up"
) {
  const sourceIndex = orderedSlideIds.indexOf(slideId);
  const targetIndex = sourceIndex + (direction === "up" ? -1 : 1);
  if (
    sourceIndex < 0 ||
    targetIndex < 0 ||
    targetIndex >= orderedSlideIds.length
  ) {
    return null;
  }

  const reordered = [...orderedSlideIds];
  const [movedSlideId] = reordered.splice(sourceIndex, 1);
  if (!movedSlideId) return null;
  reordered.splice(targetIndex, 0, movedSlideId);
  return reordered;
}
