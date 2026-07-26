import {
  createGroupedElementFramePatch,
  normalizeElementFrameDraft,
} from "@orbit/editor-core/patches";
import type {
  Deck,
  DeckElement,
  DeckPatch,
  GroupElementProps,
  Slide,
} from "@orbit/shared";

export function createSelectionNudgePatch(args: {
  deck: Deck;
  deltaX: number;
  deltaY: number;
  selectedElementIds: readonly string[];
  slideId: string;
}): DeckPatch | null {
  const { deck, slideId } = args;
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  if (!slide || !Number.isFinite(args.deltaX) || !Number.isFinite(args.deltaY)) {
    return null;
  }

  const selectedElements = getCanonicalSelectedElements(
    slide,
    args.selectedElementIds,
  ).filter((element) => !hasLockedElementInTree(slide, element));
  if (selectedElements.length === 0) {
    return null;
  }

  const bounds = getSelectionBounds(selectedElements);
  const deltaX = clampSelectionDelta(
    args.deltaX,
    -bounds.minX,
    deck.canvas.width - bounds.maxX,
  );
  const deltaY = clampSelectionDelta(
    args.deltaY,
    -bounds.minY,
    deck.canvas.height - bounds.maxY,
  );

  if (deltaX === 0 && deltaY === 0) {
    return null;
  }

  const operations: DeckPatch["operations"] = [];
  const operatedElementIds = new Set<string>();

  for (const element of selectedElements) {
    const elementOperations =
      element.type === "group"
        ? createGroupedElementFramePatch(deck, slideId, element.elementId, {
            x: element.x + deltaX,
            y: element.y + deltaY,
          }).operations
        : [
            {
              type: "update_element_frame" as const,
              slideId,
              elementId: element.elementId,
              frame: normalizeElementFrameDraft(deck.canvas, element, {
                x: element.x + deltaX,
                y: element.y + deltaY,
              }),
            },
          ];

    for (const operation of elementOperations) {
      if (
        operation.type !== "update_element_frame" ||
        operatedElementIds.has(operation.elementId)
      ) {
        continue;
      }

      operatedElementIds.add(operation.elementId);
      operations.push(operation);
    }
  }

  if (operations.length === 0) {
    return null;
  }

  return {
    baseVersion: deck.version,
    deckId: deck.deckId,
    operations,
    source: "user",
  };
}

function getCanonicalSelectedElements(
  slide: Slide,
  selectedElementIds: readonly string[],
) {
  const elementById = new Map(
    slide.elements.map((element) => [element.elementId, element]),
  );
  const selectedIds = new Set(selectedElementIds);
  const descendantsOfSelectedGroups = new Set<string>();

  for (const elementId of selectedIds) {
    const element = elementById.get(elementId);
    if (element?.type === "group") {
      collectGroupDescendantIds(slide, element, descendantsOfSelectedGroups);
    }
  }

  const canonicalIds = new Set<string>();
  const elements: DeckElement[] = [];
  for (const elementId of selectedElementIds) {
    if (canonicalIds.has(elementId) || descendantsOfSelectedGroups.has(elementId)) {
      continue;
    }

    const element = elementById.get(elementId);
    if (!element) {
      continue;
    }

    canonicalIds.add(elementId);
    elements.push(element);
  }

  return elements;
}

function collectGroupDescendantIds(
  slide: Slide,
  group: DeckElement,
  descendants: Set<string>,
  visitedGroupIds: Set<string> = new Set(),
) {
  if (group.type !== "group" || visitedGroupIds.has(group.elementId)) {
    return;
  }

  visitedGroupIds.add(group.elementId);
  const childIds = (group.props as GroupElementProps).childElementIds;
  for (const childId of childIds) {
    descendants.add(childId);
    const child = slide.elements.find((element) => element.elementId === childId);
    if (child?.type === "group") {
      collectGroupDescendantIds(slide, child, descendants, visitedGroupIds);
    }
  }
}

function hasLockedElementInTree(
  slide: Slide,
  element: DeckElement,
  visitedGroupIds: Set<string> = new Set(),
): boolean {
  if (element.locked) {
    return true;
  }

  if (element.type !== "group" || visitedGroupIds.has(element.elementId)) {
    return false;
  }

  visitedGroupIds.add(element.elementId);
  const childIds = (element.props as GroupElementProps).childElementIds;
  return childIds.some((childId) => {
    const child = slide.elements.find((candidate) => candidate.elementId === childId);
    return child ? hasLockedElementInTree(slide, child, visitedGroupIds) : false;
  });
}

function getSelectionBounds(elements: readonly DeckElement[]) {
  return {
    maxX: Math.max(...elements.map((element) => element.x + element.width)),
    maxY: Math.max(...elements.map((element) => element.y + element.height)),
    minX: Math.min(...elements.map((element) => element.x)),
    minY: Math.min(...elements.map((element) => element.y)),
  };
}

function clampSelectionDelta(delta: number, minimum: number, maximum: number) {
  if (minimum > maximum) {
    return 0;
  }

  return Math.max(minimum, Math.min(maximum, delta));
}
