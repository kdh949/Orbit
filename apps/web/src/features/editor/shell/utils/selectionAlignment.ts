import {
  createGroupedElementFramePatch,
  normalizeElementFrameDraft,
} from "@orbit/editor-core";
import type { Deck, DeckElement, DeckPatch, Slide } from "@orbit/shared";

export type SelectionAlignment =
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "centerY"
  | "bottom";

export function createAlignSelectionPatch(
  deck: Deck,
  slide: Slide,
  elements: DeckElement[],
  alignment: SelectionAlignment,
): DeckPatch | null {
  if (elements.length < 2 || elements.some((element) => element.locked)) {
    return null;
  }

  const bounds = {
    left: Math.min(...elements.map((element) => element.x)),
    right: Math.max(...elements.map((element) => element.x + element.width)),
    top: Math.min(...elements.map((element) => element.y)),
    bottom: Math.max(...elements.map((element) => element.y + element.height)),
  };
  const horizontal =
    alignment === "left" || alignment === "centerX" || alignment === "right";
  const target =
    alignment === "left"
      ? bounds.left
      : alignment === "centerX"
        ? (bounds.left + bounds.right) / 2
        : alignment === "right"
          ? bounds.right
          : alignment === "top"
            ? bounds.top
            : alignment === "centerY"
              ? (bounds.top + bounds.bottom) / 2
              : bounds.bottom;

  const operations = elements.flatMap((element) => {
    const current = horizontal
      ? alignment === "left"
        ? element.x
        : alignment === "centerX"
          ? element.x + element.width / 2
          : element.x + element.width
      : alignment === "top"
        ? element.y
        : alignment === "centerY"
          ? element.y + element.height / 2
          : element.y + element.height;
    const delta = target - current;
    if (Math.abs(delta) < 0.001) return [];
    const frame = horizontal
      ? { x: Math.round(element.x + delta) }
      : { y: Math.round(element.y + delta) };

    if (element.type === "group") {
      return createGroupedElementFramePatch(
        deck,
        slide.slideId,
        element.elementId,
        frame,
      ).operations;
    }

    return [
      {
        type: "update_element_frame" as const,
        slideId: slide.slideId,
        elementId: element.elementId,
        frame: normalizeElementFrameDraft(deck.canvas, element, frame),
      },
    ];
  });

  if (operations.length === 0) return null;
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations,
  };
}
