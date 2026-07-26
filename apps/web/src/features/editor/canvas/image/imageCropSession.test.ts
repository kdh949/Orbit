import { createDemoDeck } from "@orbit/editor-core";
import type { Deck, DeckElement } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";

import { getImageCropActionState } from "./imageCropSession";

function getDemoImage() {
  const image = createDemoDeck().slides[0]?.elements.find(
    (element) => element.type === "image"
  );
  if (!image) throw new Error("demo image fixture is missing");
  return image;
}

function createImportedDeck(element: DeckElement): Deck {
  const deck = createDemoDeck();
  return {
    ...deck,
    metadata: { ...deck.metadata, sourceType: "import" },
    slides: [
      {
        ...deck.slides[0]!,
        elements: [element]
      },
      ...deck.slides.slice(1)
    ]
  };
}

describe("getImageCropActionState", () => {
  it("enables authored and generic deck images", () => {
    const deck = createDemoDeck();
    const image = getDemoImage();

    expect(getImageCropActionState(deck, image)).toEqual({
      enabled: true,
      reason: null,
      visible: true
    });
    expect(
      getImageCropActionState(createImportedDeck({ ...image, ooxmlOrigin: "authored" }), {
        ...image,
        ooxmlOrigin: "authored"
      })
    ).toEqual({ enabled: true, reason: null, visible: true });
  });

  it.each(["picture", "picture-fill"] as const)(
    "enables imported images with %s crop support",
    (crop) => {
      const image = {
        ...getDemoImage(),
        ooxmlOrigin: "imported" as const,
        ooxmlEditCapabilities: {
          crop,
          richText: "none" as const,
          tableCellText: false
        }
      };

      expect(getImageCropActionState(createImportedDeck(image), image)).toEqual({
        enabled: true,
        reason: null,
        visible: true
      });
    }
  );

  it("disables imported images without a writable crop locator", () => {
    const image = { ...getDemoImage(), ooxmlOrigin: "imported" as const };
    const state = getImageCropActionState(createImportedDeck(image), image);

    expect(state.enabled).toBe(false);
    expect(state.visible).toBe(true);
    expect(state.reason).toContain("안전하게 자르기를 저장");
  });

  it("stays hidden for non-image selections", () => {
    const deck = createDemoDeck();
    expect(getImageCropActionState(deck, deck.slides[0]!.elements[0]!)).toEqual({
      enabled: false,
      reason: null,
      visible: false
    });
  });
});
