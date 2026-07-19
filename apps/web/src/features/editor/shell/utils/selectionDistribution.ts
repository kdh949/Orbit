import {
  createGroupedElementFramePatch,
  normalizeElementFrameDraft
} from "@orbit/editor-core";
import type { Deck, DeckElement, DeckPatch, Slide } from "@orbit/shared";

export type DistributeAxis = "x" | "y";

export function createDistributeSelectionPatch(
  deck: Deck,
  slide: Slide,
  elements: DeckElement[],
  axis: DistributeAxis
): DeckPatch | null {
  if (elements.length < 3 || elements.some((element) => element.locked)) {
    return null;
  }

  const sortedElements = [...elements].sort(
    (left, right) => getElementCenter(left, axis) - getElementCenter(right, axis)
  );
  const firstCenter = getElementCenter(sortedElements[0], axis);
  const lastCenter = getElementCenter(sortedElements[sortedElements.length - 1], axis);
  const step = (lastCenter - firstCenter) / (sortedElements.length - 1);
  const operations: DeckPatch["operations"] = sortedElements.flatMap((element, index) => {
    const center = firstCenter + step * index;
    const nextPosition =
      axis === "x"
        ? Math.round(center - element.width / 2)
        : Math.round(center - element.height / 2);
    const frame = axis === "x" ? { x: nextPosition } : { y: nextPosition };

    if (element.type === "group") {
      return createGroupedElementFramePatch(
        deck,
        slide.slideId,
        element.elementId,
        frame
      ).operations;
    }

    return [{
      type: "update_element_frame",
      slideId: slide.slideId,
      elementId: element.elementId,
      frame: normalizeElementFrameDraft(deck.canvas, element, frame)
    }];
  });

  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations
  };
}

function getElementCenter(element: DeckElement, axis: DistributeAxis) {
  return axis === "x"
    ? element.x + element.width / 2
    : element.y + element.height / 2;
}
