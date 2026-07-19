import type { Deck } from "@orbit/shared";

import { ReadOnlySlideCanvas } from "../../../slides/rendering/ReadOnlySlideCanvas";

export function PrintDeckView({ deck }: { deck: Deck }) {
  return (
    <section aria-label="인쇄할 슬라이드" className="editor-print-deck">
      {deck.slides.map((slide) => (
        <article className="editor-print-slide" key={slide.slideId}>
          <ReadOnlySlideCanvas deck={deck} slide={slide} />
        </article>
      ))}
    </section>
  );
}
