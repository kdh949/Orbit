import {
  createActivityResultsSlide,
  createActivitySlide,
  createDemoDeck
} from "@orbit/editor-core";
import { describe, expect, it } from "vitest";

import { canEditSlideCanvas } from "./slideEditingPolicy";

describe("slide editing policy", () => {
  it("allows canvas editing for content and editable Activity slides", () => {
    const deck = createDemoDeck();
    const activitySlide = createActivitySlide(deck, "poll");
    const editableActivitySlide = createActivitySlide(deck, "poll", {
      preset: "spotlight"
    });
    const resultSlide = createActivityResultsSlide(
      { ...deck, slides: [...deck.slides, activitySlide] },
      activitySlide.activity.activityId
    );

    expect(canEditSlideCanvas(deck.slides[0])).toBe(true);
    expect(canEditSlideCanvas(activitySlide)).toBe(false);
    expect(canEditSlideCanvas(editableActivitySlide)).toBe(true);
    expect(canEditSlideCanvas(resultSlide)).toBe(false);
    expect(canEditSlideCanvas(null)).toBe(false);
  });

  it("keeps legacy, editable, and hybrid content slides editable but locks snapshots", () => {
    const slide = createDemoDeck().slides[0]!;

    expect(canEditSlideCanvas(slide)).toBe(true);
    expect(canEditSlideCanvas({ ...slide, importRenderMode: "editable" })).toBe(true);
    expect(canEditSlideCanvas({ ...slide, importRenderMode: "hybrid" })).toBe(true);
    expect(canEditSlideCanvas({ ...slide, importRenderMode: "snapshot" })).toBe(false);
  });
});
