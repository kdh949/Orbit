import { describe, expect, it } from "vitest";
import { getNextPresenterStepState } from "./presenterStepNavigation";

describe("presenterStepNavigation", () => {
  it("advances within the current slide before moving to the next slide", () => {
    expect(
      getNextPresenterStepState({
        currentSlideIndex: 0,
        currentStepIndex: 1,
        maxStepIndex: 2,
        slideCount: 2,
      }),
    ).toEqual({
      slideIndex: 0,
      stepIndex: 2,
    });
  });

  it("resets step index only when a next slide exists", () => {
    expect(
      getNextPresenterStepState({
        currentSlideIndex: 0,
        currentStepIndex: 2,
        maxStepIndex: 2,
        slideCount: 2,
      }),
    ).toEqual({
      slideIndex: 1,
      stepIndex: 0,
    });

    expect(
      getNextPresenterStepState({
        currentSlideIndex: 1,
        currentStepIndex: 2,
        maxStepIndex: 2,
        slideCount: 2,
      }),
    ).toEqual({
      slideIndex: 1,
      stepIndex: 2,
    });
  });
});
