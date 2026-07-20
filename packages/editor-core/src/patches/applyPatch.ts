import {
  deckChangeRecordSchema,
  deckPatchSchema,
  deckSchema,
} from "@orbit/shared";
import type {
  Deck,
  DeckAnimation,
  DeckElement,
  DeckPatchOperation,
  DeckSlideAction,
  Slide,
} from "@orbit/shared";

import type {
  ApplyDeckPatchError,
  ApplyDeckPatchFailure,
  ApplyDeckPatchOptions,
  ApplyDeckPatchResult,
} from "./deckPatch";
import { getRichTextSemanticText } from "../text/richTextOperations";
import {
  createAnimationTimeline,
  getAnimationTimelineRoot
} from "../playback/animationTimeline";
import { normalizeLegacyAnimationStartModes } from "./legacyAnimationStartModeMigration";

type OperationResult = { ok: true } | ApplyDeckPatchFailure;

type ElementWithProps = DeckElement & {
  props: Record<string, unknown>;
};

export function applyDeckPatch(
  deckInput: unknown,
  patchInput: unknown,
  options: ApplyDeckPatchOptions = {},
): ApplyDeckPatchResult {
  const deckResult = deckSchema.safeParse(
    normalizeLegacyAnimationStartModes(deckInput)
  );

  if (!deckResult.success) {
    return failure("DECK_VALIDATION_FAILED", "Deck input is invalid", {
      details: formatValidationError(deckResult.error),
    });
  }

  const patchResult = deckPatchSchema.safeParse(patchInput);

  if (!patchResult.success) {
    return failure("PATCH_VALIDATION_FAILED", "Deck patch is invalid", {
      details: formatValidationError(patchResult.error),
    });
  }

  const deck = cloneJson(deckResult.data);
  const patch = patchResult.data;

  if (deck.deckId !== patch.deckId) {
    return failure(
      "DECK_ID_MISMATCH",
      "Patch deckId does not match deck deckId",
      {
        details: [`deckId=${deck.deckId}`, `patch.deckId=${patch.deckId}`],
      },
    );
  }

  if (deck.version !== patch.baseVersion) {
    return failure(
      "BASE_VERSION_MISMATCH",
      "Patch baseVersion does not match current deck version",
      {
        details: [
          `deck.version=${deck.version}`,
          `patch.baseVersion=${patch.baseVersion}`,
        ],
      },
    );
  }

  const nextDeck = cloneJson(deck);

  for (const operation of patch.operations) {
    const operationResult = applyOperation(nextDeck, operation);

    if (!operationResult.ok) {
      return operationResult;
    }
  }

  nextDeck.version = deck.version + 1;

  const nextDeckResult = deckSchema.safeParse(
    normalizeLegacyAnimationStartModes(nextDeck)
  );

  if (!nextDeckResult.success) {
    return failure("DECK_VALIDATION_FAILED", "Patched deck is invalid", {
      details: formatValidationError(nextDeckResult.error),
    });
  }

  const changeRecordResult = deckChangeRecordSchema.safeParse({
    changeId:
      options.changeId ?? createDefaultChangeId(deck.deckId, nextDeck.version),
    deckId: deck.deckId,
    beforeVersion: deck.version,
    afterVersion: nextDeck.version,
    source: patch.source,
    actorUserId: options.actorUserId ?? patch.actorUserId,
    createdAt: options.createdAt ?? new Date().toISOString(),
    operations: patch.operations,
  });

  if (!changeRecordResult.success) {
    return failure(
      "CHANGE_RECORD_VALIDATION_FAILED",
      "Deck change record is invalid",
      {
        details: formatValidationError(changeRecordResult.error),
      },
    );
  }

  return {
    ok: true,
    deck: nextDeckResult.data,
    changeRecord: changeRecordResult.data,
    metadata: {
      deckId: deck.deckId,
      baseVersion: deck.version,
      nextVersion: nextDeck.version,
    },
  };
}

function applyOperation(
  deck: Deck,
  operation: DeckPatchOperation,
): OperationResult {
  switch (operation.type) {
    case "update_deck":
      if (operation.title !== undefined) {
        deck.title = operation.title;
      }

      if (operation.targetDurationMinutes !== undefined) {
        deck.targetDurationMinutes = operation.targetDurationMinutes;
      }

      if (operation.metadata !== undefined) {
        mergeRecordPatch(
          deck.metadata as unknown as Record<string, unknown>,
          operation.metadata as Record<string, unknown>,
        );
      }
      return { ok: true };

    case "add_slide":
      if (findSlide(deck, operation.slide.slideId)) {
        return failure("DUPLICATE_SLIDE_ID", "Slide already exists", {
          operationType: operation.type,
          details: [`slideId=${operation.slide.slideId}`],
        });
      }

      deck.slides.push(cloneJson(operation.slide));
      sortSlides(deck);
      return { ok: true };

    case "update_slide": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      if (operation.title !== undefined) {
        slide.title = operation.title;
      }

      if (operation.thumbnailUrl !== undefined) {
        slide.thumbnailUrl = operation.thumbnailUrl;
      }

      if (operation.estimatedSeconds === null) {
        delete slide.estimatedSeconds;
      } else if (operation.estimatedSeconds !== undefined) {
        slide.estimatedSeconds = operation.estimatedSeconds;
      }

      return { ok: true };
    }

    case "update_slide_transition": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      if (operation.transition === null) {
        delete slide.transition;
      } else {
        slide.transition = cloneJson(operation.transition);
      }
      return { ok: true };
    }

    case "delete_slide": {
      const slideIndex = deck.slides.findIndex(
        (slide) => slide.slideId === operation.slideId,
      );

      if (slideIndex < 0) {
        return slideNotFound(operation.type, operation.slideId);
      }

      if (deck.slides.length === 1) {
        return failure(
          "LAST_SLIDE_DELETE_FORBIDDEN",
          "A deck must retain at least one slide",
          {
            operationType: operation.type,
            details: [`slideId=${operation.slideId}`],
          },
        );
      }

      deck.slides.splice(slideIndex, 1);
      normalizeSlideOrders(deck);
      return { ok: true };
    }

    case "reorder_slides": {
      const validationFailure = validateSlideReorder(deck, operation.slideOrders);
      if (validationFailure) {
        return validationFailure;
      }

      for (const slideOrder of operation.slideOrders) {
        findSlide(deck, slideOrder.slideId)!.order = slideOrder.order;
      }

      sortSlides(deck);
      normalizeSlideOrders(deck);
      return { ok: true };
    }

    case "update_theme":
      mergeRecordPatch(
        deck.theme as unknown as Record<string, unknown>,
        operation.theme as Record<string, unknown>,
      );
      return { ok: true };

    case "update_slide_style": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      mergeRecordPatch(
        slide.style as unknown as Record<string, unknown>,
        operation.style as Record<string, unknown>,
      );
      if (operation.style.backgroundColor !== undefined) {
        syncCanvasBackgroundFill(
          deck,
          slide,
          slide.style.backgroundColor ?? deck.theme.backgroundColor,
        );
      }
      return { ok: true };
    }

    case "add_element": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      if (findElement(slide, operation.element.elementId)) {
        return failure("DUPLICATE_ELEMENT_ID", "Element already exists", {
          operationType: operation.type,
          details: [`elementId=${operation.element.elementId}`],
        });
      }

      slide.elements.push(cloneJson(operation.element));
      sortElements(slide);
      return { ok: true };
    }

    case "update_element_frame": {
      const elementResult = findElementByOperation(deck, operation);

      if (!elementResult.ok) {
        return elementResult;
      }

      mergeRecordPatch(
        elementResult.element as unknown as Record<string, unknown>,
        operation.frame as Record<string, unknown>,
      );
      return { ok: true };
    }

    case "update_element_props": {
      const elementResult = findElementByOperation(deck, operation);

      if (!elementResult.ok) {
        return elementResult;
      }

      const element = elementResult.element as ElementWithProps;
      const previousSemanticContent = getSemanticElementContent(element);
      mergeRecordPatch(element.props, operation.props);
      const nextSemanticContent = getSemanticElementContent(element);

      if (previousSemanticContent !== nextSemanticContent) {
        const slide = findSlide(deck, operation.slideId);
        if (slide) {
          markSemanticCuesStale(slide);
        }
      }
      return { ok: true };
    }

    case "delete_element": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      const elementIndex = slide.elements.findIndex(
        (element) => element.elementId === operation.elementId,
      );

      if (elementIndex < 0) {
        return elementNotFound(operation.type, operation.elementId);
      }

      const removedAnimationIds = slide.animations
        .filter((animation) => animation.elementId === operation.elementId)
        .map((animation) => animation.animationId);
      const removedElement = slide.elements[elementIndex];

      slide.elements.splice(elementIndex, 1);
      if (
        slide.aiNotes?.compositionPlan?.primaryFocalElementId ===
        operation.elementId
      ) {
        delete slide.aiNotes.compositionPlan.primaryFocalElementId;
      }
      slide.animations = slide.animations.filter(
        (animation) => animation.elementId !== operation.elementId,
      );
      const removedActionIds = removeActionsForAnimations(slide, removedAnimationIds);
      removeElementFromGroups(slide, operation.elementId);
      removeElementReferences(slide, operation.elementId);
      removeActionReferences(slide, removedActionIds);

      if (isSemanticContentElement(removedElement)) {
        markSemanticCuesStale(slide);
      }
      return { ok: true };
    }

    case "update_speaker_notes": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      if (slide.speakerNotes !== operation.speakerNotes) {
        slide.speakerNotes = operation.speakerNotes;
        markSemanticCuesStale(slide);
      }
      return { ok: true };
    }

    case "replace_keywords": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      slide.keywords = cloneJson(operation.keywords);
      removeActionReferences(slide, removeActionsForMissingKeywords(slide));
      return { ok: true };
    }

    case "replace_semantic_cues": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      slide.semanticCues = cloneJson(operation.semanticCues);
      return { ok: true };
    }

    case "add_animation": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      if (!findElement(slide, operation.animation.elementId)) {
        return animationTargetNotFound(
          operation.type,
          operation.animation.elementId,
        );
      }

      if (findAnimation(slide, operation.animation.animationId)) {
        return failure("DUPLICATE_ANIMATION_ID", "Animation already exists", {
          operationType: operation.type,
          details: [`animationId=${operation.animation.animationId}`],
        });
      }

      slide.animations.push({
        ...cloneJson(operation.animation),
        startMode: operation.animation.startMode ?? "on-click"
      });
      sortAnimations(slide);
      const timingFailure = validateSlideActionAnimationTimings(
        slide,
        operation.type
      );
      if (timingFailure) return timingFailure;
      return { ok: true };
    }

    case "update_animation": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      const animation = findAnimation(slide, operation.animationId);

      if (!animation) {
        return animationNotFound(operation.type, operation.animationId);
      }

      if (
        operation.animation.elementId !== undefined &&
        !findElement(slide, operation.animation.elementId)
      ) {
        return animationTargetNotFound(
          operation.type,
          operation.animation.elementId,
        );
      }

      mergeRecordPatch(
        animation as unknown as Record<string, unknown>,
        operation.animation as Record<string, unknown>,
      );
      sortAnimations(slide);
      const timingFailure = validateSlideActionAnimationTimings(
        slide,
        operation.type
      );
      if (timingFailure) return timingFailure;
      return { ok: true };
    }

    case "delete_animation": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      const animationIndex = slide.animations.findIndex(
        (animation) => animation.animationId === operation.animationId,
      );

      if (animationIndex < 0) {
        return animationNotFound(operation.type, operation.animationId);
      }

      slide.animations.splice(animationIndex, 1);
      removeActionReferences(
        slide,
        removeActionsForAnimations(slide, [operation.animationId]),
      );
      const timingFailure = validateSlideActionAnimationTimings(
        slide,
        operation.type
      );
      if (timingFailure) return timingFailure;
      return { ok: true };
    }

    case "add_slide_action": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      if (findSlideAction(slide, operation.action.actionId)) {
        return failure(
          "DUPLICATE_SLIDE_ACTION_ID",
          "Slide action already exists",
          {
            operationType: operation.type,
            details: [`actionId=${operation.action.actionId}`],
          },
        );
      }

      if (
        isKeywordBasedTrigger(operation.action.trigger) &&
        !findKeyword(slide, operation.action.trigger.keywordId)
      ) {
        return slideActionKeywordNotFound(
          operation.type,
          operation.action.trigger.keywordId,
        );
      }

      if (
        operation.action.effect.kind === "play-animation" &&
        !findAnimation(slide, operation.action.effect.animationId)
      ) {
        return slideActionAnimationNotFound(
          operation.type,
          operation.action.effect.animationId,
        );
      }

      const timingFailure = validateSlideActionAnimationTiming(
        slide,
        operation.action.effect,
        operation.type
      );
      if (timingFailure) return timingFailure;

      slide.actions.push(cloneJson(operation.action));
      return { ok: true };
    }

    case "update_slide_action": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      const action = findSlideAction(slide, operation.actionId);

      if (!action) {
        return slideActionNotFound(operation.type, operation.actionId);
      }

      if (operation.action.trigger) {
        if (
          isKeywordBasedTrigger(operation.action.trigger) &&
          !findKeyword(slide, operation.action.trigger.keywordId)
        ) {
          return slideActionKeywordNotFound(
            operation.type,
            operation.action.trigger.keywordId,
          );
        }

        action.trigger = cloneJson(operation.action.trigger);
      }

      if (operation.action.effect) {
        if (
          operation.action.effect.kind === "play-animation" &&
          !findAnimation(slide, operation.action.effect.animationId)
        ) {
          return slideActionAnimationNotFound(
            operation.type,
            operation.action.effect.animationId,
          );
        }

        const timingFailure = validateSlideActionAnimationTiming(
          slide,
          operation.action.effect,
          operation.type
        );
        if (timingFailure) return timingFailure;

        action.effect = cloneJson(operation.action.effect);
      }

      return { ok: true };
    }

    case "delete_slide_action": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      const actionIndex = slide.actions.findIndex(
        (action) => action.actionId === operation.actionId,
      );

      if (actionIndex < 0) {
        return slideActionNotFound(operation.type, operation.actionId);
      }

      slide.actions.splice(actionIndex, 1);
      removeActionReferences(slide, [operation.actionId]);
      return { ok: true };
    }

    case "update_activity_definition": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      if (slide.kind !== "activity") {
        return failure(
          "SLIDE_KIND_MISMATCH",
          "Activity definition can only be updated on an Activity slide",
          {
            operationType: operation.type,
            details: [`slideId=${operation.slideId}`, `kind=${slide.kind}`],
          },
        );
      }

      slide.activity = cloneJson(operation.activity);
      return { ok: true };
    }

    case "update_activity_result_definition": {
      const slide = findSlide(deck, operation.slideId);

      if (!slide) {
        return slideNotFound(operation.type, operation.slideId);
      }

      if (slide.kind !== "activity-results") {
        return failure(
          "SLIDE_KIND_MISMATCH",
          "Activity result definition can only be updated on an Activity result slide",
          {
            operationType: operation.type,
            details: [`slideId=${operation.slideId}`, `kind=${slide.kind}`],
          },
        );
      }

      slide.activityResult = cloneJson(operation.activityResult);
      return { ok: true };
    }

    default:
      return unsupportedOperation(operation);
  }
}

function findElementByOperation(
  deck: Deck,
  operation: Extract<
    DeckPatchOperation,
    { type: "update_element_frame" | "update_element_props" }
  >,
): { ok: true; element: DeckElement } | ApplyDeckPatchFailure {
  const slide = findSlide(deck, operation.slideId);

  if (!slide) {
    return slideNotFound(operation.type, operation.slideId);
  }

  const element = findElement(slide, operation.elementId);

  if (!element) {
    return elementNotFound(operation.type, operation.elementId);
  }

  return { ok: true, element };
}

function findSlide(deck: Deck, slideId: string): Slide | undefined {
  return deck.slides.find((slide) => slide.slideId === slideId);
}

function findElement(slide: Slide, elementId: string): DeckElement | undefined {
  return slide.elements.find((element) => element.elementId === elementId);
}

function findAnimation(
  slide: Slide,
  animationId: string,
): DeckAnimation | undefined {
  return slide.animations.find(
    (animation) => animation.animationId === animationId,
  );
}

function findSlideAction(
  slide: Slide,
  actionId: string,
): DeckSlideAction | undefined {
  return slide.actions.find((action) => action.actionId === actionId);
}

function validateSlideActionAnimationTiming(
  slide: Slide,
  effect: DeckSlideAction["effect"],
  operationType: string
): ApplyDeckPatchFailure | null {
  if (effect.kind !== "play-animation") return null;
  const timeline = createAnimationTimeline({
    animations: slide.animations,
    legacyOnClickAnimationIds: [effect.animationId]
  });
  const root = getAnimationTimelineRoot(timeline, effect.animationId);
  if (root?.kind === "click") return null;

  return failure(
    "SLIDE_ACTION_ANIMATION_TIMING_INCOMPATIBLE",
    "Slide action can only target an on-click animation chain",
    {
      operationType,
      details: [`animationId=${effect.animationId}`]
    }
  );
}

function validateSlideActionAnimationTimings(
  slide: Slide,
  operationType: string
): ApplyDeckPatchFailure | null {
  for (const action of slide.actions) {
    const timingFailure = validateSlideActionAnimationTiming(
      slide,
      action.effect,
      operationType
    );
    if (timingFailure) return timingFailure;
  }
  return null;
}

function findKeyword(slide: Slide, keywordId: string) {
  return slide.keywords.find((keyword) => keyword.keywordId === keywordId);
}

function removeElementFromGroups(slide: Slide, elementId: string): void {
  for (const element of slide.elements) {
    if (element.type !== "group") {
      continue;
    }

    element.props.childElementIds = element.props.childElementIds.filter(
      (childElementId) => childElementId !== elementId,
    );
  }
}

function removeActionsForAnimations(
  slide: Slide,
  animationIds: string[],
): string[] {
  if (animationIds.length === 0) {
    return [];
  }

  const animationIdSet = new Set(animationIds);
  const removedActionIds: string[] = [];
  slide.actions = slide.actions.filter((action) => {
    const removed =
      action.effect.kind === "play-animation" &&
      animationIdSet.has(action.effect.animationId);
    if (removed) {
      removedActionIds.push(action.actionId);
    }
    return !removed;
  });
  return removedActionIds;
}

function removeActionsForMissingKeywords(slide: Slide): string[] {
  const keywordIds = new Set(slide.keywords.map((keyword) => keyword.keywordId));

  const removedActionIds: string[] = [];
  slide.actions = slide.actions.filter((action) => {
    const removed =
      isKeywordBasedTrigger(action.trigger) &&
      !keywordIds.has(action.trigger.keywordId);
    if (removed) {
      removedActionIds.push(action.actionId);
    }
    return !removed;
  });
  return removedActionIds;
}

function markSemanticCuesStale(slide: Slide): void {
  for (const cue of slide.semanticCues) {
    cue.freshness = "stale";
  }
}

function removeElementReferences(slide: Slide, elementId: string): void {
  for (const cue of slide.semanticCues) {
    const nextTargetElementIds = cue.targetElementIds.filter(
      (targetElementId) => targetElementId !== elementId,
    );
    const nextSourceRefs = cue.sourceRefs.filter(
      (sourceRef) =>
        sourceRef.refId !== elementId ||
        !isElementSourceRefKind(sourceRef.kind),
    );

    if (
      nextTargetElementIds.length !== cue.targetElementIds.length ||
      nextSourceRefs.length !== cue.sourceRefs.length
    ) {
      cue.targetElementIds = nextTargetElementIds;
      cue.sourceRefs = nextSourceRefs;
      cue.freshness = "stale";
    }
  }
}

function removeActionReferences(slide: Slide, actionIds: string[]): void {
  if (actionIds.length === 0) {
    return;
  }

  const actionIdSet = new Set(actionIds);
  for (const cue of slide.semanticCues) {
    const nextTriggerActionIds = cue.triggerActionIds.filter(
      (actionId) => !actionIdSet.has(actionId),
    );
    if (nextTriggerActionIds.length !== cue.triggerActionIds.length) {
      cue.triggerActionIds = nextTriggerActionIds;
      cue.freshness = "stale";
    }
  }
}

function isSemanticContentElement(element: DeckElement): boolean {
  return (
    element.type === "text" ||
    element.type === "table" ||
    element.type === "chart"
  );
}

function isElementSourceRefKind(
  kind: Slide["semanticCues"][number]["sourceRefs"][number]["kind"],
): boolean {
  return (
    kind === "element" ||
    kind === "table" ||
    kind === "chart" ||
    kind === "image-analysis"
  );
}

function getSemanticElementContent(element: DeckElement): string | null {
  switch (element.type) {
    case "text":
      return getRichTextSemanticText(element.props);
    case "table":
      return JSON.stringify(
        element.props.rows.map((row) => row.map((cell) => cell.text)),
      );
    case "chart":
      return JSON.stringify({
        type: element.props.type,
        title: element.props.title,
        data: element.props.data,
        xAxisTitle: element.props.style.xAxisTitle,
        yAxisTitle: element.props.style.yAxisTitle,
        unit: element.props.style.unit,
      });
    default:
      return null;
  }
}

function isKeywordBasedTrigger(
  trigger: DeckSlideAction["trigger"],
): trigger is Extract<
  DeckSlideAction["trigger"],
  { kind: "keyword" | "keyword-occurrence" }
> {
  return trigger.kind === "keyword" || trigger.kind === "keyword-occurrence";
}

function sortSlides(deck: Deck): void {
  deck.slides.sort((a, b) => a.order - b.order);
}

function normalizeSlideOrders(deck: Deck): void {
  sortSlides(deck);
  deck.slides.forEach((slide, index) => {
    slide.order = index + 1;
  });
}

function validateSlideReorder(
  deck: Deck,
  slideOrders: Array<{ slideId: string; order: number }>,
): ApplyDeckPatchFailure | null {
  const currentSlideIds = deck.slides.map((slide) => slide.slideId);
  const requestedSlideIds = slideOrders.map((slideOrder) => slideOrder.slideId);
  const requestedOrders = slideOrders.map((slideOrder) => slideOrder.order);
  const currentSlideIdSet = new Set(currentSlideIds);
  const requestedSlideIdSet = new Set(requestedSlideIds);
  const requestedOrderSet = new Set(requestedOrders);
  const expectedOrders = new Set(deck.slides.map((_, index) => index + 1));
  const hasExactSlidePermutation =
    currentSlideIdSet.size === currentSlideIds.length &&
    requestedSlideIds.length === currentSlideIds.length &&
    requestedSlideIdSet.size === requestedSlideIds.length &&
    requestedSlideIds.every((slideId) => currentSlideIdSet.has(slideId));
  const hasExactOrderPermutation =
    requestedOrders.length === deck.slides.length &&
    requestedOrderSet.size === requestedOrders.length &&
    requestedOrders.every((order) => expectedOrders.has(order));

  if (hasExactSlidePermutation && hasExactOrderPermutation) {
    return null;
  }

  return failure(
    "INVALID_SLIDE_REORDER",
    "Slide reorder must contain exact slide ID and order permutations",
    {
      operationType: "reorder_slides",
      details: [
        `expectedSlideIds=${currentSlideIds.join(",")}`,
        `requestedSlideIds=${requestedSlideIds.join(",")}`,
        `requestedOrders=${requestedOrders.join(",")}`,
      ],
    },
  );
}

function sortElements(slide: Slide): void {
  slide.elements.sort((a, b) => a.zIndex - b.zIndex);
}

function sortAnimations(slide: Slide): void {
  slide.animations.sort((a, b) => a.order - b.order);
}

function syncCanvasBackgroundFill(
  deck: Deck,
  slide: Slide,
  backgroundColor: string,
): void {
  for (const element of slide.elements) {
    if (
      element.type !== "rect" ||
      element.role !== "background" ||
      element.x > 0 ||
      element.y > 0 ||
      element.width < deck.canvas.width ||
      element.height < deck.canvas.height
    ) {
      continue;
    }

    element.props.fill = backgroundColor;
  }
}

function mergeRecordPatch(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    if (value === null) {
      delete target[key];
      continue;
    }

    if (isPlainRecord(target[key]) && isPlainRecord(value)) {
      mergeRecordPatch(target[key], value);
      continue;
    }

    target[key] = cloneJson(value);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createDefaultChangeId(deckId: string, nextVersion: number): string {
  return `change_${deckId}_${nextVersion}`;
}

function slideNotFound(
  operationType: string,
  slideId: string,
): ApplyDeckPatchFailure {
  return failure("SLIDE_NOT_FOUND", "Slide was not found", {
    operationType,
    details: [`slideId=${slideId}`],
  });
}

function elementNotFound(
  operationType: string,
  elementId: string,
): ApplyDeckPatchFailure {
  return failure("ELEMENT_NOT_FOUND", "Element was not found", {
    operationType,
    details: [`elementId=${elementId}`],
  });
}

function animationNotFound(
  operationType: string,
  animationId: string,
): ApplyDeckPatchFailure {
  return failure("ANIMATION_NOT_FOUND", "Animation was not found", {
    operationType,
    details: [`animationId=${animationId}`],
  });
}

function animationTargetNotFound(
  operationType: string,
  elementId: string,
): ApplyDeckPatchFailure {
  return failure(
    "ANIMATION_TARGET_NOT_FOUND",
    "Animation target was not found",
    {
      operationType,
      details: [`elementId=${elementId}`],
    },
  );
}

function slideActionNotFound(
  operationType: string,
  actionId: string,
): ApplyDeckPatchFailure {
  return failure("SLIDE_ACTION_NOT_FOUND", "Slide action was not found", {
    operationType,
    details: [`actionId=${actionId}`],
  });
}

function slideActionAnimationNotFound(
  operationType: string,
  animationId: string,
): ApplyDeckPatchFailure {
  return failure(
    "SLIDE_ACTION_ANIMATION_NOT_FOUND",
    "Slide action animation target was not found",
    {
      operationType,
      details: [`animationId=${animationId}`],
    },
  );
}

function unsupportedOperation(operation: unknown): OperationResult {
  const operationType =
    typeof operation === "object" && operation !== null && "type" in operation
      ? String(operation.type)
      : "unknown";

  return failure("UNSUPPORTED_OPERATION", "Patch operation is not supported", {
    operationType,
  });
}

function slideActionKeywordNotFound(
  operationType: string,
  keywordId: string,
): ApplyDeckPatchFailure {
  return failure(
    "SLIDE_ACTION_KEYWORD_NOT_FOUND",
    "Slide action keyword target was not found",
    {
      operationType,
      details: [`keywordId=${keywordId}`],
    },
  );
}

function failure(
  code: ApplyDeckPatchError["code"],
  message: string,
  options: Omit<ApplyDeckPatchError, "code" | "message"> = {},
): ApplyDeckPatchFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      ...options,
    },
  };
}

function formatValidationError(error: unknown): string[] {
  if (typeof error !== "object" || error === null || !("issues" in error)) {
    return [String(error)];
  }

  const issues = (
    error as { issues?: Array<{ path: unknown[]; message: string }> }
  ).issues;

  if (!Array.isArray(issues)) {
    return [String(error)];
  }

  return issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
