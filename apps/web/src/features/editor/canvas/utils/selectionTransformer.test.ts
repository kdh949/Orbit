import type { DeckElement } from "@orbit/shared";
import { describe, expect, it } from "vitest";
import {
  getSelectionTransformerConfig,
  resolveTransformedElementFrame,
} from "./selectionTransformer";

function createElement(type: DeckElement["type"]): DeckElement {
  return { type } as DeckElement;
}

describe("getSelectionTransformerConfig", () => {
  it("keeps handles compact on a zoomed-out canvas", () => {
    const config = getSelectionTransformerConfig({
      disableInteractions: false,
      selectedElements: [createElement("text")],
      stageScale: 0.25,
    });

    expect(config.anchorSize).toBe(12);
    expect(config.anchorHitStrokeWidth).toBe(20);
    expect(config.rotateAnchorOffset).toBe(32);
  });

  it.each(["image", "svg"] as const)(
    "uses proportional corner handles for %s elements",
    (type) => {
      const config = getSelectionTransformerConfig({
        disableInteractions: false,
        selectedElements: [createElement(type)],
        stageScale: 1,
      });

      expect(config.keepRatio).toBe(true);
      expect(config.enabledAnchors).toEqual([
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ]);
    },
  );

  it("keeps independent resize handles for editable shapes and text", () => {
    const config = getSelectionTransformerConfig({
      disableInteractions: false,
      selectedElements: [createElement("text")],
      stageScale: 1,
    });

    expect(config.keepRatio).toBe(false);
    expect(config.enabledAnchors).toHaveLength(8);
  });

  it("removes resize handles when interactions are disabled", () => {
    const config = getSelectionTransformerConfig({
      disableInteractions: true,
      selectedElements: [createElement("image")],
      stageScale: 1,
    });

    expect(config.enabledAnchors).toEqual([]);
  });
});

describe("resolveTransformedElementFrame", () => {
  it("commits element scaling and rotation to the persisted frame", () => {
    expect(
      resolveTransformedElementFrame({
        frame: { x: 10, y: 20, width: 100, height: 50, rotation: 0 },
        transform: {
          x: 30,
          y: 40,
          scaleX: 2,
          scaleY: 1.5,
          rotation: 45,
        },
      }),
    ).toEqual({
      x: 30,
      y: 40,
      width: 200,
      height: 75,
      rotation: 45,
    });
  });
});
