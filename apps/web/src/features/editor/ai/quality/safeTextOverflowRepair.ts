import { applyDeckPatch } from "@orbit/editor-core";
import type { Deck, DeckElement, DeckPatch } from "@orbit/shared";

import {
  getEditorValidationItems,
  getMinimumPresentationFontSize,
  type EditorValidationItem
} from "./editorValidation";

export type SafeTextOverflowRepairSkipReason =
  | "missing-target"
  | "not-text"
  | "locked"
  | "rich-text-unsupported"
  | "minimum-font-size"
  | "not-overflowing"
  | "overflow-remains"
  | "new-validation-risk";

export type SafeTextOverflowRepairResult = {
  patch: DeckPatch | null;
  repairedElementIds: string[];
  skipped: Array<{
    elementId: string;
    reason: SafeTextOverflowRepairSkipReason;
  }>;
};

export function createSafeTextOverflowRepair(args: {
  deck: Deck;
  items: readonly EditorValidationItem[];
  onlyElementIds?: readonly string[];
}): SafeTextOverflowRepairResult {
  const { deck } = args;
  const allowedElementIds = args.onlyElementIds
    ? new Set(args.onlyElementIds)
    : null;
  const baselineValidationKeys = new Set(
    getEditorValidationItems(deck).map(getValidationKey)
  );
  const operations: DeckPatch["operations"] = [];
  const repairedElementIds: string[] = [];
  const skipped: SafeTextOverflowRepairResult["skipped"] = [];
  const visitedTargets = new Set<string>();

  for (const item of args.items) {
    if (item.issue !== "textOverflow" || !item.elementId) continue;
    if (allowedElementIds && !allowedElementIds.has(item.elementId)) continue;

    const targetKey = `${item.slideId ?? ""}:${item.elementId}`;
    if (visitedTargets.has(targetKey)) continue;
    visitedTargets.add(targetKey);

    const slideIndex = item.slideId
      ? deck.slides.findIndex((slide) => slide.slideId === item.slideId)
      : -1;
    const slide = slideIndex >= 0 ? deck.slides[slideIndex] : null;
    if (!slide) {
      skipped.push({ elementId: item.elementId, reason: "missing-target" });
      continue;
    }

    const element = slide.elements.find(
      (candidate) => candidate.elementId === item.elementId
    );
    if (!element) {
      skipped.push({ elementId: item.elementId, reason: "missing-target" });
      continue;
    }
    if (element.type !== "text") {
      skipped.push({ elementId: item.elementId, reason: "not-text" });
      continue;
    }
    if (element.locked) {
      skipped.push({ elementId: item.elementId, reason: "locked" });
      continue;
    }
    if (hasRichTextOverrides(element)) {
      skipped.push({
        elementId: item.elementId,
        reason: "rich-text-unsupported"
      });
      continue;
    }
    if (!hasTargetOverflow(deck, slide.slideId, item.elementId)) {
      skipped.push({ elementId: item.elementId, reason: "not-overflowing" });
      continue;
    }

    const minimumFontSize = getMinimumPresentationFontSize(
      slideIndex,
      element.role
    );
    const currentFontSize = Math.floor(element.props.fontSize);
    if (currentFontSize <= minimumFontSize) {
      skipped.push({
        elementId: item.elementId,
        reason: "minimum-font-size"
      });
      continue;
    }

    const candidate = findSafeCandidate({
      baselineValidationKeys,
      deck,
      element,
      existingOperations: operations,
      minimumFontSize,
      slideId: slide.slideId
    });

    if (!candidate.operation) {
      skipped.push({
        elementId: item.elementId,
        reason: candidate.reason
      });
      continue;
    }

    operations.push(candidate.operation);
    repairedElementIds.push(item.elementId);
  }

  return {
    patch:
      operations.length > 0
        ? {
            baseVersion: deck.version,
            deckId: deck.deckId,
            operations,
            source: "ai"
          }
        : null,
    repairedElementIds,
    skipped
  };
}

function findSafeCandidate(args: {
  baselineValidationKeys: ReadonlySet<string>;
  deck: Deck;
  element: Extract<DeckElement, { type: "text" }>;
  existingOperations: DeckPatch["operations"];
  minimumFontSize: number;
  slideId: string;
}): {
  operation: Extract<
    DeckPatch["operations"][number],
    { type: "update_element_props" }
  > | null;
  reason: "overflow-remains" | "new-validation-risk";
} {
  let foundOverflowFreeCandidate = false;

  for (
    let fontSize = Math.floor(args.element.props.fontSize) - 1;
    fontSize >= args.minimumFontSize;
    fontSize -= 1
  ) {
    const operation = {
      elementId: args.element.elementId,
      props: { fontSize },
      slideId: args.slideId,
      type: "update_element_props" as const
    };
    const candidatePatch: DeckPatch = {
      baseVersion: args.deck.version,
      deckId: args.deck.deckId,
      operations: [...args.existingOperations, operation],
      source: "ai"
    };
    const candidateResult = applyDeckPatch(args.deck, candidatePatch);
    if (!candidateResult.ok) continue;

    const candidateItems = getEditorValidationItems(candidateResult.deck);
    if (hasTargetOverflow(candidateResult.deck, args.slideId, args.element.elementId)) {
      continue;
    }

    foundOverflowFreeCandidate = true;
    const hasNewValidationRisk = candidateItems.some(
      (item) => !args.baselineValidationKeys.has(getValidationKey(item))
    );
    if (!hasNewValidationRisk) {
      return { operation, reason: "overflow-remains" };
    }
  }

  return {
    operation: null,
    reason: foundOverflowFreeCandidate
      ? "new-validation-risk"
      : "overflow-remains"
  };
}

function hasTargetOverflow(deck: Deck, slideId: string, elementId: string) {
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  if (!slide) return false;
  return getEditorValidationItems(deck, slide).some(
    (item) =>
      item.issue === "textOverflow" &&
      item.slideId === slideId &&
      item.elementId === elementId
  );
}

function hasRichTextOverrides(
  element: Extract<DeckElement, { type: "text" }>
) {
  return Boolean(element.props.runs?.length || element.props.paragraphs?.length);
}

function getValidationKey(item: EditorValidationItem) {
  return [
    item.slideId ?? "",
    item.issue ?? "",
    item.severity,
    item.elementId ?? "",
    [...(item.elementIds ?? [])].sort().join(","),
    item.message
  ].join("|");
}
