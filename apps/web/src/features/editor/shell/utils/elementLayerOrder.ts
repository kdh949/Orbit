import type { DeckElement } from "@orbit/shared/deck";

export type ElementLayerOrderAction =
  | "bring-to-front"
  | "bring-forward"
  | "send-backward"
  | "send-to-back";

export type ElementLayerOrderUpdate = {
  elementId: string;
  zIndex: number;
};

export function getElementLayerOrderUpdates(
  elements: DeckElement[],
  elementId: string,
  action: ElementLayerOrderAction,
): ElementLayerOrderUpdate[] {
  const ordered = elements
    .map((element, sourceIndex) => ({ element, sourceIndex }))
    .sort(
      (left, right) =>
        left.element.zIndex - right.element.zIndex ||
        left.sourceIndex - right.sourceIndex,
    );
  const currentIndex = ordered.findIndex(
    ({ element }) => element.elementId === elementId,
  );
  if (currentIndex < 0) return [];

  const targetIndex = getTargetIndex(action, currentIndex, ordered.length);
  if (targetIndex === currentIndex) return [];

  const [selected] = ordered.splice(currentIndex, 1);
  if (!selected) return [];
  ordered.splice(targetIndex, 0, selected);

  return ordered
    .map(({ element }, zIndex) => ({
      elementId: element.elementId,
      zIndex,
    }))
    .filter(
      (update) =>
        elements.find((element) => element.elementId === update.elementId)
          ?.zIndex !== update.zIndex,
    );
}

function getTargetIndex(
  action: ElementLayerOrderAction,
  currentIndex: number,
  elementCount: number,
) {
  switch (action) {
    case "bring-to-front":
      return elementCount - 1;
    case "bring-forward":
      return Math.min(elementCount - 1, currentIndex + 1);
    case "send-backward":
      return Math.max(0, currentIndex - 1);
    case "send-to-back":
      return 0;
  }
}
