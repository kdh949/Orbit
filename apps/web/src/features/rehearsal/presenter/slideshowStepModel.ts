import {
  createAnimationTimeline,
  type AnimationTimelineDiagnostic,
  type PlannedAnimationTimelineEffect
} from "@orbit/editor-core";
import type { Deck, DeckAnimation, DeckElement, Slide } from "@orbit/shared";
import type { ElementPresentationState } from "../../slides/rendering/ReadOnlySlideCanvas";
import { normalizeRenderableElement } from "../../slides/rendering/elementNormalization";

export type SlideshowModelInput = {
  slide: Slide;
  triggerAnimationIds?: Iterable<string>;
  transitionDurationMs?: number;
};

export type SlideshowStepAddress = {
  slideId: string;
  stepIndex: number;
};

export type PlannedSlideshowAnimation = PlannedAnimationTimelineEffect & {
  animationIndex: number;
  timelineStartMs: number;
  transitionDelayMs: number;
};

export type SlideshowTriggerStep = {
  animations: PlannedSlideshowAnimation[];
  durationMs: number;
  order: number;
  rootAnimationId: string;
};

export type SlideshowAnimationPlan = {
  animations: PlannedSlideshowAnimation[];
  danglingAnimationIds: string[];
  diagnostics: AnimationTimelineDiagnostic[];
  diagnosticsTruncatedCount: number;
  entryAnimations: PlannedSlideshowAnimation[];
  entryDurationMs: number;
  maxStepIndex: number;
  triggerSteps: SlideshowTriggerStep[];
};

export function createSlideshowAnimationPlan(
  input: SlideshowModelInput
): SlideshowAnimationPlan {
  const triggerAnimationIds = [...(input.triggerAnimationIds ?? [])];
  const timeline = createAnimationTimeline({
    animations: input.slide.animations,
    legacyOnClickAnimationIds: triggerAnimationIds,
    targetElementIds: input.slide.elements.map((element) => element.elementId),
    transitionDurationMs:
      input.transitionDurationMs ?? input.slide.transition?.durationMs ?? 0
  });
  const animations = timeline.effects.map(toPlannedSlideshowAnimation);
  const entryRoots = timeline.entryRoots;
  const triggerRoots = timeline.clickSteps;
  const entryAnimations = entryRoots.flatMap((root) =>
    root.effects.map(toPlannedSlideshowAnimation)
  );
  const triggerSteps = triggerRoots.map((root) => ({
    animations: root.effects.map(toPlannedSlideshowAnimation),
    durationMs: root.durationMs,
    order: root.effects[0]?.order ?? 0,
    rootAnimationId: root.rootAnimationId
  }));

  return {
    animations,
    danglingAnimationIds: timeline.effects
      .filter((animation) => !animation.hasTargetElement)
      .map((animation) => animation.animationId),
    diagnostics: timeline.diagnostics,
    diagnosticsTruncatedCount: timeline.diagnosticsTruncatedCount,
    entryAnimations,
    entryDurationMs: Math.max(0, ...entryRoots.map((root) => root.durationMs)),
    maxStepIndex: triggerSteps.length,
    triggerSteps
  };
}

export function computeSettledElementStates(args: {
  deck: Deck;
  slide: Slide;
  stepIndex: number;
  triggerAnimationIds?: Iterable<string>;
}): Record<string, ElementPresentationState> {
  const plan = createSlideshowAnimationPlan({
    slide: args.slide,
    triggerAnimationIds: args.triggerAnimationIds
  });
  const baseStates = createBaseElementStates(args.deck, args.slide);
  const states = createInitialElementStates(baseStates, plan.animations);

  // 복원 경로에서는 진입 자동 재생을 이미 끝난 상태로 취급해 창 재열기 때 반복 재생을 막는다.
  for (const animation of plan.entryAnimations) {
    applySettledAnimation(states, animation, baseStates[animation.elementId]);
  }

  plan.triggerSteps.forEach((step, stepIndex) => {
    if (stepIndex + 1 > args.stepIndex) {
      return;
    }

    for (const animation of step.animations) {
      applySettledAnimation(states, animation, baseStates[animation.elementId]);
    }
  });

  return states;
}

export function clampSlideshowStepIndex(stepIndex: number, maxStepIndex: number) {
  if (!Number.isFinite(stepIndex)) {
    return 0;
  }

  return Math.min(Math.max(0, Math.trunc(stepIndex)), Math.max(0, maxStepIndex));
}

export function createBaseElementStates(deck: Deck, slide: Slide) {
  const states: Record<string, ElementPresentationState> = {};

  for (const element of slide.elements) {
    const normalizedElement = normalizeRenderableElement(deck.canvas, element);
    states[normalizedElement.elementId] = createBaseElementState(normalizedElement);
  }

  return states;
}

function createInitialElementStates(
  baseStates: Record<string, ElementPresentationState>,
  animations: DeckAnimation[]
) {
  const states = cloneElementStates(baseStates);
  const firstAnimationsByElementId = new Map<string, DeckAnimation>();

  for (const animation of animations) {
    if (!firstAnimationsByElementId.has(animation.elementId)) {
      firstAnimationsByElementId.set(animation.elementId, animation);
    }
  }

  for (const [elementId, animation] of firstAnimationsByElementId.entries()) {
    const state = states[elementId];
    if (!state) {
      continue;
    }

    switch (animation.type) {
      case "appear":
      case "fade-in":
        state.visible = false;
        state.opacity = 0;
        break;
      case "zoom-in":
        state.visible = false;
        state.opacity = 0;
        state.scaleX = 0;
        state.scaleY = 0;
        break;
      default:
        break;
    }
  }

  return states;
}

function createBaseElementState(element: DeckElement): ElementPresentationState {
  return {
    height: element.height,
    opacity: element.opacity,
    rotation: element.rotation,
    scaleX: 1,
    scaleY: 1,
    visible: element.visible,
    width: element.width,
    x: element.x,
    y: element.y
  };
}

function applySettledAnimation(
  states: Record<string, ElementPresentationState>,
  animation: DeckAnimation,
  baseState: ElementPresentationState | undefined
) {
  const state = states[animation.elementId];

  if (!state) {
    return;
  }

  switch (animation.type) {
    case "appear":
    case "fade-in":
    case "zoom-in":
      state.visible = true;
      state.opacity = baseState?.opacity ?? 1;
      state.scaleX = 1;
      state.scaleY = 1;
      break;
    case "disappear":
    case "fade-out":
      state.visible = false;
      state.opacity = 0;
      break;
    case "zoom-out":
      state.visible = false;
      state.opacity = 0;
      state.scaleX = 0;
      state.scaleY = 0;
      break;
    case "rotate":
      state.rotation = baseState?.rotation ?? 0;
      break;
  }
}

function cloneElementStates(states: Record<string, ElementPresentationState>) {
  return Object.fromEntries(
    Object.entries(states).map(([elementId, state]) => [elementId, { ...state }])
  );
}

function toPlannedSlideshowAnimation(
  animation: PlannedAnimationTimelineEffect
): PlannedSlideshowAnimation {
  return {
    ...animation,
    animationIndex: animation.sourceIndex,
    timelineStartMs: animation.startMs,
    transitionDelayMs: animation.startMs
  };
}
