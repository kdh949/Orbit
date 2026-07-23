import { createDemoDeck } from "@orbit/editor-core";
import { describe, expect, it } from "vitest";

import {
  getAnimationMutationDisabledReason,
  getAnimationTypeMutationDisabledReason,
  getMorphTransitionMutationDisabledReason,
  getTransitionMutationDisabledReason
} from "./motionEditingPolicy";

describe("motionEditingPolicy", () => {
  it("allows generic Deck motion supported by the serializer", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;

    expect(getTransitionMutationDisabledReason(deck, slide)).toBeNull();
    expect(getAnimationMutationDisabledReason(deck, slide)).toBeNull();
    expect(getAnimationTypeMutationDisabledReason("fade-in")).toBeNull();
    expect(getAnimationTypeMutationDisabledReason("fade-out")).toContain(
      "보존할 수 없습니다"
    );
  });

  it("allows imported motion only with a stable locator and safe coverage", () => {
    const deck = createDemoDeck();
    deck.metadata.sourceType = "import";
    const slide = deck.slides[0]!;
    slide.ooxmlSourceSlidePart = "ppt/slides/slide1.xml";
    slide.ooxmlMotionCapabilities = {
      transitionWritable: true,
      importedMainSequenceCoverage: "complete"
    };

    expect(getTransitionMutationDisabledReason(deck, slide)).toBeNull();
    expect(getAnimationMutationDisabledReason(deck, slide)).toBeNull();

    slide.ooxmlMotionCapabilities.importedMainSequenceCoverage = "partial";
    expect(getAnimationMutationDisabledReason(deck, slide)).toContain(
      "완전하게 보존"
    );
  });

  it("fails closed when imported motion has no stable slide locator", () => {
    const deck = createDemoDeck();
    deck.metadata.sourceType = "import";
    const slide = deck.slides[0]!;
    slide.ooxmlMotionCapabilities = {
      transitionWritable: true,
      importedMainSequenceCoverage: "absent"
    };

    expect(getTransitionMutationDisabledReason(deck, slide)).toContain(
      "위치 정보"
    );
    expect(getAnimationMutationDisabledReason(deck, slide)).toContain(
      "위치 정보"
    );
  });

  it("allows morph only between authored content slides after the first slide", () => {
    const deck = createDemoDeck();
    const firstSlide = deck.slides[0]!;
    const secondSlide = deck.slides[1]!;

    expect(
      getMorphTransitionMutationDisabledReason(deck, secondSlide, firstSlide)
    ).toBeNull();
    expect(
      getMorphTransitionMutationDisabledReason(deck, firstSlide)
    ).toContain("첫 슬라이드");

    deck.metadata.sourceType = "import";
    expect(
      getMorphTransitionMutationDisabledReason(deck, secondSlide, firstSlide)
    ).toContain("가져온 자료");
  });
});
