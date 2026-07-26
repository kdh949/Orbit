import { createDemoDeck } from "@orbit/editor-core";
import { describe, expect, it } from "vitest";

import {
  buildSlideRailItems,
  getSlideRailKeyboardTargetSlideId,
  getSlideRailTitle,
  resolveSelectedSlideId,
  resolveSelectedSlideIdAfterDelete,
} from "./slideRailModel";

describe("slideRailModel", () => {
  const sourceSlide = createDemoDeck().slides[0]!;
  const slides = Array.from({ length: 3 }, (_, index) => ({
    ...sourceSlide,
    slideId: `slide_${index + 1}`,
    title: index === 1 ? "   " : `제목 ${index + 1}`,
  }));

  it("tracks selection by slideId and falls back to the first slide", () => {
    expect(resolveSelectedSlideId(slides, "slide_2")).toBe("slide_2");
    expect(resolveSelectedSlideId(slides, "missing")).toBe("slide_1");
    expect(buildSlideRailItems(slides, "slide_2").filter((item) => item.isSelected)).toEqual([
      expect.objectContaining({ slideId: "slide_2" }),
    ]);
  });

  it("selects the original next slide, then the previous slide after deletion", () => {
    expect(
      resolveSelectedSlideIdAfterDelete({
        deletedSlideId: "slide_2",
        selectedSlideId: "slide_2",
        slides,
      }),
    ).toBe("slide_3");
    expect(
      resolveSelectedSlideIdAfterDelete({
        deletedSlideId: "slide_3",
        selectedSlideId: "slide_3",
        slides,
      }),
    ).toBe("slide_2");
    expect(
      resolveSelectedSlideIdAfterDelete({
        deletedSlideId: "slide_2",
        selectedSlideId: "slide_1",
        slides,
      }),
    ).toBe("slide_1");
  });

  it("uses a stable Korean title fallback", () => {
    expect(getSlideRailTitle(slides[1]!, 1)).toBe("슬라이드 2");
  });

  it("navigates by arrow and boundary keys without wrapping", () => {
    const items = buildSlideRailItems(slides, "slide_2");
    expect(getSlideRailKeyboardTargetSlideId({ currentSlideId: "slide_2", items, key: "ArrowUp" })).toBe("slide_1");
    expect(getSlideRailKeyboardTargetSlideId({ currentSlideId: "slide_2", items, key: "ArrowDown" })).toBe("slide_3");
    expect(getSlideRailKeyboardTargetSlideId({ currentSlideId: "slide_2", items, key: "Home" })).toBe("slide_1");
    expect(getSlideRailKeyboardTargetSlideId({ currentSlideId: "slide_2", items, key: "End" })).toBe("slide_3");
    expect(getSlideRailKeyboardTargetSlideId({ currentSlideId: "slide_1", items, key: "ArrowUp" })).toBe("slide_1");
  });
});
