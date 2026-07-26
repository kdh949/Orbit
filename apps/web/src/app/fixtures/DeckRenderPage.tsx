import { deckSchema, type Deck } from "@orbit/shared/deck";

import { ReadOnlySlideCanvas } from "../../features/slides/rendering";

export const deckRenderPayloadStorageKey = "orbit.deckRenderPayload.v1";

export function DeckRenderPage() {
  const payload = readDeckRenderPayload();
  if (!payload) {
    return (
      <div data-testid="deck-render-error">Deck render payload missing.</div>
    );
  }

  const slide = payload.deck.slides[payload.slideIndex];
  if (!slide) {
    return (
      <div data-testid="deck-render-error">Deck render slide missing.</div>
    );
  }

  return (
    <main
      aria-label="Deck render fixture"
      data-testid="deck-render-page"
      style={{ margin: 0, padding: 0 }}
    >
      <ReadOnlySlideCanvas deck={payload.deck} slide={slide} />
    </main>
  );
}

function readDeckRenderPayload(): { deck: Deck; slideIndex: number } | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(deckRenderPayloadStorageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { deck?: unknown; slideIndex?: unknown };
    const deck = deckSchema.parse(parsed.deck);
    const slideIndex =
      typeof parsed.slideIndex === "number" &&
      Number.isInteger(parsed.slideIndex)
        ? parsed.slideIndex
        : 0;
    return { deck, slideIndex };
  } catch {
    return null;
  }
}
