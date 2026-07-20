import { createDemoDeck } from "@orbit/editor-core";
import { describe, expect, it } from "vitest";

import {
  createTargetDurationDraft,
  createTargetDurationPatch,
  distributeTargetDuration,
  formatTargetDuration,
} from "./targetDurationModel";

describe("target duration model", () => {
  it("distributes the complete deck target across slides", () => {
    const deck = createDemoDeck();
    const slides = [
      deck.slides[0]!,
      { ...deck.slides[0]!, slideId: "slide_2", title: "Second" },
      { ...deck.slides[0]!, slideId: "slide_3", title: "Third" },
    ];

    const durations = distributeTargetDuration(10, slides);

    expect(durations.map((duration) => duration.estimatedSeconds)).toEqual([
      200, 200, 200,
    ]);
  });

  it("keeps explicit slide targets and falls back for missing targets", () => {
    const deck = createDemoDeck();
    deck.targetDurationMinutes = 2;
    deck.slides = [
      { ...deck.slides[0]!, estimatedSeconds: 80 },
      { ...deck.slides[0]!, slideId: "slide_2", order: 2 },
    ];

    expect(
      createTargetDurationDraft(deck).map((item) => item.estimatedSeconds),
    ).toEqual([80, 60]);
  });

  it("creates one patch for the deck target and slide allocations", () => {
    const deck = createDemoDeck();
    const durations = distributeTargetDuration(12, deck.slides);

    const patch = createTargetDurationPatch(deck, 12, durations);

    expect(patch?.operations).toEqual([
      { type: "update_deck", targetDurationMinutes: 12 },
      {
        type: "update_slide",
        slideId: deck.slides[0]!.slideId,
        estimatedSeconds: 360,
      },
      {
        type: "update_slide",
        slideId: deck.slides[1]!.slideId,
        estimatedSeconds: 360,
      },
    ]);
  });

  it("rejects a slide allocation that does not match the deck target", () => {
    const deck = createDemoDeck();
    const durations = distributeTargetDuration(10, deck.slides);
    durations[0]!.estimatedSeconds -= 10;

    expect(() => createTargetDurationPatch(deck, 10, durations)).toThrow(
      "must equal",
    );
  });

  it("includes a changed slide title in the slide timing patch", () => {
    const deck = createDemoDeck();
    const durations = createTargetDurationDraft(deck);
    durations[0]!.title = "새 슬라이드 제목";

    const patch = createTargetDurationPatch(
      deck,
      deck.targetDurationMinutes,
      durations,
    );

    expect(patch?.operations[0]).toMatchObject({
      type: "update_slide",
      slideId: deck.slides[0]!.slideId,
      title: "새 슬라이드 제목",
    });
  });

  it("formats minute and second labels", () => {
    expect(formatTargetDuration(125)).toBe("2:05");
  });
});
