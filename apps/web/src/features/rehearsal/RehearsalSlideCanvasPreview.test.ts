import { describe, expect, it } from "vitest";

import { calculateRehearsalSlideCanvasScale } from "./RehearsalSlideCanvasPreview";

describe("calculateRehearsalSlideCanvasScale", () => {
  it("fits a slide inside both viewport dimensions", () => {
    expect(calculateRehearsalSlideCanvasScale(320, 180, 1920, 1080)).toBeCloseTo(
      1 / 6,
    );
    expect(calculateRehearsalSlideCanvasScale(96, 76, 1920, 1080)).toBeCloseTo(
      0.05,
    );
  });

  it("does not render before the viewport has measurable dimensions", () => {
    expect(calculateRehearsalSlideCanvasScale(0, 180, 1920, 1080)).toBe(0);
    expect(calculateRehearsalSlideCanvasScale(320, 180, 0, 1080)).toBe(0);
  });
});