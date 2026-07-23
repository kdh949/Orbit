import { createDemoDeck } from "@orbit/editor-core";
import { describe, expect, it } from "vitest";

import { projectMorphDeckForStaticExport } from "./morph-export-projection";

describe("projectMorphDeckForStaticExport", () => {
  it("removes only morph transitions without mutating the stored deck", () => {
    const deck = createDemoDeck();
    deck.slides[0]!.transition = { type: "fade", durationMs: 700 };
    deck.slides[1]!.transition = {
      type: "morph",
      durationMs: 1000,
      mode: "object",
    };
    deck.slides[1]!.elements[0]!.morphKey =
      deck.slides[0]!.elements[0]!.elementId;
    const original = structuredClone(deck);

    const projected = projectMorphDeckForStaticExport(deck);

    expect(projected.slides[0]!.transition).toEqual({
      type: "fade",
      durationMs: 700,
    });
    expect(projected.slides[1]!.transition).toBeUndefined();
    expect(projected.slides[1]!.elements[0]!.morphKey).toBe(
      deck.slides[0]!.elements[0]!.elementId,
    );
    expect(deck).toEqual(original);
  });
});
