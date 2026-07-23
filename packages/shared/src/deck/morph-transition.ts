import type { Deck, DeckSourceType, Slide } from "./deck.schema";

export const morphTransitionDefaultDurationMs = 1000;
export const morphTransitionMinDurationMs = 100;
export const morphTransitionMaxDurationMs = 3000;

export type MorphTransitionUnsupportedReason =
  | "imported-deck"
  | "first-slide"
  | "unsupported-slide-kind"
  | "snapshot-slide";

export type MorphTransitionSupport =
  | { supported: true }
  | {
      supported: false;
      reason: MorphTransitionUnsupportedReason;
      message: string;
    };

type MorphTransitionSupportInput = {
  sourceType?: DeckSourceType;
  previousSlide?: Slide;
  destinationSlide: Slide;
};

export function evaluateMorphTransitionSupport({
  sourceType,
  previousSlide,
  destinationSlide
}: MorphTransitionSupportInput): MorphTransitionSupport {
  if (sourceType === "import") {
    return {
      supported: false,
      reason: "imported-deck",
      message:
        "PPTX 호환이 지원되기 전에는 가져온 자료에서 모핑을 편집할 수 없습니다."
    };
  }

  if (!previousSlide) {
    return {
      supported: false,
      reason: "first-slide",
      message: "첫 슬라이드에는 이전 슬라이드가 없어 모핑을 적용할 수 없습니다."
    };
  }

  if (
    previousSlide.kind !== "content" ||
    destinationSlide.kind !== "content"
  ) {
    return {
      supported: false,
      reason: "unsupported-slide-kind",
      message: "일반 콘텐츠 슬라이드 사이에서만 모핑을 사용할 수 있습니다."
    };
  }

  if (
    previousSlide.importRenderMode === "snapshot" ||
    destinationSlide.importRenderMode === "snapshot"
  ) {
    return {
      supported: false,
      reason: "snapshot-slide",
      message: "스냅샷 슬라이드에는 모핑을 사용할 수 없습니다."
    };
  }

  return { supported: true };
}

export function deckHasMorphTransition(deck: Pick<Deck, "slides">): boolean {
  return deck.slides.some((slide) => slide.transition?.type === "morph");
}
