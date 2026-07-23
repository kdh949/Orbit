import type { DeckElement } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import { applyCloneMorphLineage } from "./useEditorCanvasCommands";

function createElement(
  elementId: string,
  morphKey?: string
): DeckElement {
  return {
    elementId,
    ...(morphKey ? { morphKey } : {}),
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    locked: false,
    visible: true,
    props: {
      fill: "#FFFFFF",
      stroke: "transparent",
      strokeWidth: 0,
      borderRadius: 0
    }
  };
}

describe("clone morph lineage", () => {
  it("clears lineage for same-slide duplication", () => {
    const sourceElement = createElement("el_source", "el_lineage");
    const clonedElement = createElement("el_clone", "el_lineage");

    applyCloneMorphLineage({
      allowMorphLineage: true,
      clonedElement,
      destinationMatchKeys: new Set(["el_lineage"]),
      destinationSlideId: "slide_1",
      sourceElement,
      sourceSlideId: "slide_1"
    });

    expect(clonedElement.morphKey).toBeUndefined();
  });

  it("preserves effective lineage for cross-slide paste", () => {
    const sourceElement = createElement("el_source", "el_lineage");
    const clonedElement = createElement("el_clone");
    const destinationMatchKeys = new Set<string>();

    applyCloneMorphLineage({
      allowMorphLineage: true,
      clonedElement,
      destinationMatchKeys,
      destinationSlideId: "slide_2",
      sourceElement,
      sourceSlideId: "slide_1"
    });

    expect(clonedElement.morphKey).toBe("el_lineage");
    expect(destinationMatchKeys.has("el_lineage")).toBe(true);
  });

  it("leaves a colliding cross-slide paste unlinked", () => {
    const sourceElement = createElement("el_source");
    const clonedElement = createElement("el_clone");

    applyCloneMorphLineage({
      allowMorphLineage: true,
      clonedElement,
      destinationMatchKeys: new Set(["el_source"]),
      destinationSlideId: "slide_2",
      sourceElement,
      sourceSlideId: "slide_1"
    });

    expect(clonedElement.morphKey).toBeUndefined();
  });

  it("does not add lineage in imported decks", () => {
    const sourceElement = createElement("el_source");
    const clonedElement = createElement("el_clone", "el_stale");

    applyCloneMorphLineage({
      allowMorphLineage: false,
      clonedElement,
      destinationMatchKeys: new Set(),
      destinationSlideId: "slide_2",
      sourceElement,
      sourceSlideId: "slide_1"
    });

    expect(clonedElement.morphKey).toBeUndefined();
  });
});
