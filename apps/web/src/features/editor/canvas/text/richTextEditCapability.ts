import type { Deck, DeckElement } from "@orbit/shared/deck";

type TextElement = Extract<DeckElement, { type: "text" }>;

export type RichTextStyleActionState = {
  enabled: boolean;
  reason: string | null;
};

export function getRichTextStyleActionState(
  deck: Deck,
  element: TextElement,
): RichTextStyleActionState {
  if (
    deck.metadata.sourceType !== "import" ||
    element.ooxmlOrigin === "authored"
  ) {
    return { enabled: true, reason: null };
  }

  const capability = element.ooxmlEditCapabilities?.richText;
  if (
    element.ooxmlOrigin === "imported" &&
    (capability === "full" || capability === "style-only")
  ) {
    return { enabled: true, reason: null };
  }

  return {
    enabled: false,
    reason: "원본 OOXML 구조에서 이 편집을 안전하게 보존할 수 없습니다.",
  };
}
