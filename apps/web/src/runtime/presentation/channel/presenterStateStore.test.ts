import { describe, expect, it } from "vitest";
import { p0AnimationDeck } from "../slideshow/__fixtures__/animationDeck";
import {
  applyPresenterSlideshowCommand,
  createPresenterSlideshowState,
  nextStepOrSlide
} from "./presenterStateStore";

describe("presenterStateStore", () => {
  it("creates a restorable initial presenter state", () => {
    expect(createPresenterSlideshowState(p0AnimationDeck)).toMatchObject({
      audienceOutputMode: "slide",
      slideId: "slide_p0_1",
      slideIndex: 0,
      stepIndex: 0,
      highlights: []
    });
  });

  it("advances steps until the last step, then advances the slide", () => {
    const initialState = createPresenterSlideshowState(p0AnimationDeck);
    const firstStep = nextStepOrSlide({
      maxStepIndex: 2,
      slides: p0AnimationDeck.slides,
      state: initialState
    });
    const secondStep = nextStepOrSlide({
      maxStepIndex: 2,
      slides: p0AnimationDeck.slides,
      state: firstStep
    });
    const nextSlide = nextStepOrSlide({
      maxStepIndex: 2,
      slides: p0AnimationDeck.slides,
      state: secondStep
    });

    expect(firstStep).toMatchObject({ slideIndex: 0, stepIndex: 1 });
    expect(secondStep).toMatchObject({ slideIndex: 0, stepIndex: 2 });
    expect(nextSlide).toMatchObject({
      slideId: "slide_p0_2",
      slideIndex: 1,
      stepIndex: 0
    });
  });

  it("keeps the final slide step when next-step has nowhere to advance", () => {
    const state = {
      ...createPresenterSlideshowState(p0AnimationDeck),
      slideId: "slide_p0_2",
      slideIndex: p0AnimationDeck.slides.length - 1,
      stepIndex: 2
    };

    expect(
      nextStepOrSlide({
        maxStepIndex: 2,
        slides: p0AnimationDeck.slides,
        state
      })
    ).toBe(state);
  });

  it("restores previous slide at stepIndex 0", () => {
    const state = {
      ...createPresenterSlideshowState(p0AnimationDeck),
      slideId: "slide_p0_2",
      slideIndex: 1,
      stepIndex: 3
    };

    expect(
      applyPresenterSlideshowCommand(state, {
        type: "previous-slide",
        slides: p0AnimationDeck.slides
      })
    ).toMatchObject({
      slideId: "slide_p0_1",
      slideIndex: 0,
      stepIndex: 0
    });
  });

  it("updates persistent highlight state by element", () => {
    const state = createPresenterSlideshowState(p0AnimationDeck);
    const active = applyPresenterSlideshowCommand(state, {
      type: "set-highlight",
      elementId: "el_body",
      active: true
    });
    const inactive = applyPresenterSlideshowCommand(active, {
      type: "set-highlight",
      elementId: "el_body",
      active: false
    });

    expect(active.highlights).toEqual([{ elementId: "el_body", active: true }]);
    expect(inactive.highlights).toEqual([{ elementId: "el_body", active: false }]);
  });
});
