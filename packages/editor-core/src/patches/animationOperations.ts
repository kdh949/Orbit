import type { Deck, DeckAnimation, DeckPatch, Slide } from "@orbit/shared/deck";

import {
  createAnimationTimeline,
  getAnimationTimelineRoot
} from "../playback/animationTimeline";

export type SlideAnimationOrderDiagnostic = {
  animationIds: string[];
  order: number;
};

export type SlideAnimationDanglingTargetDiagnostic = {
  animationId: string;
  elementId: string;
};

export type SlideAnimationDiagnostics = {
  danglingAnimations: SlideAnimationDanglingTargetDiagnostic[];
  duplicateOrders: SlideAnimationOrderDiagnostic[];
  selectedElementEmpty: boolean;
};

export function createAddAnimationPatch(
  deck: Deck,
  slideId: string,
  animation: DeckAnimation
): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "add_animation",
        slideId,
        animation: {
          ...animation,
          startMode: animation.startMode ?? "on-click"
        }
      }
    ]
  };
}

export function createUpdateAnimationPatch(
  deck: Deck,
  slideId: string,
  animationId: string,
  animation: Partial<DeckAnimation>
): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "update_animation",
        slideId,
        animationId,
        animation
      }
    ]
  };
}

export function createDeleteAnimationPatch(
  deck: Deck,
  slideId: string,
  animationId: string
): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "delete_animation",
        slideId,
        animationId
      }
    ]
  };
}

export function createDeleteAnimationTimelineRootPatch(
  deck: Deck,
  slideId: string,
  animationId: string
): DeckPatch {
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  if (!slide) {
    return createDeleteAnimationPatch(deck, slideId, animationId);
  }

  const actionAnimationIds = slide.actions.flatMap((action) =>
    action.effect.kind === "play-animation"
      ? [action.effect.animationId]
      : []
  );
  const timelineRoot = getAnimationTimelineRoot(
    createAnimationTimeline({
      animations: slide.animations,
      legacyOnClickAnimationIds: actionAnimationIds
    }),
    animationId
  );
  const animationIds = timelineRoot
    ? timelineRoot.effects.map((effect) => effect.animationId)
    : [animationId];
  const animationIdSet = new Set(animationIds);
  const actionIds = slide.actions.flatMap((action) =>
    action.effect.kind === "play-animation" &&
    animationIdSet.has(action.effect.animationId)
      ? [action.actionId]
      : []
  );

  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      ...actionIds.map((actionId) => ({
        type: "delete_slide_action" as const,
        slideId,
        actionId
      })),
      ...animationIds.map((candidateAnimationId) => ({
        type: "delete_animation" as const,
        slideId,
        animationId: candidateAnimationId
      }))
    ]
  };
}

export function createAnimationId(deck: Deck) {
  const existingIds = new Set(
    deck.slides.flatMap((slide) =>
      slide.animations.map((animation) => animation.animationId)
    )
  );

  for (let index = 1; index <= 9999; index += 1) {
    const candidate = `anim_${index}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return `anim_${Date.now()}`;
}

export function createDefaultAnimation(
  deck: Deck,
  slide: Slide,
  elementId: string
): DeckAnimation {
  return {
    animationId: createAnimationId(deck),
    elementId,
    type: "fade-in",
    order: getNextAnimationOrder(slide),
    startMode: "on-click",
    durationMs: 400,
    delayMs: 0,
    easing: "ease-out"
  };
}

export function getElementAnimations(slide: Slide, elementId: string) {
  return slide.animations
    .filter((animation) => animation.elementId === elementId)
    .sort(compareAnimations);
}

export function getNextAnimationOrder(slide: Slide) {
  return (
    slide.animations.reduce(
      (maxOrder, animation) => Math.max(maxOrder, animation.order),
      0
    ) + 1
  );
}

export function validateSlideAnimations(
  slide: Slide,
  selectedElementId?: string
): SlideAnimationDiagnostics {
  const orderGroups = new Map<number, string[]>();
  const elementIds = new Set(slide.elements.map((element) => element.elementId));

  for (const animation of slide.animations) {
    const group = orderGroups.get(animation.order) ?? [];
    group.push(animation.animationId);
    orderGroups.set(animation.order, group);
  }

  return {
    danglingAnimations: slide.animations
      .filter((animation) => !elementIds.has(animation.elementId))
      .map((animation) => ({
        animationId: animation.animationId,
        elementId: animation.elementId
      })),
    duplicateOrders: [...orderGroups.entries()]
      .filter(([, animationIds]) => animationIds.length > 1)
      .map(([order, animationIds]) => ({
        animationIds: [...animationIds].sort(),
        order
      }))
      .sort((left, right) => left.order - right.order),
    selectedElementEmpty: selectedElementId
      ? getElementAnimations(slide, selectedElementId).length === 0
      : false
  };
}

function compareAnimations(left: DeckAnimation, right: DeckAnimation) {
  if (left.order !== right.order) {
    return left.order - right.order;
  }

  if (left.delayMs !== right.delayMs) {
    return left.delayMs - right.delayMs;
  }

  return left.animationId.localeCompare(right.animationId);
}
