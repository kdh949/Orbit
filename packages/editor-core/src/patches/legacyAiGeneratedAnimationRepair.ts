import type { Deck, DeckAnimation, Slide } from "@orbit/shared/deck";

export function removeLegacyAiGeneratedTitleAnimations(deck: Deck): Deck {
  if (deck.metadata.sourceType !== "ai" || deck.metadata.generatedBy !== "ai") {
    return deck;
  }

  let changed = false;
  const slides = deck.slides.map((slide) => {
    const referencedAnimationIds = new Set(
      slide.actions
        .filter((action) => action.effect.kind === "play-animation")
        .map((action) =>
          action.effect.kind === "play-animation" ? action.effect.animationId : ""
        )
    );
    const animations = slide.animations.filter(
      (animation) =>
        !isLegacyAiGeneratedTitleAnimation(
          slide,
          animation,
          referencedAnimationIds
        )
    );

    if (animations.length === slide.animations.length) {
      return slide;
    }

    changed = true;
    return { ...slide, animations };
  });

  return changed ? { ...deck, slides } : deck;
}

function isLegacyAiGeneratedTitleAnimation(
  slide: Slide,
  animation: DeckAnimation,
  referencedAnimationIds: Set<string>
) {
  const target = slide.elements.find(
    (element) => element.elementId === animation.elementId
  );

  return (
    target?.role === "title" &&
    animation.animationId === `anim_${slide.order}_1` &&
    animation.type === "fade-in" &&
    animation.order === 1 &&
    animation.durationMs === 400 &&
    animation.delayMs === 0 &&
    animation.easing === "ease-out" &&
    !referencedAnimationIds.has(animation.animationId)
  );
}
