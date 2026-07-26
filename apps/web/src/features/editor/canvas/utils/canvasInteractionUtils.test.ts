import type { DeckElement } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";

import {
  canDragCanvasElement,
  getElementsIntersectingSelectionRect,
  getSnappedElementPosition
} from "./canvasInteractionUtils";

describe("canDragCanvasElement", () => {
  it("allows the selected unlocked element to move", () => {
    expect(
      canDragCanvasElement({
        interactionDisabled: false,
        isCustomShapeEditing: false,
        isSelected: true,
        locked: false
      })
    ).toBe(true);
  });

  it.each([
    ["unselected image", { isSelected: false }],
    ["locked text", { locked: true }],
    ["image crop interaction", { interactionDisabled: true }],
    ["custom shape node editing", { isCustomShapeEditing: true }]
  ])("blocks %s dragging", (_label, override) => {
    expect(
      canDragCanvasElement({
        interactionDisabled: false,
        isCustomShapeEditing: false,
        isSelected: true,
        locked: false,
        ...override
      })
    ).toBe(false);
  });
});

function element(
  elementId: string,
  frame: { x: number; y: number; width: number; height: number },
  options: { rotation?: number; visible?: boolean } = {}
) {
  return {
    elementId,
    type: "rect",
    role: "decoration",
    ...frame,
    rotation: options.rotation ?? 0,
    opacity: 1,
    zIndex: 1,
    locked: false,
    visible: options.visible ?? true,
    props: {
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 0,
      borderRadius: 0
    }
  } as DeckElement;
}

describe("getSnappedElementPosition", () => {
  it("snaps an element center to the canvas center", () => {
    expect(getSnappedElementPosition({
      canvas: { width: 1000, height: 600 },
      elementId: "moving",
      elements: [],
      frame: { x: 397, y: 100, width: 200, height: 100 },
      threshold: 5
    })).toMatchObject({ x: 400, guides: [{ axis: "x", position: 500 }] });
  });

  it("snaps an element edge to another element edge", () => {
    expect(getSnappedElementPosition({
      canvas: { width: 1000, height: 600 },
      elementId: "moving",
      elements: [element("target", { x: 300, y: 200, width: 100, height: 80 })],
      frame: { x: 196, y: 50, width: 100, height: 100 },
      threshold: 5
    })).toMatchObject({ x: 200, guides: [{ axis: "x", position: 300 }] });
  });
});

describe("getElementsIntersectingSelectionRect", () => {
  it("returns visible elements intersecting the drag selection", () => {
    const elements = [
      element("el_inside", { x: 100, y: 100, width: 120, height: 80 }),
      element("el_partial", { x: 280, y: 180, width: 100, height: 100 }),
      element("el_outside", { x: 600, y: 500, width: 100, height: 100 }),
      element("el_hidden", { x: 120, y: 120, width: 80, height: 80 }, { visible: false })
    ];

    expect(
      getElementsIntersectingSelectionRect(elements, {
        x: 80,
        y: 80,
        width: 240,
        height: 160
      })
    ).toEqual(["el_inside", "el_partial"]);
  });

  it("uses rotated element bounds", () => {
    const rotated = element(
      "el_rotated",
      { x: 300, y: 300, width: 100, height: 40 },
      { rotation: 90 }
    );

    expect(
      getElementsIntersectingSelectionRect([rotated], {
        x: 255,
        y: 320,
        width: 30,
        height: 30
      })
    ).toEqual(["el_rotated"]);
  });
});
