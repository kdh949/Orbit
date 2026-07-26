import { createDemoDeck } from "@orbit/editor-core";
import type { DeckElement } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";

import {
  isCanvasPointInsideSelectedTransformerArea,
  isTransformerControlHit
} from "./useCanvasBackgroundPointerCapture";
import { isCanvasPointInsideElementSelectionArea } from "../utils/canvasInteractionUtils";

type RectElement = Extract<DeckElement, { type: "rect" }>;

function createBackgroundElement(
  overrides: Partial<RectElement> = {}
): RectElement {
  return {
    elementId: "el_background",
    type: "rect",
    role: "background",
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    locked: true,
    visible: true,
    props: {
      fill: "#ffffff",
      stroke: "transparent",
      strokeWidth: 0,
      borderRadius: 0
    },
    ...overrides
  };
}

describe("canvas background selection", () => {
  it("treats a full-canvas background as an ordinary selection hit", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;

    expect(
      isCanvasPointInsideElementSelectionArea({
        deck,
        element: createBackgroundElement(),
        point: { x: 10, y: 10 },
        slide
      })
    ).toBe(true);
  });

  it("does not treat transformer resize and rotation anchors as canvas background", () => {
    const stage = {
      getIntersection: () => ({
        hasName: (name: string) => name === "_anchor"
      })
    };

    expect(
      isTransformerControlHit(
        stage,
        { x: 120, y: 80 }
      )
    ).toBe(true);
  });

  it("keeps ordinary canvas hits eligible for background selection", () => {
    const stage = {
      getIntersection: () => ({
        hasName: () => false
      })
    };

    expect(
      isTransformerControlHit(
        stage,
        { x: 120, y: 80 }
      )
    ).toBe(false);
  });

  it("preserves selection around resize and rotation controls at low zoom", () => {
    const selectedElement = createBackgroundElement({
      elementId: "el_selected",
      role: "decoration",
      locked: false,
      x: 200,
      y: 300,
      width: 400,
      height: 120
    });

    expect(
      isCanvasPointInsideSelectedTransformerArea({
        elements: [selectedElement],
        point: { x: 400, y: 100 },
        selectedElementIds: [selectedElement.elementId],
        stageScale: 0.25
      })
    ).toBe(true);
    expect(
      isCanvasPointInsideSelectedTransformerArea({
        elements: [selectedElement],
        point: { x: 1_000, y: 800 },
        selectedElementIds: [selectedElement.elementId],
        stageScale: 0.25
      })
    ).toBe(false);
  });
});
