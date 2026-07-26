import type {
  CustomShapeElementProps,
  Deck,
  DeckElement,
  Slide,
  TextElementProps,
} from "@orbit/shared/deck";

import {
  convertCustomShapeNodesToAbsolute,
  getCustomShapeDimension,
  type CanvasPoint,
} from "../custom-shape/geometry";
import { getTextElementLayout } from "../text/textLayout";

export function canDragCanvasElement(args: {
  interactionDisabled: boolean;
  isCustomShapeEditing: boolean;
  isSelected: boolean;
  locked: boolean;
}): boolean {
  return (
    args.isSelected &&
    !args.locked &&
    !args.interactionDisabled &&
    !args.isCustomShapeEditing
  );
}

export function commitCustomShapeEditGeometry(args: {
  element: DeckElement;
  draft: {
    closed: boolean;
    nodes: CustomShapeElementProps["nodes"];
  };
}) {
  const customShapeProps = args.element.props as CustomShapeElementProps;

  return {
    closed: args.draft.closed,
    elementId: args.element.elementId,
    nodes: convertCustomShapeNodesToAbsolute({
      frame: {
        height: args.element.height,
        width: args.element.width,
        x: args.element.x,
        y: args.element.y,
      },
      nodes: args.draft.nodes,
      viewBoxHeight: getCustomShapeDimension(
        customShapeProps,
        "viewBoxHeight",
        args.element.height,
      ),
      viewBoxWidth: getCustomShapeDimension(
        customShapeProps,
        "viewBoxWidth",
        args.element.width,
      ),
    }),
  };
}

export function isCanvasPointInsideElementSelectionArea(args: {
  deck: Deck;
  element: DeckElement;
  point: CanvasPoint;
  slide: Slide;
}) {
  const { deck, element, point, slide } = args;

  if (!element.visible) {
    return false;
  }

  if (element.type === "text") {
    const textLayout = getTextElementLayout({
      frame: {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
      },
      props: element.props as TextElementProps,
      slide,
      theme: deck.theme,
    });

    return isCanvasPointInsideRotatedFrame({
      frame: {
        x: element.x + textLayout.contentX,
        y: element.y + textLayout.y,
        width: Math.max(24, textLayout.contentWidth),
        height: Math.max(1, textLayout.contentHeight),
        rotation: element.rotation,
      },
      point,
    });
  }

  return isCanvasPointInsideRotatedFrame({
    frame: {
      x: element.x,
      y: element.y,
      width: Math.max(1, element.width),
      height: Math.max(1, element.height),
      rotation: element.rotation,
    },
    point,
  });
}

export function normalizeDraftRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  if (width < 4 && height < 4) {
    return null;
  }

  return {
    x,
    y,
    width: Math.max(8, width),
    height: Math.max(8, height),
  };
}

export function getElementsIntersectingSelectionRect(
  elements: DeckElement[],
  selectionRect: { x: number; y: number; width: number; height: number },
) {
  const selectionRight = selectionRect.x + selectionRect.width;
  const selectionBottom = selectionRect.y + selectionRect.height;

  return elements
    .filter((element) => {
      if (!element.visible) return false;
      const bounds = getRotatedElementAabb(element);
      return (
        bounds.x < selectionRight &&
        bounds.x + bounds.width > selectionRect.x &&
        bounds.y < selectionBottom &&
        bounds.y + bounds.height > selectionRect.y
      );
    })
    .map((element) => element.elementId);
}

export type CanvasSnapGuide = {
  axis: "x" | "y";
  position: number;
};

export function getSnappedElementPosition(args: {
  canvas: { height: number; width: number };
  elementId: string;
  elements: DeckElement[];
  frame: { height: number; width: number; x: number; y: number };
  threshold: number;
}) {
  const verticalTargets = [0, args.canvas.width / 2, args.canvas.width];
  const horizontalTargets = [0, args.canvas.height / 2, args.canvas.height];

  for (const element of args.elements) {
    if (element.elementId === args.elementId || !element.visible) continue;
    verticalTargets.push(
      element.x,
      element.x + element.width / 2,
      element.x + element.width,
    );
    horizontalTargets.push(
      element.y,
      element.y + element.height / 2,
      element.y + element.height,
    );
  }

  const verticalSnap = findClosestSnap(
    [0, args.frame.width / 2, args.frame.width],
    verticalTargets,
    args.frame.x,
    args.threshold,
  );
  const horizontalSnap = findClosestSnap(
    [0, args.frame.height / 2, args.frame.height],
    horizontalTargets,
    args.frame.y,
    args.threshold,
  );

  return {
    x: verticalSnap?.coordinate ?? args.frame.x,
    y: horizontalSnap?.coordinate ?? args.frame.y,
    guides: [
      ...(verticalSnap
        ? [{ axis: "x" as const, position: verticalSnap.target }]
        : []),
      ...(horizontalSnap
        ? [{ axis: "y" as const, position: horizontalSnap.target }]
        : []),
    ],
  };
}

function findClosestSnap(
  anchorOffsets: number[],
  targets: number[],
  coordinate: number,
  threshold: number,
) {
  let closest: { coordinate: number; distance: number; target: number } | null =
    null;
  for (const target of targets) {
    for (const offset of anchorOffsets) {
      const distance = Math.abs(target - (coordinate + offset));
      if (distance > threshold || (closest && distance >= closest.distance))
        continue;
      closest = { coordinate: target - offset, distance, target };
    }
  }
  return closest;
}

export function getRotatedElementAabb(
  element: Pick<DeckElement, "height" | "rotation" | "width" | "x" | "y">,
) {
  const radians = (element.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [
    { x: 0, y: 0 },
    { x: element.width, y: 0 },
    { x: 0, y: element.height },
    { x: element.width, y: element.height },
  ].map((point) => ({
    x: element.x + point.x * cos - point.y * sin,
    y: element.y + point.x * sin + point.y * cos,
  }));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function isCanvasPointInsideRotatedFrame(args: {
  frame: {
    height: number;
    rotation: number;
    width: number;
    x: number;
    y: number;
  };
  point: CanvasPoint;
}) {
  const { frame, point } = args;
  const rotationRadians = (frame.rotation * Math.PI) / 180;
  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);
  const relativeX = point.x - frame.x;
  const relativeY = point.y - frame.y;
  const localX = relativeX * cos + relativeY * sin;
  const localY = -relativeX * sin + relativeY * cos;

  return (
    localX >= 0 &&
    localX <= frame.width &&
    localY >= 0 &&
    localY <= frame.height
  );
}
