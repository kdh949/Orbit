import { describe, expect, it } from "vitest";

import { createDemoDeck } from "../index";
import { applyDeckPatch } from "./applyPatch";
import {
  createGroupedElementFramePatch,
  getGroupedSelectionBounds,
  transformGroupedChildFrame
} from "./groupFrame";

describe("group frame helpers", () => {
  it("calculates grouped selection bounds from child element frames", () => {
    const deck = createDemoDeck();
    const elements = deck.slides[0].elements.slice(0, 3);

    expect(getGroupedSelectionBounds(elements)).toEqual({
      x: 120,
      y: 96,
      width: 1520,
      height: 332
    });
  });

  it("transforms a child frame when the parent group is scaled and rotated", () => {
    const nextFrame = transformGroupedChildFrame({
      childElement: {
        elementId: "el_child",
        type: "rect",
        role: "highlight",
        x: 150,
        y: 125,
        width: 50,
        height: 25,
        rotation: 10,
        opacity: 1,
        zIndex: 1,
        locked: false,
        visible: true,
        props: {
          fill: "#dbeafe",
          stroke: "#2563eb",
          strokeWidth: 2,
          borderRadius: 0
        }
      },
      currentGroupFrame: {
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        rotation: 0
      },
      nextGroupFrame: {
        x: 120,
        y: 140,
        width: 400,
        height: 200,
        rotation: 90
      }
    });

    expect(nextFrame.x).toBeCloseTo(295);
    expect(nextFrame.y).toBeCloseTo(165);
    expect(nextFrame.width).toBeCloseTo(100);
    expect(nextFrame.height).toBeCloseTo(50);
    expect(nextFrame.rotation).toBeCloseTo(100);
  });

  it("creates recursive frame update operations for grouped children", () => {
    const deck = createDemoDeck();
    const firstSlide = deck.slides[0];

    firstSlide.elements = [
      {
        elementId: "el_child_1",
        type: "text",
        role: "body",
        x: 140,
        y: 140,
        width: 120,
        height: 60,
        rotation: 0,
        opacity: 1,
        zIndex: 10,
        locked: false,
        visible: true,
        props: {
          text: "child 1",
          fontSize: 24,
          fontWeight: "normal",
          align: "left",
          verticalAlign: "top",
          lineHeight: 1.2,
          color: "#111827"
        }
      },
      {
        elementId: "el_nested_child",
        type: "rect",
        role: "highlight",
        x: 300,
        y: 170,
        width: 80,
        height: 50,
        rotation: 12,
        opacity: 1,
        zIndex: 11,
        locked: false,
        visible: true,
        props: {
          fill: "#dbeafe",
          stroke: "#2563eb",
          strokeWidth: 2,
          borderRadius: 8
        }
      },
      {
        elementId: "el_nested_group",
        type: "group",
        role: "decoration",
        x: 260,
        y: 140,
        width: 160,
        height: 120,
        rotation: 0,
        opacity: 1,
        zIndex: 12,
        locked: false,
        visible: true,
        props: {
          childElementIds: ["el_nested_child"]
        }
      },
      {
        elementId: "el_group",
        type: "group",
        role: "decoration",
        x: 120,
        y: 120,
        width: 360,
        height: 200,
        rotation: 0,
        opacity: 1,
        zIndex: 13,
        locked: false,
        visible: true,
        props: {
          childElementIds: ["el_child_1", "el_nested_group"]
        }
      }
    ];

    const patch = createGroupedElementFramePatch(
      deck,
      firstSlide.slideId,
      "el_group",
      {
        x: 170,
        y: 190
      }
    );
    const result = applyDeckPatch(deck, patch);

    expect(patch.operations).toHaveLength(4);
    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    const updatedElements = result.deck.slides[0].elements;

    expect(updatedElements.find((element) => element.elementId === "el_group")).toMatchObject({
      x: 170,
      y: 190
    });
    expect(
      updatedElements.find((element) => element.elementId === "el_child_1")
    ).toMatchObject({
      x: 190,
      y: 210,
      width: 120,
      height: 60
    });
    expect(
      updatedElements.find((element) => element.elementId === "el_nested_group")
    ).toMatchObject({
      x: 310,
      y: 210,
      width: 160,
      height: 120
    });
    expect(
      updatedElements.find((element) => element.elementId === "el_nested_child")
    ).toMatchObject({
      x: 350,
      y: 240,
      width: 80,
      height: 50,
      rotation: 12
    });

    const offCanvasPatch = createGroupedElementFramePatch(
      deck,
      firstSlide.slideId,
      "el_group",
      {
        x: -80,
        y: -60
      }
    );
    const offCanvasResult = applyDeckPatch(deck, offCanvasPatch);

    expect(offCanvasResult.ok).toBe(true);

    if (!offCanvasResult.ok) {
      return;
    }

    const offCanvasElements = offCanvasResult.deck.slides[0].elements;

    expect(
      offCanvasElements.find((element) => element.elementId === "el_group")
    ).toMatchObject({ x: -80, y: -60 });
    expect(
      offCanvasElements.find((element) => element.elementId === "el_child_1")
    ).toMatchObject({ x: -60, y: -40 });
    expect(
      offCanvasElements.find((element) => element.elementId === "el_nested_group")
    ).toMatchObject({ x: 60, y: -40 });
    expect(
      offCanvasElements.find((element) => element.elementId === "el_nested_child")
    ).toMatchObject({ x: 100, y: -10 });
  });
});
