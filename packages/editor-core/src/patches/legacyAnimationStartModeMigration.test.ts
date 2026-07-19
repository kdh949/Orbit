import { deckSchema } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import { createDemoDeck } from "../index";
import { applyDeckPatch } from "./applyPatch";
import { normalizeLegacyAnimationStartModes } from "./legacyAnimationStartModeMigration";

describe("legacy animation startMode migration", () => {
  it("leaves non-cloneable unknown input untouched", () => {
    const input = { slides: [], helper: () => undefined };

    expect(normalizeLegacyAnimationStartModes(input)).toBe(input);
  });

  it("materializes legacy groups from action references without changing explicit modes", () => {
    const rawDeck = createLegacyMotionDeck();
    const normalized = deckSchema.parse(
      normalizeLegacyAnimationStartModes(rawDeck)
    );

    expect(
      normalized.slides[0].animations.map((animation) => ({
        animationId: animation.animationId,
        order: animation.order,
        startMode: animation.startMode
      }))
    ).toEqual([
      { animationId: "anim_group_click_root", order: 1, startMode: "on-click" },
      {
        animationId: "anim_group_click_follower",
        order: 1,
        startMode: "with-previous"
      },
      {
        animationId: "anim_group_enter_root",
        order: 2,
        startMode: "on-slide-enter"
      },
      {
        animationId: "anim_group_enter_follower",
        order: 2,
        startMode: "with-previous"
      },
      { animationId: "anim_explicit_root", order: 3, startMode: "on-click" },
      {
        animationId: "anim_explicit_follower",
        order: 3,
        startMode: "after-previous"
      }
    ]);
    expect(rawDeck.slides[0].animations[0]).not.toHaveProperty("startMode");
  });

  it("persists normalized modes on the next patch", () => {
    const rawDeck = createLegacyMotionDeck();
    const result = applyDeckPatch(rawDeck, {
      deckId: rawDeck.deckId,
      baseVersion: rawDeck.version,
      source: "user",
      operations: [{ type: "update_deck", title: "Migrated motion" }]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.deck.slides[0].animations.every(
        (animation) => animation.startMode !== undefined
      )
    ).toBe(true);
  });
});

function createLegacyMotionDeck() {
  const deck = createDemoDeck();
  const elementId = deck.slides[0].elements[0]!.elementId;
  deck.slides[0].animations = [
    legacyAnimation("anim_group_click_root", elementId, 1),
    legacyAnimation("anim_group_click_follower", elementId, 1),
    legacyAnimation("anim_group_enter_root", elementId, 2),
    legacyAnimation("anim_group_enter_follower", elementId, 2),
    {
      ...legacyAnimation("anim_explicit_root", elementId, 3),
      startMode: "on-click" as const
    },
    {
      ...legacyAnimation("anim_explicit_follower", elementId, 3),
      startMode: "after-previous" as const
    }
  ];
  deck.slides[0].actions = [
    {
      actionId: "act_legacy_motion",
      trigger: { kind: "cue", cue: "click group" },
      effect: {
        kind: "play-animation",
        animationId: "anim_group_click_follower"
      }
    }
  ];
  return deck;
}

function legacyAnimation(
  animationId: string,
  elementId: string,
  order: number
) {
  return {
    animationId,
    elementId,
    type: "fade-in" as const,
    order,
    durationMs: 400,
    delayMs: 0,
    easing: "ease-out" as const
  };
}
