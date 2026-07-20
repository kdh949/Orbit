import { describe, expect, it } from "vitest";

import { createDemoDeck } from "../index";
import { applyDeckPatch } from "./applyPatch";
import {
  createElementFramePatch,
  normalizeElementFrameDraft
} from "./elementFrame";

describe("elementFrame helpers", () => {
  it("preserves finite off-canvas coordinates while normalizing other frame values", () => {
    const deck = createDemoDeck();
    const element = deck.slides[0].elements[0];
    const frame = normalizeElementFrameDraft(deck.canvas, element, {
      x: -40,
      y: 5000,
      width: 0,
      height: Number.NaN,
      rotation: -45,
      opacity: 4,
      zIndex: -3
    });

    expect(frame).toMatchObject({
      x: -40,
      y: 5000,
      width: 1,
      height: 1,
      rotation: 315,
      opacity: 1,
      zIndex: 0
    });
  });

  it("falls back to the current position for non-finite coordinates", () => {
    const deck = createDemoDeck();
    const element = deck.slides[0].elements[0];
    const frame = normalizeElementFrameDraft(deck.canvas, element, {
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY
    });

    expect(frame).toMatchObject({
      x: element.x,
      y: element.y
    });
  });

  it("falls back to zero when the current position is also non-finite", () => {
    const deck = createDemoDeck();
    const element = {
      ...deck.slides[0].elements[0],
      x: Number.NaN,
      y: Number.NEGATIVE_INFINITY
    };
    const frame = normalizeElementFrameDraft(deck.canvas, element, {});

    expect(frame).toMatchObject({
      x: 0,
      y: 0
    });
  });

  it("clamps finite coordinates to the supported absolute range", () => {
    const deck = createDemoDeck();
    const element = deck.slides[0].elements[0];
    const frame = normalizeElementFrameDraft(deck.canvas, element, {
      x: 1_000_001,
      y: -1_000_001
    });

    expect(frame).toMatchObject({
      x: 1_000_000,
      y: -1_000_000
    });
  });

  it("creates an update_element_frame patch that can be applied to a deck", () => {
    const deck = createDemoDeck();
    const patch = createElementFramePatch(deck, "slide_1", "el_1", {
      x: 240,
      y: 180,
      width: 700,
      height: 140,
      rotation: 30
    });
    const result = applyDeckPatch(deck, patch);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.deck.slides[0].elements[0]).toMatchObject({
      x: 240,
      y: 180,
      width: 700,
      height: 140,
      rotation: 30
    });
  });

  it("creates an applicable patch for an off-canvas element position", () => {
    const deck = createDemoDeck();
    const patch = createElementFramePatch(deck, "slide_1", "el_1", {
      x: -240,
      y: -80
    });
    const result = applyDeckPatch(deck, patch);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.deck.slides[0].elements[0]).toMatchObject({
      x: -240,
      y: -80
    });
  });

  it("keeps explicit null role when clearing element role", () => {
    const deck = createDemoDeck();
    const element = deck.slides[0].elements[0];
    const frame = normalizeElementFrameDraft(deck.canvas, element, {
      role: null
    });

    expect(frame.role).toBeNull();
  });
});
