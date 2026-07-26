import {
  deckElementSchema,
  type DeckCanvas,
  type DeckElement,
  type Slide
} from "@orbit/shared";
import { normalizeElementFrameDraft } from "@orbit/editor-core/patches";

export function getRenderableSlideElements(slide: Slide, canvas: DeckCanvas) {
  if (usesSourceSlideSnapshot(slide)) {
    return [];
  }

  return [...slide.elements]
    .map((element) => normalizeRenderableElement(canvas, element))
    .sort((left, right) => left.zIndex - right.zIndex);
}

export function usesSourceSlideSnapshot(slide: Slide) {
  return slide.importRenderMode === "snapshot";
}

export function normalizeRenderableElement(
  canvas: DeckCanvas,
  element: unknown
): DeckElement {
  const elementDraft = element as DeckElement;
  const frame = normalizeElementFrameDraft(canvas, elementDraft, {});

  return deckElementSchema.parse({
    ...elementDraft,
    role: frame.role ?? undefined,
    x: frame.x ?? elementDraft.x,
    y: frame.y ?? elementDraft.y,
    width: frame.width ?? elementDraft.width,
    height: frame.height ?? elementDraft.height,
    rotation: frame.rotation ?? elementDraft.rotation,
    opacity: frame.opacity ?? elementDraft.opacity,
    zIndex: frame.zIndex ?? elementDraft.zIndex,
    locked: frame.locked ?? elementDraft.locked,
    visible: frame.visible ?? elementDraft.visible
  });
}
