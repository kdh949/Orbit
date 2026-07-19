import type { Deck, DeckAnimation, Slide } from "@orbit/shared";

const genericExportAnimationTypes = new Set<DeckAnimation["type"]>([
  "appear",
  "fade-in",
  "zoom-in"
]);

export function getTransitionMutationDisabledReason(
  deck: Deck,
  slide: Slide
): string | null {
  if (deck.metadata.sourceType !== "import") return null;
  if (!slide.ooxmlSourceSlidePart) {
    return "가져온 슬라이드의 안정적인 OOXML 위치 정보가 없어 전환을 편집할 수 없습니다.";
  }
  if (slide.ooxmlMotionCapabilities?.transitionWritable !== true) {
    return "이 슬라이드의 전환 효과는 원본 OOXML에 안전하게 저장할 수 없습니다.";
  }
  return null;
}

export function getAnimationMutationDisabledReason(
  deck: Deck,
  slide: Slide
): string | null {
  if (deck.metadata.sourceType !== "import") return null;
  if (!slide.ooxmlSourceSlidePart) {
    return "가져온 슬라이드의 안정적인 OOXML 위치 정보가 없어 애니메이션을 편집할 수 없습니다.";
  }
  const coverage =
    slide.ooxmlMotionCapabilities?.importedMainSequenceCoverage;
  if (coverage !== "absent" && coverage !== "complete") {
    return "이 슬라이드의 애니메이션 구조를 완전하게 보존할 수 없어 편집할 수 없습니다.";
  }
  return null;
}

export function getAnimationTypeMutationDisabledReason(
  type: DeckAnimation["type"]
): string | null {
  return genericExportAnimationTypes.has(type)
    ? null
    : `${type} 효과는 PPTX motion serializer에서 보존할 수 없습니다.`;
}
