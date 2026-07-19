import type { Deck, DeckElement, Slide } from "@orbit/shared";

import type { EditorValidationItem } from "./editorValidation";

export type EditorValidationTargetView = {
  elementIds: string[];
  label: string;
  slideId: string | null;
  status: "resolved" | "partial" | "missing";
};

export type EditorValidationPresentationItem = {
  item: EditorValidationItem;
  recoveryInstruction: string | null;
  target: EditorValidationTargetView | null;
};

export function presentEditorValidationItems(
  deck: Deck,
  items: readonly EditorValidationItem[]
): EditorValidationPresentationItem[] {
  return items.map((item) => ({
    item,
    recoveryInstruction: getValidationRecoveryInstruction(item.issue),
    target: presentValidationTarget(deck, item)
  }));
}

function presentValidationTarget(
  deck: Deck,
  item: EditorValidationItem
): EditorValidationTargetView | null {
  const requestedElementIds = getRequestedElementIds(item);
  if (!item.slideId && requestedElementIds.length === 0) {
    return null;
  }

  const slide = resolveTargetSlide(deck, item.slideId, requestedElementIds);
  if (!slide) {
    return missingTarget();
  }

  const slideNumber = deck.slides.findIndex(
    (candidate) => candidate.slideId === slide.slideId
  ) + 1;
  const resolvedElements = requestedElementIds.flatMap((elementId) => {
    const element = slide.elements.find((candidate) => candidate.elementId === elementId);
    return element ? [element] : [];
  });
  const resolvedElementIds = resolvedElements.map((element) => element.elementId);

  if (requestedElementIds.length > 0 && resolvedElements.length < requestedElementIds.length) {
    return {
      elementIds: resolvedElementIds,
      label: "대상을 찾을 수 없음",
      slideId: slide.slideId,
      status: resolvedElements.length > 0 ? "partial" : "missing"
    };
  }

  const elementLabel = resolvedElements.map(getElementLabel).join(", ");
  return {
    elementIds: resolvedElementIds,
    label: elementLabel
      ? `${slideNumber}번 슬라이드 · ${elementLabel}`
      : `${slideNumber}번 슬라이드`,
    slideId: slide.slideId,
    status: "resolved"
  };
}

function resolveTargetSlide(
  deck: Deck,
  slideId: string | undefined,
  elementIds: readonly string[]
): Slide | null {
  if (slideId) {
    return deck.slides.find((slide) => slide.slideId === slideId) ?? null;
  }

  const matches = deck.slides.filter((slide) =>
    elementIds.some((elementId) =>
      slide.elements.some((element) => element.elementId === elementId)
    )
  );
  return matches.length === 1 ? matches[0] : null;
}

function getRequestedElementIds(item: EditorValidationItem) {
  if (item.elementIds?.length) {
    return Array.from(new Set(item.elementIds));
  }
  return item.elementId ? [item.elementId] : [];
}

function missingTarget(): EditorValidationTargetView {
  return {
    elementIds: [],
    label: "대상을 찾을 수 없음",
    slideId: null,
    status: "missing"
  };
}

function getElementLabel(element: DeckElement) {
  switch (element.role) {
    case "title":
      return "제목 텍스트";
    case "subtitle":
      return "부제 텍스트";
    case "body":
      return "본문 텍스트";
    case "caption":
      return "캡션 텍스트";
    case "footer":
      return "바닥글 텍스트";
    case "highlight":
      return element.type === "text" ? "강조 텍스트" : "강조 요소";
    case "media":
      return "미디어";
    case "chart":
      return "차트";
    case "table":
      return "표";
    case "background":
      return "배경";
    case "decoration":
      return "장식 요소";
    default:
      return getElementTypeLabel(element.type);
  }
}

function getElementTypeLabel(type: DeckElement["type"]) {
  switch (type) {
    case "text":
      return "텍스트";
    case "image":
    case "svg":
      return "이미지";
    case "chart":
      return "차트";
    case "table":
      return "표";
    case "group":
      return "그룹";
    default:
      return "도형";
  }
}

function getValidationRecoveryInstruction(
  issue: EditorValidationItem["issue"]
) {
  if (issue === "textOverlap") {
    return "관련 객체를 모두 선택한 뒤 이동하거나 크기를 조정해 겹침을 해소하세요.";
  }
  if (issue === "GRID_ALIGNMENT_INCONSISTENT") {
    return "12열 그리드와 8px 간격에 맞춰 위치와 크기를 수동 조정하세요.";
  }
  return null;
}
