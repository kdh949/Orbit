export type PresenterStepState = {
  slideIndex: number;
  stepIndex: number;
};

export function getNextPresenterStepState(options: {
  currentSlideIndex: number;
  currentStepIndex: number;
  maxStepIndex: number;
  slideCount: number;
}): PresenterStepState {
  const maxSlideIndex = Math.max(0, options.slideCount - 1);
  const maxStepIndex = Math.max(0, options.maxStepIndex);
  const slideIndex = Math.min(
    Math.max(0, options.currentSlideIndex),
    maxSlideIndex,
  );
  const stepIndex = Math.min(
    Math.max(0, options.currentStepIndex),
    maxStepIndex,
  );

  if (stepIndex < maxStepIndex) {
    return {
      slideIndex,
      stepIndex: stepIndex + 1,
    };
  }

  if (slideIndex < maxSlideIndex) {
    return {
      slideIndex: slideIndex + 1,
      stepIndex: 0,
    };
  }

  return {
    slideIndex,
    stepIndex,
  };
}
