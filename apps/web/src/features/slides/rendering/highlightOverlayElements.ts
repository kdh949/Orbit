import type { Deck, GroupElementProps, Slide } from "@orbit/shared";
import type { ElementPresentationState } from "../../../runtime/presentation/slideshow/elementPresentationState";
import {
  normalizeRenderableElement,
  usesSourceSlideSnapshot
} from "../../../runtime/presentation/slideshow/elementNormalization";

export function getHighlightOverlayElements(args: {
  activeHighlightElementIds: Set<string>;
  deck: Deck;
  elementStates?: Record<string, ElementPresentationState>;
  slide: Slide;
}) {
  if (usesSourceSlideSnapshot(args.slide)) {
    return [];
  }

  const parentGroupByChildId = getParentGroupByChildId(args.slide);

  return args.slide.elements
    .filter((element) => {
      if (!args.activeHighlightElementIds.has(element.elementId)) {
        return false;
      }

      return isVisibleWithinParentGroups({
        elementId: element.elementId,
        elementStates: args.elementStates,
        parentGroupByChildId
      });
    })
    .map((element) => normalizeRenderableElement(args.deck.canvas, element))
    .sort((left, right) => left.zIndex - right.zIndex);
}

function getParentGroupByChildId(slide: Slide) {
  const parentGroupByChildId = new Map<string, string>();

  for (const element of slide.elements) {
    if (element.type !== "group") {
      continue;
    }

    const groupProps = element.props as GroupElementProps;

    for (const childElementId of groupProps.childElementIds) {
      parentGroupByChildId.set(childElementId, element.elementId);
    }
  }

  return parentGroupByChildId;
}

function isVisibleWithinParentGroups(args: {
  elementId: string;
  elementStates: Record<string, ElementPresentationState> | undefined;
  parentGroupByChildId: Map<string, string>;
}) {
  let parentGroupId = args.parentGroupByChildId.get(args.elementId);

  while (parentGroupId) {
    const parentState = args.elementStates?.[parentGroupId];

    if (parentState?.visible === false || parentState?.opacity === 0) {
      return false;
    }

    parentGroupId = args.parentGroupByChildId.get(parentGroupId);
  }

  return true;
}
