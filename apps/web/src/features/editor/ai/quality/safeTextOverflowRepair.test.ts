import { applyDeckPatch, createDemoDeck } from "@orbit/editor-core";
import { deckPatchSchema, type Deck, type DeckElement } from "@orbit/shared";
import { describe, expect, it } from "vitest";
import { getEditorValidationItems } from "./editorValidation";
import { createSafeTextOverflowRepair } from "./safeTextOverflowRepair";

describe("createSafeTextOverflowRepair", () => {
  it("repairs only textOverflow items in one immutable AI patch", () => {
    const deck = createOverflowDeck();
    const slide = deck.slides[0];
    const first = textElement("el_text_first", "body", 24, 52, 0);
    const second = textElement("el_text_second", "caption", 20, 42, 500);
    const gridTarget = slide.elements[0];
    slide.elements = [gridTarget, first, second];
    const before = structuredClone(deck);

    const minimumProbe = applyDeckPatch(deck, {
      baseVersion: deck.version,
      deckId: deck.deckId,
      operations: [
        {
          elementId: first.elementId,
          props: { fontSize: 18 },
          slideId: slide.slideId,
          type: "update_element_props"
        }
      ],
      source: "ai"
    });
    expect(minimumProbe.ok ? null : minimumProbe.error).toBeNull();
    if (!minimumProbe.ok) throw new Error("minimum probe failed");
    expect(
      getEditorValidationItems(minimumProbe.deck, minimumProbe.deck.slides[0]).some(
        (item) => item.issue === "textOverflow" && item.elementId === first.elementId
      )
    ).toBe(false);

    const result = createSafeTextOverflowRepair({
      deck,
      items: [
        issue(slide.slideId, first.elementId, "textOverflow"),
        issue(slide.slideId, second.elementId, "textOverflow"),
        issue(slide.slideId, first.elementId, "titleWrap"),
        issue(slide.slideId, gridTarget.elementId, "GRID_ALIGNMENT_INCONSISTENT"),
        {
          ...issue(slide.slideId, first.elementId, "textOverlap"),
          elementId: undefined,
          elementIds: [first.elementId, second.elementId]
        }
      ]
    });

    expect(deck).toEqual(before);
    expect(result.skipped).toEqual([]);
    expect(result.repairedElementIds).toEqual([first.elementId, second.elementId]);
    expect(result.patch).toMatchObject({
      baseVersion: deck.version,
      deckId: deck.deckId,
      source: "ai"
    });
    expect(result.patch?.operations).toHaveLength(2);
    expect(
      result.patch?.operations.every((operation) =>
        operation.type === "update_element_props" &&
        [first.elementId, second.elementId].includes(operation.elementId)
      )
    ).toBe(true);
    expect(deckPatchSchema.safeParse(result.patch).success).toBe(true);

    const applied = applyDeckPatch(deck, result.patch!);
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error("repair patch did not apply");
    const remainingOverflowIds = getEditorValidationItems(
      applied.deck,
      applied.deck.slides[0]
    )
      .filter((item) => item.issue === "textOverflow")
      .map((item) => item.elementId);
    expect(remainingOverflowIds).not.toContain(first.elementId);
    expect(remainingOverflowIds).not.toContain(second.elementId);
  });

  it("never crosses the semantic role minimum font size", () => {
    const deck = createOverflowDeck();
    const slide = deck.slides[0];
    const coverCases = [
      textElement("el_cover_title", "title", 48, 114, 0),
      textElement("el_body_text", "body", 20, 52, 360),
      textElement("el_caption_text", "caption", 16, 42, 720),
      textElement("el_footer_text", "footer", 14, 37, 1080)
    ];
    slide.elements = coverCases;
    const contentSlide = structuredClone(slide);
    contentSlide.slideId = "slide_content";
    contentSlide.order = 2;
    const contentCases = [
      textElement("el_content_title", "title", 36, 85, 0),
      textElement("el_subtitle_text", "subtitle", 20, 52, 360),
      textElement("el_highlight_text", "highlight", 20, 52, 720)
    ];
    contentSlide.elements = contentCases;
    deck.slides.push(contentSlide);

    const result = createSafeTextOverflowRepair({
      deck,
      items: [
        ...coverCases.map((element) =>
          issue(slide.slideId, element.elementId, "textOverflow")
        ),
        ...contentCases.map((element) =>
          issue(contentSlide.slideId, element.elementId, "textOverflow")
        )
      ]
    });

    const minimumById = new Map([
      ["el_cover_title", 44],
      ["el_body_text", 18],
      ["el_caption_text", 14],
      ["el_footer_text", 12],
      ["el_content_title", 32],
      ["el_subtitle_text", 18],
      ["el_highlight_text", 18]
    ]);
    expect(result.repairedElementIds).toEqual(Array.from(minimumById.keys()));
    for (const operation of result.patch?.operations ?? []) {
      if (operation.type !== "update_element_props") continue;
      expect(operation.props.fontSize).toBeGreaterThanOrEqual(
        minimumById.get(operation.elementId) ?? 12
      );
    }
  });

  it("skips locked, missing, non-text, rich-text, and minimum-bound targets", () => {
    const deck = createOverflowDeck();
    const slide = deck.slides[0];
    const locked = { ...textElement("el_locked_text", "body", 24, 30, 0), locked: true };
    const rich = textElement("el_rich_text", "body", 24, 30, 300);
    rich.props.runs = [
      { text: rich.props.text, baseline: "normal", fontSize: 24 }
    ];
    const minimum = textElement("el_minimum_text", "body", 18, 20, 600);
    const shape = slide.elements.find((element) => element.type !== "text");
    if (!shape) throw new Error("non-text fixture missing");
    slide.elements = [shape, locked, rich, minimum];

    const result = createSafeTextOverflowRepair({
      deck,
      items: [
        issue(slide.slideId, locked.elementId, "textOverflow"),
        issue(slide.slideId, rich.elementId, "textOverflow"),
        issue(slide.slideId, minimum.elementId, "textOverflow"),
        issue(slide.slideId, shape.elementId, "textOverflow"),
        issue(slide.slideId, "el_missing_text", "textOverflow"),
        issue("missing_slide", locked.elementId, "textOverflow")
      ]
    });

    expect(result.patch).toBeNull();
    expect(result.repairedElementIds).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { elementId: locked.elementId, reason: "locked" },
        { elementId: rich.elementId, reason: "rich-text-unsupported" },
        { elementId: minimum.elementId, reason: "minimum-font-size" },
        { elementId: shape.elementId, reason: "not-text" },
        { elementId: "el_missing_text", reason: "missing-target" },
        { elementId: locked.elementId, reason: "missing-target" }
      ])
    );
  });

  it("accepts a candidate only when overflow disappears without new validation keys", () => {
    const deck = createOverflowDeck();
    const slide = deck.slides[0];
    const body = textElement("el_safe_body", "body", 24, 52, 0);
    slide.elements = [body];
    const beforeKeys = new Set(
      getEditorValidationItems(deck, slide).map(validationKey)
    );

    const result = createSafeTextOverflowRepair({
      deck,
      items: [issue(slide.slideId, body.elementId, "textOverflow")]
    });
    const applied = applyDeckPatch(deck, result.patch!);
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error("repair patch did not apply");

    const afterItems = getEditorValidationItems(applied.deck, applied.deck.slides[0]);
    expect(
      afterItems.some(
        (item) => item.issue === "textOverflow" && item.elementId === body.elementId
      )
    ).toBe(false);
    expect(afterItems.every((item) => beforeKeys.has(validationKey(item)))).toBe(true);
  });

  it("honors the optional element allowlist for one-target repair", () => {
    const deck = createOverflowDeck();
    const slide = deck.slides[0];
    const first = textElement("el_first", "body", 24, 52, 0);
    const second = textElement("el_second", "body", 24, 52, 500);
    slide.elements = [first, second];

    const result = createSafeTextOverflowRepair({
      deck,
      items: [
        issue(slide.slideId, first.elementId, "textOverflow"),
        issue(slide.slideId, second.elementId, "textOverflow")
      ],
      onlyElementIds: [second.elementId]
    });

    expect(result.repairedElementIds).toEqual([second.elementId]);
    expect(result.patch?.operations).toHaveLength(1);
  });
});

function createOverflowDeck(): Deck {
  const deck = createDemoDeck();
  deck.metadata.presentationProfile = "proposal";
  return deck;
}

function textElement(
  elementId: string,
  role: Extract<DeckElement, { type: "text" }>["role"],
  fontSize: number,
  height: number,
  x: number
): Extract<DeckElement, { type: "text" }> {
  return {
    elementId,
    type: "text",
    role,
    x,
    y: 240,
    width: 480,
    height,
    rotation: 0,
    opacity: 1,
    zIndex: 10,
    locked: false,
    visible: true,
    props: {
      text: "안전한 자동 수정 첫 줄\n안전한 자동 수정 둘째 줄",
      fontFamily: "Pretendard",
      fontSize,
      fontWeight: "normal",
      color: "#111827",
      align: "left",
      verticalAlign: "top",
      lineHeight: 1.2
    }
  };
}

function issue(
  slideId: string,
  elementId: string,
  issueName: "textOverflow" | "titleWrap" | "GRID_ALIGNMENT_INCONSISTENT" | "textOverlap"
) {
  return {
    elementId,
    issue: issueName,
    message: "검사 경고",
    severity: "warning" as const,
    slideId
  };
}

function validationKey(item: ReturnType<typeof getEditorValidationItems>[number]) {
  return [
    item.slideId ?? "",
    item.issue ?? "",
    item.severity,
    item.elementId ?? "",
    [...(item.elementIds ?? [])].sort().join(","),
    item.message
  ].join("|");
}
