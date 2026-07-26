import type {
  Deck,
  DeckCanvas,
  DeckElement,
  DeckPatch,
  GroupElementProps,
  Slide,
} from "@orbit/shared/deck";

import {
  normalizeElementFrameDraft,
  type ElementFrameDraft
} from "./elementFrame";

type FrameGeometry = Pick<
  DeckElement,
  "x" | "y" | "width" | "height" | "rotation"
>;

type UpdateElementFrameOperation = Extract<
  DeckPatch["operations"][number],
  { type: "update_element_frame" }
>;

export function getGroupedSelectionBounds(elements: DeckElement[]) {
  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const maxX = Math.max(...elements.map((element) => element.x + element.width));
  const maxY = Math.max(...elements.map((element) => element.y + element.height));

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

export function getGroupChildElements(slide: Slide, childElementIds: string[]) {
  return childElementIds
    .map((childElementId) =>
      slide.elements.find((candidate) => candidate.elementId === childElementId)
    )
    .filter((candidate): candidate is DeckElement => Boolean(candidate))
    .sort((left, right) => left.zIndex - right.zIndex);
}

export function transformGroupedChildFrame(args: {
  childElement: DeckElement;
  currentGroupFrame: FrameGeometry;
  nextGroupFrame: FrameGeometry;
}) {
  const { childElement, currentGroupFrame, nextGroupFrame } = args;
  const scaleX = nextGroupFrame.width / Math.max(1, currentGroupFrame.width);
  const scaleY = nextGroupFrame.height / Math.max(1, currentGroupFrame.height);
  const rotationDelta = nextGroupFrame.rotation - currentGroupFrame.rotation;
  const rotationRadians = (rotationDelta * Math.PI) / 180;
  const currentGroupCenter = {
    x: currentGroupFrame.x + currentGroupFrame.width / 2,
    y: currentGroupFrame.y + currentGroupFrame.height / 2
  };
  const nextGroupCenter = {
    x: nextGroupFrame.x + nextGroupFrame.width / 2,
    y: nextGroupFrame.y + nextGroupFrame.height / 2
  };
  const childCenter = {
    x: childElement.x + childElement.width / 2,
    y: childElement.y + childElement.height / 2
  };
  const relativeCenter = {
    x: (childCenter.x - currentGroupCenter.x) * scaleX,
    y: (childCenter.y - currentGroupCenter.y) * scaleY
  };
  const rotatedCenter = {
    x:
      relativeCenter.x * Math.cos(rotationRadians) -
      relativeCenter.y * Math.sin(rotationRadians),
    y:
      relativeCenter.x * Math.sin(rotationRadians) +
      relativeCenter.y * Math.cos(rotationRadians)
  };
  const nextWidth = Math.max(1, childElement.width * scaleX);
  const nextHeight = Math.max(1, childElement.height * scaleY);
  const nextCenter = {
    x: nextGroupCenter.x + rotatedCenter.x,
    y: nextGroupCenter.y + rotatedCenter.y
  };

  return {
    height: nextHeight,
    rotation: childElement.rotation + rotationDelta,
    width: nextWidth,
    x: nextCenter.x - nextWidth / 2,
    y: nextCenter.y - nextHeight / 2
  };
}

export function buildGroupedFrameOperations(args: {
  canvas: DeckCanvas;
  groupElement: DeckElement;
  nextGroupFrame: FrameGeometry;
  slide: Slide;
  slideId: string;
}) {
  const { canvas, groupElement, nextGroupFrame, slide, slideId } = args;
  const operations: UpdateElementFrameOperation[] = [];
  const visitedGroupIds = new Set<string>([groupElement.elementId]);

  function visitGroup(currentGroupElement: DeckElement, currentNextGroupFrame: FrameGeometry) {
    if (currentGroupElement.type !== "group") {
      return;
    }

    const groupProps = currentGroupElement.props as GroupElementProps;
    const childElements = getGroupChildElements(slide, groupProps.childElementIds);

    for (const childElement of childElements) {
      const nextChildFrame = transformGroupedChildFrame({
        childElement,
        currentGroupFrame: currentGroupElement,
        nextGroupFrame: currentNextGroupFrame
      });

      operations.push({
        type: "update_element_frame",
        slideId,
        elementId: childElement.elementId,
        frame: normalizeElementFrameDraft(canvas, childElement, nextChildFrame)
      });

      if (childElement.type === "group" && !visitedGroupIds.has(childElement.elementId)) {
        visitedGroupIds.add(childElement.elementId);
        visitGroup(childElement, nextChildFrame);
      }
    }
  }

  visitGroup(groupElement, nextGroupFrame);

  return operations;
}

export function createGroupedElementFramePatch(
  deck: Deck,
  slideId: string,
  groupElementId: string,
  frame: ElementFrameDraft
): DeckPatch {
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  const groupElement = slide?.elements.find(
    (candidate) => candidate.elementId === groupElementId
  );

  if (!slide || !groupElement) {
    throw new Error(`Element ${groupElementId} was not found in slide ${slideId}`);
  }

  if (groupElement.type !== "group") {
    throw new Error(`Element ${groupElementId} is not a group`);
  }

  const normalizedGroupFrame = normalizeElementFrameDraft(
    deck.canvas,
    groupElement,
    frame
  );
  const resolvedGroupFrame = {
    x: normalizedGroupFrame.x ?? groupElement.x,
    y: normalizedGroupFrame.y ?? groupElement.y,
    width: normalizedGroupFrame.width ?? groupElement.width,
    height: normalizedGroupFrame.height ?? groupElement.height,
    rotation: normalizedGroupFrame.rotation ?? groupElement.rotation
  };

  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "update_element_frame",
        slideId,
        elementId: groupElementId,
        frame: normalizedGroupFrame
      },
      ...buildGroupedFrameOperations({
        canvas: deck.canvas,
        groupElement,
        nextGroupFrame: resolvedGroupFrame,
        slide,
        slideId
      })
    ]
  };
}
