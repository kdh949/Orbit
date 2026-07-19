import { createKeywordOccurrenceId, deckSchema, type Deck } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import { createDemoDeck } from "../index";
import { applyDeckPatch } from "./applyPatch";
import {
  createAddSlidePatch,
  createDuplicateSlidePatch,
  createSlideId,
  createUpdateSlideTransitionPatch,
} from "./slideOperations";

describe("slide operation helpers", () => {
  it("creates a unique slide id", () => {
    const deck = createDemoDeck();
    expect(createSlideId(deck)).toBe("slide_3");
  });

  it("creates an add_slide patch", () => {
    const deck = createDemoDeck();
    const patch = createAddSlidePatch(deck, {
      kind: "content",
      slideId: "slide_3",
      order: 3,
      title: "New Slide",
      thumbnailUrl: "",
      style: {},
      speakerNotes: "",
      elements: [],
      keywords: [],
      semanticCues: [],
      animations: [],
      actions: []
    });
    const result = applyDeckPatch(deck, patch);

    expect(result.ok).toBe(true);
  });

  it("creates set and clear slide transition patches", () => {
    const deck = createDemoDeck();

    expect(
      createUpdateSlideTransitionPatch(deck, "slide_1", {
        type: "fade",
        durationMs: 700
      })
    ).toMatchObject({
      operations: [
        {
          type: "update_slide_transition",
          slideId: "slide_1",
          transition: { type: "fade", durationMs: 700 }
        }
      ]
    });
    expect(
      createUpdateSlideTransitionPatch(deck, "slide_1", null)
    ).toMatchObject({
      operations: [
        {
          type: "update_slide_transition",
          slideId: "slide_1",
          transition: null
        }
      ]
    });
  });

  it("adds a twenty-first slide to an editor-managed deck", () => {
    const deck = createDemoDeck();
    const templateSlide = deck.slides[0];
    const twentySlideDeck = {
      ...deck,
      slides: Array.from({ length: 20 }, (_, index) => ({
        ...templateSlide,
        slideId: `slide_${index + 1}`,
        order: index + 1,
        title: `Slide ${index + 1}`,
        elements: [],
        animations: [],
        actions: []
      }))
    };
    const patch = createAddSlidePatch(twentySlideDeck, {
      ...templateSlide,
      slideId: "slide_21",
      order: 21,
      title: "Slide 21",
      elements: [],
      animations: [],
      actions: []
    });

    const result = applyDeckPatch(twentySlideDeck, patch);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deck.slides).toHaveLength(21);
      expect(result.deck.slides[20]?.slideId).toBe("slide_21");
    }
  });

  it("duplicates a reference-rich slide directly after its source", () => {
    const deck = createReferenceRichDeck();
    const source = deck.slides[1]!;
    const patch = createDuplicateSlidePatch(deck, source.slideId);

    expect(patch.operations.map((operation) => operation.type)).toEqual([
      "add_slide",
      "reorder_slides",
    ]);

    const result = applyDeckPatch(deck, patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(deckSchema.safeParse(result.deck).success).toBe(true);
    expect(result.deck.slides.map((slide) => slide.slideId)).toEqual([
      "slide_1",
      "slide_2",
      "slide_3",
    ]);
    expect(result.deck.slides.map((slide) => slide.order)).toEqual([1, 2, 3]);

    const duplicate = result.deck.slides[2]!;
    expect(duplicate.title).toBe("Data Contract 복사본");
    expect(duplicate.thumbnailUrl).toBe("");
    expectReferenceRichDuplicate(source, duplicate, deck);
  });

  it("uses a stable slide title fallback for a duplicate", () => {
    const deck = createDemoDeck();
    deck.slides[0]!.title = "";

    const patch = createDuplicateSlidePatch(deck, "slide_1");
    const addOperation = patch.operations[0];

    expect(addOperation?.type).toBe("add_slide");
    if (addOperation?.type === "add_slide") {
      expect(addOperation.slide.title).toBe("슬라이드 1 복사본");
    }

    const result = applyDeckPatch(deck, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deck.slides.map((slide) => slide.slideId)).toEqual([
        "slide_1",
        "slide_3",
        "slide_2",
      ]);
      expect(result.deck.slides.map((slide) => slide.order)).toEqual([1, 2, 3]);
    }
  });

  it("does not inherit imported OOXML capabilities when duplicating a slide", () => {
    const deck = createDemoDeck();
    deck.metadata.sourceType = "import";
    deck.slides[0]!.ooxmlOrigin = "imported";
    deck.slides[0]!.elements[0]!.ooxmlOrigin = "imported";
    deck.slides[0]!.elements[0]!.ooxmlEditCapabilities = {
      richText: "none",
      crop: "none",
      tableCellText: false,
      frame: true,
    };

    const patch = createDuplicateSlidePatch(deck, "slide_1");
    const operation = patch.operations[0];

    expect(operation.type).toBe("add_slide");
    if (operation.type === "add_slide") {
      expect(operation.slide.ooxmlOrigin).toBe("authored");
      expect(
        operation.slide.elements.every(
          (element) =>
            element.ooxmlOrigin === "authored" &&
            element.ooxmlEditCapabilities === undefined,
        ),
      ).toBe(true);
    }
  });
});

function createReferenceRichDeck(): Deck {
  const deck = createDemoDeck();
  const source = deck.slides[1]!;
  const occurrenceId = createKeywordOccurrenceId(
    source.slideId,
    source.keywords[0]!.keywordId,
    0,
    7,
  );

  source.speakerNotes = "slideId 계약을 설명합니다.";
  source.keywords[0]!.requiredOccurrenceIds = [occurrenceId];
  source.actions = [
    {
      actionId: "act_1",
      trigger: {
        kind: "keyword-occurrence",
        keywordId: source.keywords[0]!.keywordId,
        occurrenceId,
      },
      effect: { kind: "play-animation", animationId: source.animations[0]!.animationId },
    },
  ];
  source.semanticCues = [
    {
      cueId: "scue_1",
      slideId: source.slideId,
      meaning: "slideId가 슬라이드 식별자임을 설명한다",
      importance: "core",
      reviewStatus: "approved",
      freshness: "current",
      origin: "manual",
      revision: 1,
      sourceFingerprint: "fingerprint-source-1",
      sourceRefs: [
        { kind: "slide-title", refId: source.slideId, sourceHash: "title-hash-source" },
        { kind: "speaker-notes", refId: source.slideId, sourceHash: "notes-hash-source" },
        { kind: "chart", refId: source.elements[1]!.elementId, sourceHash: "chart-hash-source" },
      ],
      qualityWarnings: [],
      required: true,
      priority: 1,
      candidateKeywords: ["slideId"],
      aliases: {},
      requiredConcepts: ["슬라이드 식별자"],
      nliHypotheses: ["발표자는 slideId가 슬라이드 식별자라고 설명했다"],
      negativeHints: [],
      targetElementIds: [source.elements[1]!.elementId],
      triggerActionIds: [source.actions[0]!.actionId],
    },
  ];
  source.aiNotes = {
    emphasisPoints: [],
    sourceEvidence: [],
    sourceLedger: [
      {
        claim: "계약 설명",
        source: "업로드 문서",
        sourceType: "uploaded",
        sourceId: "source_external_1",
        fileId: "file_external_1",
        chunkId: "chunk_external_1",
        confidence: 0.9,
        usedInSlideId: source.slideId,
      },
    ],
    compositionPlan: {
      compositionId: "metric-poster",
      variant: "default",
      backgroundMode: "light",
      focalType: "chart",
      primaryFocalElementId: source.elements[1]!.elementId,
      assetRole: "evidence",
      requiredAsset: false,
    },
  };

  return deckSchema.parse(deck);
}

function expectReferenceRichDuplicate(source: Deck["slides"][number], duplicate: Deck["slides"][number], deck: Deck) {
  const originalLocalIds = new Set([
    source.slideId,
    ...source.elements.map((element) => element.elementId),
    ...source.animations.map((animation) => animation.animationId),
    ...source.keywords.map((keyword) => keyword.keywordId),
    ...source.keywords.flatMap((keyword) => keyword.requiredOccurrenceIds ?? []),
    ...source.actions.map((action) => action.actionId),
    ...source.semanticCues.map((cue) => cue.cueId),
  ]);
  const existingDeckIds = new Set(
    deck.slides.flatMap((slide) => [
      slide.slideId,
      ...slide.elements.map((element) => element.elementId),
      ...slide.animations.map((animation) => animation.animationId),
      ...slide.keywords.map((keyword) => keyword.keywordId),
      ...slide.actions.map((action) => action.actionId),
      ...slide.semanticCues.map((cue) => cue.cueId),
    ]),
  );
  const duplicateLocalIds = [
    duplicate.slideId,
    ...duplicate.elements.map((element) => element.elementId),
    ...duplicate.animations.map((animation) => animation.animationId),
    ...duplicate.keywords.map((keyword) => keyword.keywordId),
    ...duplicate.actions.map((action) => action.actionId),
    ...duplicate.semanticCues.map((cue) => cue.cueId),
  ];

  expect(duplicateLocalIds.every((id) => !existingDeckIds.has(id))).toBe(true);
  expect(new Set(duplicateLocalIds).size).toBe(duplicateLocalIds.length);

  const elementIds = duplicate.elements.map((element) => element.elementId);
  const group = duplicate.elements.find((element) => element.type === "group");
  expect(group?.type).toBe("group");
  if (group?.type === "group") {
    expect(group.props.childElementIds.every((id) => elementIds.includes(id))).toBe(true);
  }

  const animation = duplicate.animations[0]!;
  const keyword = duplicate.keywords[0]!;
  const action = duplicate.actions[0]!;
  const cue = duplicate.semanticCues[0]!;
  expect(elementIds).toContain(animation.elementId);
  expect(action.trigger).toMatchObject({
    kind: "keyword-occurrence",
    keywordId: keyword.keywordId,
    occurrenceId: keyword.requiredOccurrenceIds?.[0],
  });
  expect(action.effect).toEqual({
    kind: "play-animation",
    animationId: animation.animationId,
  });
  expect(cue).toMatchObject({
    slideId: duplicate.slideId,
    freshness: "stale",
    targetElementIds: [animation.elementId],
    triggerActionIds: [action.actionId],
  });
  expect(cue.sourceFingerprint).toBeUndefined();
  expect(cue.sourceRefs.map((ref) => ref.refId)).toEqual([
    duplicate.slideId,
    duplicate.slideId,
    animation.elementId,
  ]);
  expect(duplicate.aiNotes?.sourceLedger?.[0]).toMatchObject({
    usedInSlideId: duplicate.slideId,
    sourceId: "source_external_1",
    fileId: "file_external_1",
    chunkId: "chunk_external_1",
  });
  expect(duplicate.aiNotes?.compositionPlan).toMatchObject({
    compositionId: "metric-poster",
    primaryFocalElementId: animation.elementId,
  });

  const duplicateReferences = [
    ...duplicate.animations.map((item) => item.elementId),
    ...duplicate.elements.flatMap((element) =>
      element.type === "group" ? element.props.childElementIds : [],
    ),
    ...duplicate.keywords.flatMap((item) => item.requiredOccurrenceIds ?? []),
    ...duplicate.actions.flatMap((item) => [
      ...(item.trigger.kind === "cue" ? [] : [item.trigger.keywordId]),
      ...(item.trigger.kind === "keyword-occurrence" ? [item.trigger.occurrenceId] : []),
      ...(item.effect.kind === "play-animation" ? [item.effect.animationId] : []),
    ]),
    ...duplicate.semanticCues.flatMap((item) => [
      item.slideId,
      ...item.targetElementIds,
      ...item.triggerActionIds,
      ...item.sourceRefs.flatMap((ref) => ref.refId ?? []),
    ]),
    duplicate.aiNotes?.sourceLedger?.[0]?.usedInSlideId ?? "",
    duplicate.aiNotes?.compositionPlan?.primaryFocalElementId ?? "",
  ];
  expect(duplicateReferences.some((id) => originalLocalIds.has(id))).toBe(false);
}
