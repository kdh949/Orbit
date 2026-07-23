import { deckSchema, type Deck } from "@orbit/shared";

export function projectMorphDeckForStaticExport(deck: Deck): Deck {
  return deckSchema.parse({
    ...deck,
    slides: deck.slides.map((slide) => {
      if (slide.transition?.type !== "morph") return slide;
      const { transition: _transition, ...projectedSlide } = slide;
      return projectedSlide;
    }),
  });
}
