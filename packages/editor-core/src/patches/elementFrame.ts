import { deckElementCoordinateLimit } from "@orbit/shared";
import type {
  Deck,
  DeckCanvas,
  DeckElement,
  DeckPatch,
  ElementFramePatch
} from "@orbit/shared";

const minimumElementSize = 1;

export type ElementFrameDraft = Partial<
  Pick<
    DeckElement,
    | "x"
    | "y"
    | "width"
    | "height"
    | "rotation"
    | "opacity"
    | "zIndex"
    | "locked"
    | "visible"
  >
> & {
  role?: DeckElement["role"] | null;
};

export function normalizeElementFrameDraft(
  _canvas: DeckCanvas,
  currentElement: DeckElement,
  draft: ElementFrameDraft
): ElementFramePatch {
  return {
    role: Object.prototype.hasOwnProperty.call(draft, "role")
      ? draft.role
      : currentElement.role,
    x: normalizeCoordinate(draft.x ?? currentElement.x, currentElement.x),
    y: normalizeCoordinate(draft.y ?? currentElement.y, currentElement.y),
    width: clampSize(draft.width ?? currentElement.width),
    height: clampSize(draft.height ?? currentElement.height),
    rotation: normalizeRotation(draft.rotation ?? currentElement.rotation),
    opacity: clampOpacity(draft.opacity ?? currentElement.opacity),
    zIndex: clampZIndex(draft.zIndex ?? currentElement.zIndex),
    locked: draft.locked ?? currentElement.locked,
    visible: draft.visible ?? currentElement.visible
  };
}

export function createElementFramePatch(
  deck: Deck,
  slideId: string,
  elementId: string,
  frame: ElementFrameDraft
): DeckPatch {
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  const element = slide?.elements.find(
    (candidate) => candidate.elementId === elementId
  );

  if (!slide || !element) {
    throw new Error(`Element ${elementId} was not found in slide ${slideId}`);
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
        frame: normalizeElementFrameDraft(deck.canvas, element, frame)
      }
    ]
  };
}

function normalizeCoordinate(value: number, fallback: number) {
  const safeFallback = Number.isFinite(fallback) ? fallback : 0;
  const coordinate = Number.isFinite(value) ? value : safeFallback;
  return Math.max(
    -deckElementCoordinateLimit,
    Math.min(deckElementCoordinateLimit, coordinate)
  );
}

function clampSize(value: number) {
  return Math.max(minimumElementSize, Number.isFinite(value) ? value : minimumElementSize);
}

function clampOpacity(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function clampZIndex(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function normalizeRotation(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const remainder = value % 360;
  return remainder < 0 ? remainder + 360 : remainder;
}
