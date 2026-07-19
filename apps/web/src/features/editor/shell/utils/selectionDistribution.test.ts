import { createDemoDeck } from "@orbit/editor-core";
import { describe, expect, it } from "vitest";

import { createDistributeSelectionPatch } from "./selectionDistribution";

describe("createDistributeSelectionPatch lock policy", () => {
  it("does not move a selection containing a locked element", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    slide.elements = slide.elements.slice(0, 3).map((element, index) => ({
      ...element,
      locked: index === 1,
      x: index * 300,
    }));

    expect(
      createDistributeSelectionPatch(deck, slide, slide.elements, "x"),
    ).toBeNull();
  });
});
