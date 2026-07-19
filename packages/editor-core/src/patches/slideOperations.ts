import { deriveKeywordOccurrences, slideSchema } from "@orbit/shared";
import type {
  Deck,
  DeckPatch,
  SemanticCueSourceRef,
  Slide,
  SlideTransition,
} from "@orbit/shared";

type LocalIdPrefix = "slide_" | "el_" | "anim_" | "kw_" | "act_" | "scue_";

type LocalIdAllocator = (prefix: LocalIdPrefix) => string;

export function createSlideId(deck: Deck) {
  const existingIds = new Set(deck.slides.map((slide) => slide.slideId));

  for (let index = 1; index <= 9999; index += 1) {
    const candidate = `slide_${index}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return `slide_${Date.now()}`;
}

export function createAddSlidePatch(
  deck: Deck,
  slide: Slide
): DeckPatch {
  const nextSlide =
    deck.metadata.sourceType === "import" ? asAuthoredOoxmlSlide(slide) : slide;
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "add_slide",
        slide: nextSlide
      }
    ]
  };
}

export function createUpdateSlideTransitionPatch(
  deck: Deck,
  slideId: string,
  transition: SlideTransition | null
): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "update_slide_transition",
        slideId,
        transition
      }
    ]
  };
}

export function createDuplicateSlidePatch(deck: Deck, sourceSlideId: string): DeckPatch {
  const sourceMatches = deck.slides.filter((slide) => slide.slideId === sourceSlideId);
  if (sourceMatches.length !== 1) {
    throw new Error(`Expected exactly one source slide: ${sourceSlideId}`);
  }

  const orderedSlides = [...deck.slides].sort(
    (left, right) => left.order - right.order,
  );
  const sourceIndex = orderedSlides.findIndex(
    (slide) => slide.slideId === sourceSlideId,
  );
  const allocateId = createLocalIdAllocator(deck);
  const duplicateInput = duplicateSlideWithReferences(
    sourceMatches[0]!,
    deck.slides.length + 1,
    allocateId,
  );
  const duplicate =
    deck.metadata.sourceType === "import"
      ? asAuthoredOoxmlSlide(duplicateInput)
      : duplicateInput;
  const reorderedSlideIds = [
    ...orderedSlides.slice(0, sourceIndex + 1).map((slide) => slide.slideId),
    duplicate.slideId,
    ...orderedSlides.slice(sourceIndex + 1).map((slide) => slide.slideId),
  ];

  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      { type: "add_slide", slide: duplicate },
      {
        type: "reorder_slides",
        slideOrders: reorderedSlideIds.map((slideId, index) => ({
          slideId,
          order: index + 1,
        })),
      },
    ],
  };
}

function asAuthoredOoxmlSlide(slide: Slide): Slide {
  const authored = {
    ...structuredClone(slide),
    ooxmlOrigin: "authored" as const,
    elements: slide.elements.map((element) => {
      const nextElement = {
        ...structuredClone(element),
        ooxmlOrigin: "authored" as const
      };
      delete nextElement.ooxmlEditCapabilities;
      return nextElement;
    })
  };
  return slideSchema.parse(authored);
}

function duplicateSlideWithReferences(
  sourceInput: Slide,
  temporaryOrder: number,
  allocateId: LocalIdAllocator,
): Slide {
  const source = slideSchema.parse(sourceInput);
  const nextSlideId = allocateId("slide_");
  const elementIds = createIdMap(
    source.elements.map((element) => element.elementId),
    "el_",
    allocateId,
  );
  const animationIds = createIdMap(
    source.animations.map((animation) => animation.animationId),
    "anim_",
    allocateId,
  );
  const keywordIds = createIdMap(
    source.keywords.map((keyword) => keyword.keywordId),
    "kw_",
    allocateId,
  );
  const actionIds = createIdMap(
    source.actions.map((action) => action.actionId),
    "act_",
    allocateId,
  );
  const semanticCueIds = createIdMap(
    source.semanticCues.map((cue) => cue.cueId),
    "scue_",
    allocateId,
  );
  const keywordsWithNewIds = source.keywords.map((keyword) => ({
    ...keyword,
    keywordId: requireRemappedId(keywordIds, keyword.keywordId, "keyword"),
  }));
  const occurrenceIds = createKeywordOccurrenceMap(
    source,
    nextSlideId,
    keywordsWithNewIds,
  );
  const keywords = keywordsWithNewIds.map((keyword, index) => ({
    ...keyword,
    requiredOccurrenceIds: source.keywords[index]!.requiredOccurrenceIds?.map(
      (occurrenceId) =>
        requireRemappedId(occurrenceIds, occurrenceId, "keyword occurrence"),
    ),
  }));
  const elements = source.elements.map((element) => {
    const nextElement = {
      ...element,
      elementId: requireRemappedId(elementIds, element.elementId, "element"),
    };

    if (nextElement.type !== "group") {
      return nextElement;
    }

    return {
      ...nextElement,
      props: {
        ...nextElement.props,
        childElementIds: nextElement.props.childElementIds.map((elementId) =>
          requireRemappedId(elementIds, elementId, "group child element"),
        ),
      },
    };
  });
  const animations = source.animations.map((animation) => ({
    ...animation,
    animationId: requireRemappedId(
      animationIds,
      animation.animationId,
      "animation",
    ),
    elementId: requireRemappedId(
      elementIds,
      animation.elementId,
      "animation target element",
    ),
  }));
  const actions = source.actions.map((action) => ({
    ...action,
    actionId: requireRemappedId(actionIds, action.actionId, "slide action"),
    trigger:
      action.trigger.kind === "cue"
        ? { ...action.trigger }
        : action.trigger.kind === "keyword"
          ? {
              ...action.trigger,
              keywordId: requireRemappedId(
                keywordIds,
                action.trigger.keywordId,
                "action keyword",
              ),
            }
          : {
              ...action.trigger,
              keywordId: requireRemappedId(
                keywordIds,
                action.trigger.keywordId,
                "action keyword",
              ),
              occurrenceId: requireRemappedId(
                occurrenceIds,
                action.trigger.occurrenceId,
                "action keyword occurrence",
              ),
            },
    effect:
      action.effect.kind === "go-to-next-slide"
        ? { ...action.effect }
        : {
            ...action.effect,
            animationId: requireRemappedId(
              animationIds,
              action.effect.animationId,
              "action animation",
            ),
          },
  }));
  const semanticCues = source.semanticCues.map((cue) => {
    const duplicateCue = {
      ...cue,
      cueId: requireRemappedId(semanticCueIds, cue.cueId, "semantic cue"),
      slideId: nextSlideId,
      freshness: "stale" as const,
      sourceRefs: cue.sourceRefs.map((sourceRef) =>
        remapSemanticSourceRef(sourceRef, source.slideId, nextSlideId, elementIds),
      ),
      targetElementIds: cue.targetElementIds.map((elementId) =>
        requireRemappedId(elementIds, elementId, "semantic cue target element"),
      ),
      triggerActionIds: cue.triggerActionIds.map((actionId) =>
        requireRemappedId(actionIds, actionId, "semantic cue trigger action"),
      ),
    };
    delete duplicateCue.sourceFingerprint;
    return duplicateCue;
  });
  const aiNotes = source.aiNotes
    ? {
        ...source.aiNotes,
        sourceLedger: source.aiNotes.sourceLedger?.map((entry) => ({
          ...entry,
          usedInSlideId:
            entry.usedInSlideId === source.slideId
              ? nextSlideId
              : entry.usedInSlideId,
        })),
        compositionPlan: source.aiNotes.compositionPlan
          ? {
              ...source.aiNotes.compositionPlan,
              primaryFocalElementId:
                source.aiNotes.compositionPlan.primaryFocalElementId === undefined
                  ? undefined
                  : requireRemappedId(
                      elementIds,
                      source.aiNotes.compositionPlan.primaryFocalElementId,
                      "primary focal element",
                    ),
            }
          : undefined,
      }
    : undefined;
  const title = source.title.trim() || `슬라이드 ${source.order}`;

  return slideSchema.parse({
    ...source,
    slideId: nextSlideId,
    order: temporaryOrder,
    title: `${title} 복사본`,
    thumbnailUrl: "",
    elements,
    animations,
    keywords,
    actions,
    semanticCues,
    aiNotes,
  });
}

function createKeywordOccurrenceMap(
  source: Slide,
  nextSlideId: string,
  keywords: Slide["keywords"],
): Map<string, string> {
  const previousOccurrences = deriveKeywordOccurrences(source);
  const nextOccurrences = deriveKeywordOccurrences({
    ...source,
    slideId: nextSlideId,
    keywords,
  });

  if (previousOccurrences.length !== nextOccurrences.length) {
    throw new Error("Keyword occurrence remap did not preserve occurrence count");
  }

  return new Map(
    previousOccurrences.map((occurrence, index) => [
      occurrence.occurrenceId,
      nextOccurrences[index]!.occurrenceId,
    ]),
  );
}

function remapSemanticSourceRef(
  sourceRef: SemanticCueSourceRef,
  sourceSlideId: string,
  nextSlideId: string,
  elementIds: Map<string, string>,
): SemanticCueSourceRef {
  if (sourceRef.refId === undefined) {
    return { ...sourceRef };
  }

  if (sourceRef.kind === "slide-title" || sourceRef.kind === "speaker-notes") {
    return {
      ...sourceRef,
      refId:
        sourceRef.refId === sourceSlideId ? nextSlideId : sourceRef.refId,
    };
  }

  return {
    ...sourceRef,
    refId: requireRemappedId(
      elementIds,
      sourceRef.refId,
      `semantic cue ${sourceRef.kind} source`,
    ),
  };
}

function createIdMap(
  sourceIds: string[],
  prefix: LocalIdPrefix,
  allocateId: LocalIdAllocator,
): Map<string, string> {
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error(`Cannot duplicate non-unique ${prefix} IDs`);
  }

  return new Map(sourceIds.map((sourceId) => [sourceId, allocateId(prefix)]));
}

function requireRemappedId(
  idMap: Map<string, string>,
  sourceId: string,
  referenceKind: string,
): string {
  const nextId = idMap.get(sourceId);
  if (!nextId) {
    throw new Error(`Cannot remap ${referenceKind}: ${sourceId}`);
  }
  return nextId;
}

function createLocalIdAllocator(deck: Deck): LocalIdAllocator {
  const existingIds: Record<LocalIdPrefix, Set<string>> = {
    "slide_": new Set(deck.slides.map((slide) => slide.slideId)),
    "el_": new Set(
      deck.slides.flatMap((slide) =>
        slide.elements.map((element) => element.elementId),
      ),
    ),
    "anim_": new Set(
      deck.slides.flatMap((slide) =>
        slide.animations.map((animation) => animation.animationId),
      ),
    ),
    "kw_": new Set(
      deck.slides.flatMap((slide) =>
        slide.keywords.map((keyword) => keyword.keywordId),
      ),
    ),
    "act_": new Set(
      deck.slides.flatMap((slide) =>
        slide.actions.map((action) => action.actionId),
      ),
    ),
    "scue_": new Set(
      deck.slides.flatMap((slide) =>
        slide.semanticCues.map((cue) => cue.cueId),
      ),
    ),
  };
  const nextIndexes: Record<LocalIdPrefix, number> = {
    "slide_": 1,
    "el_": 1,
    "anim_": 1,
    "kw_": 1,
    "act_": 1,
    "scue_": 1,
  };

  return (prefix) => {
    let candidate = `${prefix}${nextIndexes[prefix]}`;
    while (existingIds[prefix].has(candidate)) {
      nextIndexes[prefix] += 1;
      candidate = `${prefix}${nextIndexes[prefix]}`;
    }
    existingIds[prefix].add(candidate);
    nextIndexes[prefix] += 1;
    return candidate;
  };
}
