import { describe, expect, it } from "vitest";

import { createDemoDeck } from "../index";
import { applyDeckPatch } from "./applyPatch";
import { createImageCropPatch } from "./imageCropOperations";

describe("createImageCropPatch", () => {
  it("creates one atomic frame and crop patch", () => {
    const deck = createDemoDeck();
    const patch = createImageCropPatch(deck, "slide_1", "el_4", {
      frame: {
        x: 140,
        y: 210,
        width: 320,
        height: 180,
        rotation: 30,
      },
      crop: { left: 0.1, top: 0.2, right: 0.15, bottom: 0.05 },
    });

    expect(patch.baseVersion).toBe(deck.version);
    expect(patch.operations).toHaveLength(2);
    expect(patch.operations[0]).toMatchObject({
      type: "update_element_frame",
      slideId: "slide_1",
      elementId: "el_4",
      frame: {
        x: 140,
        y: 210,
        width: 320,
        height: 180,
        rotation: 30,
      },
    });
    expect(patch.operations[1]).toEqual({
      type: "update_element_props",
      slideId: "slide_1",
      elementId: "el_4",
      props: {
        crop: { left: 0.1, top: 0.2, right: 0.15, bottom: 0.05 },
      },
    });

    const result = applyDeckPatch(deck, patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const image = result.deck.slides[0]?.elements.find(
      (element) => element.elementId === "el_4",
    );
    expect(result.deck.version).toBe(deck.version + 1);
    expect(image).toMatchObject({
      x: 140,
      y: 210,
      width: 320,
      height: 180,
      rotation: 30,
      props: {
        crop: { left: 0.1, top: 0.2, right: 0.15, bottom: 0.05 },
      },
    });
  });

  it("rejects non-image elements", () => {
    const deck = createDemoDeck();
    expect(() =>
      createImageCropPatch(deck, "slide_1", "el_1", {
        frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
      }),
    ).toThrow("not an image");
  });
});
