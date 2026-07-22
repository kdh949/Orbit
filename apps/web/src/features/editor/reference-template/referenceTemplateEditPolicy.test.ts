import { deckSchema, type DeckPatch } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import {
  canEditReferenceSlotContent,
  findReferenceTemplateUiViolation,
  isReferenceTemplateDeck,
  lockReferenceElementFrames,
} from "./referenceTemplateEditPolicy";

const deck = deckSchema.parse({
  deckId: "deck_reference_1",
  projectId: "project_1",
  title: "Reference",
  version: 1,
  metadata: {
    sourceType: "import",
    ooxmlReferenceTemplateSnapshot: {
      catalogTemplateId: "operating-review",
      catalogTemplateVersion: 1,
      sourceSha256: "a".repeat(64),
      generationId: "job_1",
    },
  },
  canvas: { preset: "wide-16-9", width: 1920, height: 1080, aspectRatio: "16:9" },
  slides: [{
    slideId: "slide_1",
    order: 1,
    title: "Slide",
    elements: [
      { elementId: "el_slot", type: "text", x: 10, y: 20, width: 300, height: 80, zIndex: 1, locked: false, props: { text: "before" } },
      { elementId: "el_locked", type: "rect", x: 0, y: 0, width: 100, height: 100, zIndex: 0, locked: true, props: {} },
    ],
  }],
});

function patch(operation: DeckPatch["operations"][number]): DeckPatch {
  return { deckId: deck.deckId, baseVersion: deck.version, source: "user", operations: [operation] };
}

describe("referenceTemplateEditPolicy", () => {
  it("recognizes reference Decks and editable slot elements", () => {
    expect(isReferenceTemplateDeck(deck)).toBe(true);
    expect(canEditReferenceSlotContent(deck, deck.slides[0]!.elements[0])).toBe(true);
    expect(canEditReferenceSlotContent(deck, deck.slides[0]!.elements[1])).toBe(false);
  });

  it("allows content props and blocks style, geometry, decoration, and slide mutations", () => {
    expect(findReferenceTemplateUiViolation(deck, patch({
      type: "update_element_props", slideId: "slide_1", elementId: "el_slot", props: { text: "after" },
    }))).toBeNull();
    expect(findReferenceTemplateUiViolation(deck, patch({
      type: "update_element_props", slideId: "slide_1", elementId: "el_slot", props: { fontSize: 48 },
    }))?.reason).toContain("범위를 벗어난");
    expect(findReferenceTemplateUiViolation(deck, patch({
      type: "update_element_frame", slideId: "slide_1", elementId: "el_slot", frame: { x: 100 },
    }))?.operation).toBe("update_element_frame");
    expect(findReferenceTemplateUiViolation(deck, patch({
      type: "update_element_props", slideId: "slide_1", elementId: "el_locked", props: { fill: "#000000" },
    }))?.reason).toContain("아닙니다");
    expect(findReferenceTemplateUiViolation(deck, patch({
      type: "delete_slide", slideId: "slide_1",
    }))?.operation).toBe("delete_slide");
  });

  it("locks every frame exposed to the canvas without locking the canonical Deck", () => {
    const locked = lockReferenceElementFrames(deck, deck.slides[0]!.elements);
    expect(locked.every((element) => element.locked)).toBe(true);
    expect(deck.slides[0]!.elements[0]!.locked).toBe(false);
  });

  it("leaves ordinary Deck capabilities unchanged", () => {
    const ordinary = deckSchema.parse({ ...deck, metadata: { sourceType: "import" } });
    expect(findReferenceTemplateUiViolation(ordinary, patch({
      type: "delete_slide", slideId: "slide_1",
    }))).toBeNull();
    expect(lockReferenceElementFrames(ordinary, ordinary.slides[0]!.elements)[0]!.locked).toBe(false);
  });
});
