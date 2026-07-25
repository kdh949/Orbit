import type { Deck, DeckElement } from "@orbit/shared";

export type ImageCropActionState = {
  canResizeFrame: boolean;
  enabled: boolean;
  reason: string | null;
  resizeDisabledReason: string | null;
  visible: boolean;
};

export function getImageCropActionState(
  deck: Deck,
  element: DeckElement | null
): ImageCropActionState {
  if (element?.type !== "image") {
    return {
      canResizeFrame: false,
      enabled: false,
      reason: null,
      resizeDisabledReason: null,
      visible: false
    };
  }

  if (deck.metadata.sourceType !== "import" || element.ooxmlOrigin === "authored") {
    return {
      canResizeFrame: true,
      enabled: true,
      reason: null,
      resizeDisabledReason: null,
      visible: true
    };
  }

  const capability = element.ooxmlEditCapabilities?.crop;
  if (capability === "picture" || capability === "picture-fill") {
    const canResizeFrame = element.ooxmlEditCapabilities?.frame === true;
    return {
      canResizeFrame,
      enabled: true,
      reason: null,
      resizeDisabledReason: canResizeFrame
        ? null
        : "원본 PPTX의 이미지 크기 변경 위치를 확인할 수 없어 이동과 확대·축소만 사용할 수 있습니다.",
      visible: true
    };
  }

  return {
    canResizeFrame: false,
    enabled: false,
    reason: "이 이미지는 원본 PPTX에 안전하게 자르기를 저장할 수 없습니다.",
    resizeDisabledReason: null,
    visible: true
  };
}
