import type { Deck, DeckElement } from "@orbit/shared/deck";

export type ImageCropActionState = {
  enabled: boolean;
  reason: string | null;
  visible: boolean;
};

export function getImageCropActionState(
  deck: Deck,
  element: DeckElement | null
): ImageCropActionState {
  if (element?.type !== "image") {
    return { enabled: false, reason: null, visible: false };
  }

  if (deck.metadata.sourceType !== "import" || element.ooxmlOrigin === "authored") {
    return { enabled: true, reason: null, visible: true };
  }

  const capability = element.ooxmlEditCapabilities?.crop;
  if (capability === "picture" || capability === "picture-fill") {
    return { enabled: true, reason: null, visible: true };
  }

  return {
    enabled: false,
    reason: "이 이미지는 원본 PPTX에 안전하게 자르기를 저장할 수 없습니다.",
    visible: true
  };
}
