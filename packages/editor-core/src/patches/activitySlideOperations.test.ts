import { describe, expect, it } from "vitest";

import { deckSchema } from "@orbit/shared";

import { createDemoDeck } from "../index";
import { applyDeckPatch } from "./applyPatch";
import {
  createActivityResultsSlide,
  createActivitySlide,
  createReplaceActivityDesignPatch,
  createUpdateActivityDefinitionPatch,
  createUpdateActivityResultDefinitionPatch,
  duplicateActivityResultsSlide,
  duplicateActivitySlide,
  remapActivityDefinitionsForDeckDuplicate
} from "./activitySlideOperations";

function deckWithSatisfaction() {
  const deck = createDemoDeck();
  const activitySlide = createActivitySlide(deck, "satisfaction");
  return deckSchema.parse({ ...deck, slides: [...deck.slides, activitySlide] });
}

describe("Activity slide operations", () => {
  it("creates every Activity template as a valid 16:9 slide", () => {
    for (const template of ["pre-question", "poll", "satisfaction"] as const) {
      const deck = createDemoDeck();
      const slide = createActivitySlide(deck, template);
      const result = deckSchema.safeParse({ ...deck, slides: [...deck.slides, slide] });

      expect(result.success).toBe(true);
      expect(slide.kind).toBe("activity");
      expect(slide.activity.template).toBe(template);
    }
  });

  it("blocks Activity creation for a 4:3 Deck", () => {
    const deck = createDemoDeck();
    const standardDeck = deckSchema.parse({
      ...deck,
      canvas: {
        preset: "standard-4-3",
        width: 1024,
        height: 768,
        aspectRatio: "4:3"
      }
    });

    expect(() => createActivitySlide(standardDeck, "poll")).toThrow(
      "wide-16-9"
    );
  });

  it("applies dedicated definition patches", () => {
    const deck = deckWithSatisfaction();
    const activitySlide = deck.slides.find((slide) => slide.kind === "activity");
    if (!activitySlide) throw new Error("missing activity slide");

    const definitionResult = applyDeckPatch(
      deck,
      createUpdateActivityDefinitionPatch(deck, activitySlide.slideId, {
        ...activitySlide.activity,
        title: "수정된 만족도"
      })
    );
    expect(definitionResult.ok).toBe(true);
    if (!definitionResult.ok) return;

    const resultSlide = createActivityResultsSlide(
      definitionResult.deck,
      activitySlide.activity.activityId
    );
    const deckWithResult = deckSchema.parse({
      ...definitionResult.deck,
      slides: [...definitionResult.deck.slides, resultSlide]
    });
    const resultPatch = createUpdateActivityResultDefinitionPatch(
      deckWithResult,
      resultSlide.slideId,
      { ...resultSlide.activityResult, layout: "chart" }
    );
    expect(resultPatch.operations[0]).toEqual({
      type: "update_activity_result_definition",
      slideId: resultSlide.slideId,
      activityResult: {
        sourceActivityId: activitySlide.activity.activityId,
        display: "live",
        layout: "chart"
      }
    });
    const result = applyDeckPatch(deckWithResult, resultPatch);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const updated = result.deck.slides.find(
        (slide) => slide.slideId === resultSlide.slideId
      );
      expect(updated?.kind).toBe("activity-results");
      if (updated?.kind === "activity-results") {
        expect(updated.activityResult.layout).toBe("chart");
      }
    }
  });

  it("replaces Activity appearance, style, and elements atomically", () => {
    const deck = deckWithSatisfaction();
    const source = deck.slides.find((slide) => slide.kind === "activity");
    if (!source) throw new Error("missing activity slide");

    const patch = createReplaceActivityDesignPatch(deck, source.slideId, {
      activityAppearance: { mode: "editable" },
      style: { backgroundColor: "#F7F7F2" },
      elements: [
        {
          elementId: "el_activity_title",
          type: "activity-copy",
          x: 100,
          y: 100,
          width: 1000,
          height: 180,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            activityId: source.activity.activityId,
            field: "title",
            fallbackText: "",
            textStyle: { fontSize: 72 }
          }
        }
      ]
    });
    const result = applyDeckPatch(deck, patch);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = result.deck.slides.find(
      (slide) => slide.slideId === source.slideId
    );
    expect(updated).toMatchObject({
      kind: "activity",
      activityAppearance: { mode: "editable" },
      style: { backgroundColor: "#F7F7F2" }
    });
    expect(updated?.elements).toHaveLength(1);
  });

  it("duplicates Activity definitions with fresh IDs", () => {
    const deck = deckWithSatisfaction();
    const source = deck.slides.find((slide) => slide.kind === "activity");
    if (!source) throw new Error("missing activity slide");
    const duplicate = duplicateActivitySlide(deck, source.slideId);

    expect(duplicate.activity.activityId).not.toBe(source.activity.activityId);
    expect(duplicate.activity.questions.map((question) => question.questionId)).not.toEqual(
      source.activity.questions.map((question) => question.questionId)
    );
    expect(
      deckSchema.safeParse({ ...deck, slides: [...deck.slides, duplicate] }).success
    ).toBe(true);
  });

  it("keeps the same source when duplicating only a result slide", () => {
    const deck = deckWithSatisfaction();
    const source = deck.slides.find((slide) => slide.kind === "activity");
    if (!source) throw new Error("missing activity slide");
    const result = createActivityResultsSlide(deck, source.activity.activityId);
    const deckWithResult = deckSchema.parse({
      ...deck,
      slides: [...deck.slides, result]
    });
    const duplicate = duplicateActivityResultsSlide(deckWithResult, result.slideId);

    expect(duplicate.activityResult.sourceActivityId).toBe(
      result.activityResult.sourceActivityId
    );
  });

  it("remaps result references during whole Deck duplication", () => {
    const deck = deckWithSatisfaction();
    const source = deck.slides.find((slide) => slide.kind === "activity");
    if (!source) throw new Error("missing activity slide");
    const result = createActivityResultsSlide(deck, source.activity.activityId);
    const completeDeck = deckSchema.parse({ ...deck, slides: [...deck.slides, result] });
    const duplicate = remapActivityDefinitionsForDeckDuplicate(
      completeDeck,
      "deck_activity_copy"
    );
    const duplicatedActivity = duplicate.slides.find(
      (slide) => slide.kind === "activity"
    );
    const duplicatedResult = duplicate.slides.find(
      (slide) => slide.kind === "activity-results"
    );

    expect(duplicatedActivity?.kind).toBe("activity");
    expect(duplicatedResult?.kind).toBe("activity-results");
    if (
      duplicatedActivity?.kind === "activity" &&
      duplicatedResult?.kind === "activity-results"
    ) {
      expect(duplicatedActivity.activity.activityId).not.toBe(
        source.activity.activityId
      );
      expect(duplicatedResult.activityResult.sourceActivityId).toBe(
        duplicatedActivity.activity.activityId
      );
    }
  });

  it("remaps reusable Activity-bound references during whole Deck duplication", () => {
    const deck = deckWithSatisfaction();
    const source = deck.slides.find((slide) => slide.kind === "activity");
    const content = deck.slides.find((slide) => slide.kind === "content");
    if (!source || !content) throw new Error("missing fixture slide");
    const completeDeck = deckSchema.parse({
      ...deck,
      slides: deck.slides.map((slide) =>
        slide.slideId === content.slideId
          ? {
              ...slide,
              elements: [
                ...slide.elements,
                {
                  elementId: "el_activity_qr_1",
                  type: "activity-qr",
                  x: 100,
                  y: 100,
                  width: 240,
                  height: 240,
                  rotation: 0,
                  opacity: 1,
                  zIndex: 99,
                  locked: false,
                  visible: true,
                  props: { activityId: source.activity.activityId }
                },
                {
                  elementId: "el_activity_copy_1",
                  type: "activity-copy",
                  x: 400,
                  y: 100,
                  width: 800,
                  height: 180,
                  rotation: 0,
                  opacity: 1,
                  zIndex: 100,
                  locked: false,
                  visible: true,
                  props: {
                    activityId: source.activity.activityId,
                    field: "title",
                    textStyle: {}
                  }
                }
              ]
            }
          : slide
      )
    });

    const duplicate = remapActivityDefinitionsForDeckDuplicate(
      completeDeck,
      "deck_activity_qr_copy"
    );
    const duplicatedActivity = duplicate.slides.find((slide) => slide.kind === "activity");
    const duplicatedQr = duplicate.slides
      .flatMap((slide) => slide.elements)
      .find((element) => element.type === "activity-qr");
    const duplicatedCopy = duplicate.slides
      .flatMap((slide) => slide.elements)
      .find((element) => element.type === "activity-copy");

    expect(duplicatedActivity?.kind).toBe("activity");
    expect(duplicatedQr?.type).toBe("activity-qr");
    if (duplicatedActivity?.kind === "activity" && duplicatedQr?.type === "activity-qr") {
      expect(duplicatedQr.props.activityId).toBe(duplicatedActivity.activity.activityId);
    }
    if (
      duplicatedActivity?.kind === "activity" &&
      duplicatedCopy?.type === "activity-copy"
    ) {
      expect(duplicatedCopy.props.activityId).toBe(
        duplicatedActivity.activity.activityId
      );
    }
  });

  it("removes Activity-bound elements when their Activity source is deleted", () => {
    const deck = deckWithSatisfaction();
    const source = deck.slides.find((slide) => slide.kind === "activity");
    const content = deck.slides.find((slide) => slide.kind === "content");
    if (!source || !content) throw new Error("missing fixture slide");
    const completeDeck = deckSchema.parse({
      ...deck,
      slides: deck.slides.map((slide) =>
        slide.slideId === content.slideId
          ? {
              ...slide,
              elements: [
                ...slide.elements,
                {
                  elementId: "el_activity_qr_delete",
                  type: "activity-qr",
                  x: 100,
                  y: 100,
                  width: 240,
                  height: 240,
                  rotation: 0,
                  opacity: 1,
                  zIndex: 99,
                  locked: false,
                  visible: true,
                  props: { activityId: source.activity.activityId }
                },
                {
                  elementId: "el_activity_copy_delete",
                  type: "activity-copy",
                  x: 400,
                  y: 100,
                  width: 800,
                  height: 180,
                  rotation: 0,
                  opacity: 1,
                  zIndex: 100,
                  locked: false,
                  visible: true,
                  props: {
                    activityId: source.activity.activityId,
                    field: "description",
                    textStyle: {}
                  }
                }
              ]
            }
          : slide
      )
    });
    const result = applyDeckPatch(completeDeck, {
      deckId: completeDeck.deckId,
      baseVersion: completeDeck.version,
      operations: [{ type: "delete_slide", slideId: source.slideId }]
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.deck.slides.flatMap((slide) => slide.elements).some(
          (element) =>
            element.type === "activity-qr" ||
            element.type === "activity-copy"
        )
      ).toBe(false);
    }
  });
});
