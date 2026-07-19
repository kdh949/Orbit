import { describe, expect, it } from "vitest";

import type { Deck } from "@orbit/shared";
import { createDemoDeck } from "../index";
import {
  createAddAnimationPatch,
  createAnimationId,
  createDefaultAnimation,
  createDeleteAnimationPatch,
  createUpdateAnimationPatch,
  getElementAnimations,
  getNextAnimationOrder,
  validateSlideAnimations
} from "./animationOperations";

describe("animation operations", () => {
  it("creates add, update, and delete animation patches", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const animation = createDefaultAnimation(deck, slide, "el_1");

    expect(createAddAnimationPatch(deck, slide.slideId, animation)).toMatchObject({
      operations: [
        {
          type: "add_animation",
          slideId: slide.slideId,
          animation
        }
      ]
    });
    expect(
      createUpdateAnimationPatch(deck, slide.slideId, "anim_1", {
        durationMs: 700,
        order: 4
      })
    ).toMatchObject({
      operations: [
        {
          type: "update_animation",
          slideId: slide.slideId,
          animationId: "anim_1",
          animation: {
            durationMs: 700,
            order: 4
          }
        }
      ]
    });
    expect(
      createDeleteAnimationPatch(deck, slide.slideId, "anim_1")
    ).toMatchObject({
      operations: [
        {
          type: "delete_animation",
          slideId: slide.slideId,
          animationId: "anim_1"
        }
      ]
    });
  });

  it("creates the next unique animation id across the deck", () => {
    const deck = createDemoDeck();

    expect(createAnimationId(deck)).toBe("anim_4");
  });

  it("creates default animations with authoring defaults", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;

    expect(createDefaultAnimation(deck, slide, "el_1")).toEqual({
      animationId: "anim_4",
      elementId: "el_1",
      type: "fade-in",
      order: 3,
      startMode: "on-click",
      durationMs: 400,
      delayMs: 0,
      easing: "ease-out"
    });
  });

  it("returns element animations in stable display order", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: [
        ...deck.slides[0]!.animations,
        {
          animationId: "anim_10",
          elementId: "el_1",
          type: "zoom-in",
          order: 1,
          durationMs: 300,
          delayMs: 10,
          easing: "ease-in"
        },
        {
          animationId: "anim_11",
          elementId: "el_1",
          type: "fade-out",
          order: 1,
          durationMs: 300,
          delayMs: 0,
          easing: "ease-out"
        }
      ]
    } satisfies Deck["slides"][number];

    expect(getElementAnimations(slide, "el_1").map((animation) => animation.animationId)).toEqual([
      "anim_1",
      "anim_11",
      "anim_10"
    ]);
  });

  it("computes the next animation order for empty and populated slides", () => {
    const deck = createDemoDeck();

    expect(getNextAnimationOrder(deck.slides[0]!)).toBe(3);
    expect(
      getNextAnimationOrder({
        ...deck.slides[1]!,
        animations: []
      })
    ).toBe(1);
  });

  it("reports duplicate orders, dangling targets, and selected element empty state", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: [
        {
          animationId: "anim_dup_1",
          elementId: "el_1",
          type: "appear",
          order: 1,
          durationMs: 300,
          delayMs: 0,
          easing: "ease-out"
        },
        {
          animationId: "anim_dup_2",
          elementId: "el_4",
          type: "fade-in",
          order: 1,
          durationMs: 300,
          delayMs: 0,
          easing: "ease-out"
        },
        {
          animationId: "anim_dangling",
          elementId: "el_missing",
          type: "zoom-in",
          order: 4,
          durationMs: 300,
          delayMs: 0,
          easing: "ease-out"
        }
      ]
    } satisfies Deck["slides"][number];

    expect(validateSlideAnimations(slide, "el_2")).toEqual({
      danglingAnimations: [
        {
          animationId: "anim_dangling",
          elementId: "el_missing"
        }
      ],
      duplicateOrders: [
        {
          animationIds: ["anim_dup_1", "anim_dup_2"],
          order: 1
        }
      ],
      selectedElementEmpty: true
    });
  });
});
