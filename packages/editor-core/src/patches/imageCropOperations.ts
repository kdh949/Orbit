import type { Deck, DeckPatch, ImageElementProps } from "@orbit/shared";

import {
  normalizeElementFrameDraft,
  type ElementFrameDraft,
} from "./elementFrame";

type ImageCrop = NonNullable<ImageElementProps["crop"]>;

export type ImageCropPatchDraft = {
  frame: ElementFrameDraft;
  crop: ImageCrop;
};

export function createImageCropPatch(
  deck: Deck,
  slideId: string,
  elementId: string,
  draft: ImageCropPatchDraft,
): DeckPatch {
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  const element = slide?.elements.find(
    (candidate) => candidate.elementId === elementId,
  );

  if (!slide || !element) {
    throw new Error(`Element ${elementId} was not found in slide ${slideId}`);
  }
  if (element.type !== "image") {
    throw new Error(`Element ${elementId} is not an image`);
  }

  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "update_element_frame",
        slideId,
        elementId,
        frame: normalizeElementFrameDraft(deck.canvas, element, draft.frame),
      },
      {
        type: "update_element_props",
        slideId,
        elementId,
        props: { crop: normalizeCrop(draft.crop) },
      },
    ],
  };
}

function normalizeCrop(crop: ImageCrop): ImageCrop {
  const horizontal = normalizeAxis(crop.left, crop.right);
  const vertical = normalizeAxis(crop.top, crop.bottom);
  return {
    left: horizontal.start,
    top: vertical.start,
    right: horizontal.end,
    bottom: vertical.end,
  };
}

function normalizeAxis(startValue: number, endValue: number) {
  let start = clampFraction(startValue);
  let end = clampFraction(endValue);
  if (start + end >= 1) {
    const scale = (1 - 1e-9) / (start + end);
    start *= scale;
    end *= scale;
  }
  return { start, end };
}

function clampFraction(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
