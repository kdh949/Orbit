import type { Deck, DeckElement, DeckPatch } from "@orbit/shared";

export type ReferenceTemplateUiViolation = {
  operation: DeckPatch["operations"][number]["type"];
  reason: string;
};

export function isReferenceTemplateDeck(deck: Deck | null | undefined): boolean {
  return Boolean(deck?.metadata.ooxmlReferenceTemplateSnapshot);
}

export function canEditReferenceSlotContent(
  deck: Deck,
  element: DeckElement | null | undefined,
): boolean {
  if (!isReferenceTemplateDeck(deck)) return true;
  return Boolean(
    element &&
      !element.locked &&
      ["text", "image", "table", "chart"].includes(element.type),
  );
}

export function findReferenceTemplateUiViolation(
  deck: Deck,
  patch: DeckPatch,
): ReferenceTemplateUiViolation | null {
  if (!isReferenceTemplateDeck(deck)) return null;
  for (const operation of patch.operations) {
    if (operation.type !== "update_element_props") {
      return {
        operation: operation.type,
        reason: "원본 템플릿에서는 slot 콘텐츠만 수정할 수 있습니다.",
      };
    }
    const element = deck.slides
      .find((slide) => slide.slideId === operation.slideId)
      ?.elements.find((candidate) => candidate.elementId === operation.elementId);
    if (!canEditReferenceSlotContent(deck, element)) {
      return {
        operation: operation.type,
        reason: "선택한 요소는 편집 가능한 원본 템플릿 slot이 아닙니다.",
      };
    }
    const keys = Object.keys(operation.props);
    if (
      !element ||
      !areReferenceContentKeysAllowed(element, keys) ||
      !preservesReferenceContentStructure(element, operation.props)
    ) {
      return {
        operation: operation.type,
        reason: "slot의 콘텐츠 범위를 벗어난 속성은 수정할 수 없습니다.",
      };
    }
  }
  return null;
}

function preservesReferenceContentStructure(
  element: DeckElement,
  props: Record<string, unknown>,
): boolean {
  if (element.type === "text") {
    return (
      (!("runs" in props) || sameNonTextStructure(element.props.runs, props.runs)) &&
      (!("paragraphs" in props) ||
        sameNonTextStructure(element.props.paragraphs, props.paragraphs))
    );
  }
  if (element.type === "table" && "rows" in props) {
    return sameNonTextStructure(element.props.rows, props.rows);
  }
  return true;
}

function sameNonTextStructure(current: unknown, next: unknown): boolean {
  return JSON.stringify(stripTextValues(current)) === JSON.stringify(stripTextValues(next));
}

function stripTextValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTextValues);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      key === "text" ? "__OOXML_REFERENCE_TEXT__" : stripTextValues(nested),
    ]),
  );
}

export function lockReferenceElementFrames(
  deck: Deck,
  elements: readonly DeckElement[],
): DeckElement[] {
  if (!isReferenceTemplateDeck(deck)) return [...elements];
  return elements.map((element) => ({ ...element, locked: true }));
}

function areReferenceContentKeysAllowed(
  element: DeckElement,
  keys: readonly string[],
): boolean {
  if (keys.length === 0) return false;
  if (element.type === "text") {
    return onlyKeys(keys, ["text", "runs", "paragraphs"]);
  }
  if (element.type === "image") return onlyKeys(keys, ["src", "alt"]);
  if (element.type === "table") return onlyKeys(keys, ["rows"]);
  if (element.type === "chart") return onlyKeys(keys, ["data"]);
  return false;
}

function onlyKeys(actual: readonly string[], allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return actual.every((key) => allowedSet.has(key));
}
