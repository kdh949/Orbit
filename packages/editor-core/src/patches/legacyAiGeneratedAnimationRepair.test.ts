import type { Deck } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";
import { createDemoDeck } from "../index";
import { removeLegacyAiGeneratedTitleAnimations } from "./legacyAiGeneratedAnimationRepair";

function createLegacyAiDeck(): Deck {
  const deck = createDemoDeck();
  const firstSlide = deck.slides[0]!;

  deck.metadata.sourceType = "ai";
  deck.metadata.generatedBy = "ai";
  firstSlide.animations = [
    {
      animationId: `anim_${firstSlide.order}_1`,
      elementId: firstSlide.elements.find((element) => element.role === "title")!
        .elementId,
      type: "fade-in",
      order: 1,
      durationMs: 400,
      delayMs: 0,
      easing: "ease-out"
    },
    {
      animationId: "anim_manual",
      elementId: firstSlide.elements[1]!.elementId,
      type: "zoom-in",
      order: 2,
      durationMs: 600,
      delayMs: 0,
      easing: "ease-in-out"
    }
  ];
  return deck;
}

describe("removeLegacyAiGeneratedTitleAnimations", () => {
  it("removes only the unmodified automatic title animation from AI decks", () => {
    const repaired = removeLegacyAiGeneratedTitleAnimations(createLegacyAiDeck());

    expect(
      repaired.slides[0]?.animations.map((animation) => animation.animationId)
    ).toEqual(["anim_manual"]);
  });

  it("preserves the legacy animation when a user connected it to a trigger", () => {
    const deck = createLegacyAiDeck();
    const animationId = deck.slides[0]!.animations[0]!.animationId;
    deck.slides[0]!.actions.push({
      actionId: "act_user_trigger",
      trigger: {
        kind: "keyword",
        keywordId: deck.slides[0]!.keywords[0]!.keywordId
      },
      effect: { kind: "play-animation", animationId }
    });

    const repaired = removeLegacyAiGeneratedTitleAnimations(deck);

    expect(repaired.slides[0]?.animations).toHaveLength(2);
  });

  it("does not change non-AI decks", () => {
    const deck = createLegacyAiDeck();
    deck.metadata.sourceType = "manual";

    expect(removeLegacyAiGeneratedTitleAnimations(deck)).toBe(deck);
  });
});
