import type { DeckElement, Slide } from "@orbit/shared/deck";

export function getRehearsalSlideTitle(slide: Slide) {
  const title = slide.title.trim();
  if (title) {
    return title;
  }

  const titleElement = slide.elements.find(
    (element): element is Extract<DeckElement, { type: "text" }> =>
      element.type === "text" && element.role === "title",
  );
  return titleElement?.props.text || `Slide ${slide.order}`;
}

export function getRehearsalSlideBodyTexts(slide: Slide) {
  return slide.elements
    .filter(
      (element): element is Extract<DeckElement, { type: "text" }> =>
        element.type === "text" && Boolean(element.props.text.trim()),
    )
    .map((element) => element.props.text.trim())
    .filter((text) => text !== slide.title.trim());
}
