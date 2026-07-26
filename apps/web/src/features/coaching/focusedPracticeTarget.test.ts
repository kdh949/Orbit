import { deckSchema } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";

import {
  buildFocusedPracticeTimeline,
  resolveFocusedPracticeDurationGuidance,
  resolveFocusedPracticeSentence,
  resolveFocusedPracticeSlideIds,
} from "./focusedPracticeTarget";

const deck = deckSchema.parse({
  deckId: "deck_a",
  projectId: "project-a",
  title: "Deck",
  version: 1,
  canvas: { preset: "wide-16-9", width: 1920, height: 1080, aspectRatio: "16:9" },
  slides: ["slide_a", "slide_b", "slide_c"].map((slideId, index) => ({
    slideId,
    order: index + 1,
    title: slideId,
    style: {},
    speakerNotes: index === 0 ? "첫 문장. 둘째 문장." : "연습 문장.",
  })),
});

describe("focused-practice target UI helpers", () => {
  it("resolves the five supported target types against deck order", () => {
    expect(resolveFocusedPracticeSlideIds(deck, { type: "sentence", scopeId: "sentence", slideId: "slide_a", sentenceIndex: 1, textSnapshotHash: "a".repeat(64) })).toEqual(["slide_a"]);
    expect(resolveFocusedPracticeSlideIds(deck, { type: "slide", scopeId: "slide", slideId: "slide_b" })).toEqual(["slide_b"]);
    expect(resolveFocusedPracticeSlideIds(deck, { type: "slide-range", scopeId: "range", startSlideId: "slide_a", endSlideId: "slide_b" })).toEqual(["slide_a", "slide_b"]);
    expect(resolveFocusedPracticeSlideIds(deck, { type: "opening", scopeId: "opening" })).toEqual(["slide_a"]);
    expect(resolveFocusedPracticeSlideIds(deck, { type: "closing", scopeId: "closing" })).toEqual(["slide_c"]);
  });

  it("shows the indexed sentence and keeps real range transition times", () => {
    const sentenceTarget = { type: "sentence" as const, scopeId: "sentence", slideId: "slide_a", sentenceIndex: 1, textSnapshotHash: "a".repeat(64) };
    expect(resolveFocusedPracticeSentence(deck, sentenceTarget)).toBe("둘째 문장");
    expect(buildFocusedPracticeTimeline(
      { type: "slide-range", scopeId: "range", startSlideId: "slide_a", endSlideId: "slide_b" },
      ["slide_a", "slide_b"],
      12_000,
      [{ slideId: "slide_a", enteredAtMs: 0 }, { slideId: "slide_b", enteredAtMs: 5_000 }],
    )).toEqual([
      { slideId: "slide_a", enteredAtMs: 0, exitedAtMs: 5_000 },
      { slideId: "slide_b", enteredAtMs: 5_000, exitedAtMs: 12_000 },
    ]);
  });

  it.each([
    {
      name: "sentence",
      target: { type: "sentence" as const, scopeId: "sentence", slideId: "slide_a", sentenceIndex: 0, textSnapshotHash: "a".repeat(64) },
      expected: { seconds: 30, targetLabel: "문장 기준" },
    },
    {
      name: "slide",
      target: { type: "slide" as const, scopeId: "slide", slideId: "slide_b" },
      expected: { seconds: 36, targetLabel: "장표 기준" },
    },
    {
      name: "slide-range",
      target: { type: "slide-range" as const, scopeId: "range", startSlideId: "slide_a", endSlideId: "slide_b" },
      expected: { seconds: 60, targetLabel: "연속 장표 기준" },
    },
    {
      name: "opening",
      target: { type: "opening" as const, scopeId: "opening" },
      expected: { seconds: 45, targetLabel: "도입부 기준" },
    },
    {
      name: "closing",
      target: { type: "closing" as const, scopeId: "closing" },
      expected: { seconds: 30, targetLabel: "마무리 기준" },
    },
  ])("fixes the $name target duration guidance in the 30-60 second range", ({ target, expected }) => {
    const durationDeck = deckSchema.parse({
      ...deck,
      slides: deck.slides.map((slide, index) => ({
        ...slide,
        estimatedSeconds: index === 0 ? 45 : undefined,
        speakerNotes: index === 1 ? "가".repeat(126) : slide.speakerNotes,
        aiNotes: index === 0 ? {
          timingPlan: {
            targetSecondsPerSlide: 60,
            targetSeconds: 50,
            targetSpokenSeconds: 45,
            targetSpeakerNotesChars: 0,
            actualSpeakerNotesChars: 0,
          },
        } : undefined,
      })),
    });

    expect(resolveFocusedPracticeDurationGuidance(durationDeck, target)).toEqual(expected);
  });
});
