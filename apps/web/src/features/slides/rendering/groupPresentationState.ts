import type { DeckElement, GroupElementProps, Slide } from "@orbit/shared";

import type { ElementPresentationState } from "./ReadOnlySlideCanvas";

export function resolveGroupedElementPresentationStates(args: {
  elementStates: Record<string, ElementPresentationState>;
  slide: Slide;
}): Record<string, ElementPresentationState> {
  const { elementStates, slide } = args;
  const resolvedStates = Object.fromEntries(
    Object.entries(elementStates).map(([elementId, state]) => [
      elementId,
      { ...state },
    ]),
  );
  const elementsById = new Map(
    slide.elements.map((element) => [element.elementId, element]),
  );
  const parentGroupIdsByChildId = buildParentGroupIdsByChildId(slide.elements);
  const ancestorGroupIdsByElementId = new Map<string, Set<string>>();

  function getAncestorGroupIds(
    elementId: string,
    visiting: Set<string>,
  ): Set<string> {
    const cached = ancestorGroupIdsByElementId.get(elementId);
    if (cached) {
      return cached;
    }
    if (visiting.has(elementId)) {
      return new Set();
    }

    visiting.add(elementId);
    const ancestorGroupIds = new Set<string>();
    for (const groupId of parentGroupIdsByChildId.get(elementId) ?? []) {
      ancestorGroupIds.add(groupId);
      for (const ancestorGroupId of getAncestorGroupIds(groupId, visiting)) {
        ancestorGroupIds.add(ancestorGroupId);
      }
    }
    visiting.delete(elementId);
    ancestorGroupIds.delete(elementId);
    ancestorGroupIdsByElementId.set(elementId, ancestorGroupIds);
    return ancestorGroupIds;
  }

  for (const element of slide.elements) {
    let inheritedOpacity = 1;
    let inheritedVisible = true;
    let hasPresentedAncestor = false;

    for (const groupId of getAncestorGroupIds(element.elementId, new Set())) {
      const groupState = elementStates[groupId];
      const groupElement = elementsById.get(groupId);
      if (!groupState || groupElement?.type !== "group") {
        continue;
      }

      hasPresentedAncestor = true;
      inheritedOpacity *= groupState.opacity ?? groupElement.opacity;
      inheritedVisible =
        inheritedVisible && (groupState.visible ?? groupElement.visible);
    }

    if (!hasPresentedAncestor) {
      continue;
    }

    const elementState = elementStates[element.elementId];
    resolvedStates[element.elementId] = {
      ...elementState,
      opacity: (elementState?.opacity ?? element.opacity) * inheritedOpacity,
      visible: (elementState?.visible ?? element.visible) && inheritedVisible,
    };
  }

  return resolvedStates;
}

function buildParentGroupIdsByChildId(elements: DeckElement[]) {
  const parentGroupIdsByChildId = new Map<string, string[]>();

  for (const element of elements) {
    if (element.type !== "group") {
      continue;
    }

    const groupProps = element.props as GroupElementProps;
    for (const childElementId of groupProps.childElementIds) {
      const parentGroupIds = parentGroupIdsByChildId.get(childElementId) ?? [];
      if (!parentGroupIds.includes(element.elementId)) {
        parentGroupIds.push(element.elementId);
      }
      parentGroupIdsByChildId.set(childElementId, parentGroupIds);
    }
  }

  return parentGroupIdsByChildId;
}
