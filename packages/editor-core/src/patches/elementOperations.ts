import type { Deck, DeckElement, DeckPatch } from "@orbit/shared";

type ElementIdKind = "element";

export function createAddElementPatch(
  deck: Deck,
  slideId: string,
  element: DeckElement
): DeckPatch {
  const nextElement =
    deck.metadata.sourceType === "import"
      ? asAuthoredOoxmlElement(element)
      : element;
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "add_element",
        slideId,
        element: nextElement
      }
    ]
  };
}

function asAuthoredOoxmlElement(element: DeckElement): DeckElement {
  const authored = {
    ...structuredClone(element),
    ooxmlOrigin: "authored" as const
  };
  delete authored.ooxmlEditCapabilities;
  return authored;
}

export function createUpdateElementPropsPatch(
  deck: Deck,
  slideId: string,
  elementId: string,
  props: Record<string, unknown>
): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "update_element_props",
        slideId,
        elementId,
        props
      }
    ]
  };
}

export function createUpdateElementMorphKeyPatch(
  deck: Deck,
  slideId: string,
  elementId: string,
  morphKey: string | null
): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "update_element_morph_key",
        slideId,
        elementId,
        morphKey
      }
    ]
  };
}

export function createDeleteElementPatch(
  deck: Deck,
  slideId: string,
  elementId: string
): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "delete_element",
        slideId,
        elementId
      }
    ]
  };
}

export function createElementId(deck: Deck, kind: ElementIdKind = "element") {
  const prefix = kind === "element" ? "el_" : "id_";
  const existingIds = new Set(
    deck.slides.flatMap((slide) => slide.elements.map((element) => element.elementId))
  );

  for (let index = 1; index <= 9999; index += 1) {
    const candidate = `${prefix}${index}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return `${prefix}${Date.now()}`;
}
