import { describe, expect, it } from "vitest";

import type {
  Deck,
  DeckElement,
  DeckPatch,
  DeckPatchOperation,
  SemanticCue,
  Slide,
} from "@orbit/shared";

import { createDemoDeck } from "../index";
import { applyRichTextCharacterStyle } from "../text/richTextOperations";
import { applyDeckPatch } from "./applyPatch";
import type { ApplyDeckPatchResult, ApplyDeckPatchSuccess } from "./deckPatch";

const fixedCreatedAt = "2026-06-27T01:00:00+09:00";

function createPatch(
  operations: DeckPatchOperation[],
  baseVersion = 1,
  deckId = "deck_demo_1",
): DeckPatch {
  return {
    deckId,
    baseVersion,
    source: "user",
    operations,
  };
}

function createSlide(slideId: string, order: number): Slide {
  return {
    kind: "content",
    slideId,
    order,
    title: `Slide ${order}`,
    thumbnailUrl: "",
    style: {},
    speakerNotes: "",
    elements: [],
    keywords: [],
    semanticCues: [],
    animations: [],
    actions: [],
  };
}

function createTextElement(elementId: string): DeckElement {
  return {
    elementId,
    type: "text",
    role: "body",
    x: 200,
    y: 160,
    width: 480,
    height: 96,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    locked: false,
    visible: true,
    props: {
      text: "New text",
      fontSize: 24,
      fontWeight: "normal",
      align: "left",
      verticalAlign: "top",
      lineHeight: 1.2,
    },
  };
}

function createTableElement(elementId: string): DeckElement {
  return {
    elementId,
    type: "table",
    role: "table",
    x: 200,
    y: 160,
    width: 480,
    height: 180,
    rotation: 0,
    opacity: 1,
    zIndex: 2,
    locked: false,
    visible: true,
    props: {
      rows: [
        [
          {
            text: "기존 값",
            fill: "transparent",
            fontSize: 18,
            fontWeight: "normal",
            align: "left",
            verticalAlign: "middle",
            borderColor: "#CBD5E1",
            borderWidth: 1,
            colSpan: 1,
            rowSpan: 1,
          },
        ],
      ],
      borderColor: "#CBD5E1",
      borderWidth: 1,
    },
  };
}

function createChartElement(elementId: string): DeckElement {
  return {
    elementId,
    type: "chart",
    role: "chart",
    x: 200,
    y: 160,
    width: 480,
    height: 240,
    rotation: 0,
    opacity: 1,
    zIndex: 3,
    locked: false,
    visible: true,
    props: {
      type: "bar",
      title: "기존 추이",
      data: [{ label: "1분기", value: 10 }],
      style: {
        colors: [],
        showLegend: true,
        legendPosition: "bottom",
        showDataLabels: false,
        showGrid: true,
        xAxisTitle: "분기",
        yAxisTitle: "건수",
        unit: "건",
      },
    },
  };
}

function createSemanticCue(overrides: Partial<SemanticCue> = {}): SemanticCue {
  return {
    cueId: "scue_1",
    slideId: "slide_1",
    meaning: "발표자는 ORBIT의 핵심 가치를 설명한다",
    importance: "core",
    reviewStatus: "approved",
    freshness: "current",
    origin: "manual",
    revision: 1,
    sourceRefs: [],
    qualityWarnings: [],
    required: true,
    priority: 1,
    candidateKeywords: ["ORBIT"],
    aliases: {},
    requiredConcepts: ["핵심 가치"],
    nliHypotheses: ["발표자는 ORBIT의 핵심 가치를 설명했다"],
    negativeHints: [],
    targetElementIds: [],
    triggerActionIds: [],
    ...overrides,
  };
}

function createPatchTestDeck(): Deck {
  const deck = createDemoDeck();
  const slide: Slide = {
    ...createSlide("slide_1", 1),
    title: "Opening",
    thumbnailUrl: "/files/thumbnails/slide_1.png",
    speakerNotes: "ORBIT 데모 흐름을 소개합니다.",
    keywords: [
      {
        keywordId: "kw_1",
        text: "ORBIT",
        synonyms: ["발표 도우미"],
        abbreviations: ["OBT"],
        required: true,
      },
    ],
    elements: [createTextElement("el_1")],
    animations: [
      {
        animationId: "anim_1",
        elementId: "el_1",
        type: "fade-in",
        order: 1,
        durationMs: 400,
        delayMs: 0,
        easing: "ease-out",
      },
    ],
    actions: [],
  };

  return {
    ...deck,
    slides: [slide],
  };
}

function createDeckWithSecondSlide(): Deck {
  const deck = createPatchTestDeck();

  deck.slides.push(createSlide("slide_2", 2));

  return deck;
}

function expectPatchSuccess(
  result: ApplyDeckPatchResult,
): ApplyDeckPatchSuccess {
  if (!result.ok) {
    throw new Error(result.error.code);
  }

  return result;
}

function applyPatchOrFail(deck: Deck, patch: DeckPatch): ApplyDeckPatchSuccess {
  return expectPatchSuccess(
    applyDeckPatch(deck, patch, {
      changeId: `change_${patch.deckId}_${patch.baseVersion + 1}`,
      createdAt: fixedCreatedAt,
    }),
  );
}

describe("applyDeckPatch", () => {
  it("applies update_deck and returns version metadata with change record", () => {
    const deck = createPatchTestDeck();
    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "update_deck",
          title: "Updated Deck",
        },
      ]),
    );

    expect(result.deck.title).toBe("Updated Deck");
    expect(result.deck.version).toBe(2);
    expect(result.metadata).toEqual({
      deckId: deck.deckId,
      baseVersion: 1,
      nextVersion: 2,
    });
    expect(result.changeRecord).toMatchObject({
      changeId: "change_deck_demo_1_2",
      deckId: deck.deckId,
      beforeVersion: 1,
      afterVersion: 2,
      source: "user",
      createdAt: fixedCreatedAt,
    });
    expect(deck.title).toBe("ORBIT Demo Deck");
  });

  it("applies update_deck metadata patch", () => {
    const deck = createPatchTestDeck();
    deck.metadata.sourceType = "import";
    deck.metadata.thumbnailSource = "import-render";

    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          metadata: {
            thumbnailSource: "canvas",
          },
          type: "update_deck",
        },
      ]),
    );

    expect(result.deck.metadata.thumbnailSource).toBe("canvas");
    expect(result.deck.metadata.sourceType).toBe("import");
    expect(result.deck.title).toBe(deck.title);
  });

  it("applies deck and slide target duration patches", () => {
    const deck = createPatchTestDeck();
    deck.slides[0]!.estimatedSeconds = 30;

    const result = applyPatchOrFail(
      deck,
      createPatch([
        { type: "update_deck", targetDurationMinutes: 12 },
        {
          type: "update_slide",
          slideId: "slide_1",
          estimatedSeconds: 90,
        },
      ]),
    );

    expect(result.deck.targetDurationMinutes).toBe(12);
    expect(result.deck.slides[0]!.estimatedSeconds).toBe(90);
  });

  it("clears a slide target duration override", () => {
    const deck = createPatchTestDeck();
    deck.slides[0]!.estimatedSeconds = 30;

    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "update_slide",
          slideId: "slide_1",
          estimatedSeconds: null,
        },
      ]),
    );

    expect(result.deck.slides[0]!.estimatedSeconds).toBeUndefined();
  });

  it("adds a slide and keeps slides sorted by order", () => {
    const result = applyPatchOrFail(
      createPatchTestDeck(),
      createPatch([
        {
          type: "add_slide",
          slide: createSlide("slide_2", 2),
        },
      ]),
    );

    expect(result.deck.slides.map((slide) => slide.slideId)).toEqual([
      "slide_1",
      "slide_2",
    ]);
  });

  it("updates slide title and thumbnailUrl", () => {
    const result = applyPatchOrFail(
      createPatchTestDeck(),
      createPatch([
        {
          type: "update_slide",
          slideId: "slide_1",
          title: "Opening Updated",
          thumbnailUrl: "/files/thumbnails/updated.png",
        },
      ]),
    );

    expect(result.deck.slides[0].title).toBe("Opening Updated");
    expect(result.deck.slides[0].thumbnailUrl).toBe(
      "/files/thumbnails/updated.png",
    );
  });

  it("deletes a slide", () => {
    const result = applyPatchOrFail(
      createDeckWithSecondSlide(),
      createPatch([
        {
          type: "delete_slide",
          slideId: "slide_2",
        },
      ]),
    );

    expect(result.deck.slides.map((slide) => slide.slideId)).toEqual([
      "slide_1",
    ]);
    expect(result.deck.slides.map((slide) => slide.order)).toEqual([1]);
  });

  it("normalizes remaining slide orders after deleting a middle slide", () => {
    const deck = createDeckWithSecondSlide();
    deck.slides.push(createSlide("slide_3", 3));

    const result = applyPatchOrFail(
      deck,
      createPatch([{ type: "delete_slide", slideId: "slide_2" }]),
    );

    expect(
      result.deck.slides.map((slide) => [slide.slideId, slide.order]),
    ).toEqual([
      ["slide_1", 1],
      ["slide_3", 2],
    ]);
  });

  it("rejects deleting the final slide without mutating the input deck", () => {
    const deck = createPatchTestDeck();
    const before = structuredClone(deck);

    const result = applyDeckPatch(
      deck,
      createPatch([{ type: "delete_slide", slideId: "slide_1" }]),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "LAST_SLIDE_DELETE_FORBIDDEN" },
    });
    expect(deck).toEqual(before);
  });

  it("reorders slides", () => {
    const result = applyPatchOrFail(
      createDeckWithSecondSlide(),
      createPatch([
        {
          type: "reorder_slides",
          slideOrders: [
            {
              slideId: "slide_2",
              order: 1,
            },
            {
              slideId: "slide_1",
              order: 2,
            },
          ],
        },
      ]),
    );

    expect(result.deck.slides.map((slide) => slide.slideId)).toEqual([
      "slide_2",
      "slide_1",
    ]);
    expect(result.deck.slides.map((slide) => slide.order)).toEqual([1, 2]);
  });

  it.each([
    {
      name: "missing slide ID",
      slideOrders: [{ slideId: "slide_1", order: 1 }],
    },
    {
      name: "duplicate slide ID",
      slideOrders: [
        { slideId: "slide_1", order: 1 },
        { slideId: "slide_1", order: 2 },
      ],
    },
    {
      name: "unknown slide ID",
      slideOrders: [
        { slideId: "slide_1", order: 1 },
        { slideId: "slide_missing", order: 2 },
      ],
    },
    {
      name: "duplicate order",
      slideOrders: [
        { slideId: "slide_1", order: 1 },
        { slideId: "slide_2", order: 1 },
      ],
    },
    {
      name: "out-of-range order",
      slideOrders: [
        { slideId: "slide_1", order: 1 },
        { slideId: "slide_2", order: 3 },
      ],
    },
  ])("rejects reorder input with $name without mutating the deck", ({ slideOrders }) => {
    const deck = createDeckWithSecondSlide();
    const before = structuredClone(deck);

    const result = applyDeckPatch(
      deck,
      createPatch([{ type: "reorder_slides", slideOrders }]),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_SLIDE_REORDER" },
    });
    expect(deck).toEqual(before);
  });

  it("adds an element", () => {
    const result = applyPatchOrFail(
      createPatchTestDeck(),
      createPatch([
        {
          type: "add_element",
          slideId: "slide_1",
          element: createTextElement("el_2"),
        },
      ]),
    );

    expect(
      result.deck.slides[0].elements.map((element) => element.elementId),
    ).toEqual(["el_1", "el_2"]);
  });

  it("updates element frame fields", () => {
    const result = applyPatchOrFail(
      createPatchTestDeck(),
      createPatch([
        {
          type: "update_element_frame",
          slideId: "slide_1",
          elementId: "el_1",
          frame: {
            x: 320,
            y: 240,
            width: 720,
            height: 180,
            zIndex: 3,
            locked: true,
            role: "highlight",
          },
        },
      ]),
    );
    const element = result.deck.slides[0].elements[0];

    expect(element).toMatchObject({
      x: 320,
      y: 240,
      width: 720,
      height: 180,
      zIndex: 3,
      locked: true,
      role: "highlight",
    });
  });

  it("updates element props", () => {
    const result = applyPatchOrFail(
      createPatchTestDeck(),
      createPatch([
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_1",
          props: {
            text: "Changed text",
            fontSize: 64,
          },
        },
      ]),
    );
    const element = result.deck.slides[0].elements[0];

    expect(element.type).toBe("text");

    if (element.type === "text") {
      expect(element.props.text).toBe("Changed text");
      expect(element.props.fontSize).toBe(64);
    }
  });

  it("marks approved cues stale when text content changes", () => {
    const deck = createPatchTestDeck();
    deck.slides[0].semanticCues = [createSemanticCue()];

    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_1",
          props: { text: "의미가 바뀐 문장" },
        },
      ]),
    );

    expect(result.deck.slides[0].semanticCues[0]).toMatchObject({
      reviewStatus: "approved",
      freshness: "stale",
      revision: 1,
    });
  });

  it("does not mark cues stale for frame or text style-only changes", () => {
    const deck = createPatchTestDeck();
    deck.slides[0].semanticCues = [createSemanticCue()];

    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "update_element_frame",
          slideId: "slide_1",
          elementId: "el_1",
          frame: { x: 320, zIndex: 4 },
        },
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_1",
          props: { fontSize: 36, color: "#111827" },
        },
      ]),
    );

    expect(result.deck.slides[0].semanticCues[0].freshness).toBe("current");
  });

  it("does not mark cues stale when a style edit canonicalizes legacy text", () => {
    const deck = createPatchTestDeck();
    deck.slides[0].semanticCues = [createSemanticCue()];
    const element = deck.slides[0].elements[0];
    expect(element?.type).toBe("text");
    if (!element || element.type !== "text") return;
    const props = applyRichTextCharacterStyle(
      element.props,
      { start: 0, end: 2 },
      { italic: true }
    );

    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: element.elementId,
          props
        }
      ])
    );

    expect(result.deck.slides[0].semanticCues[0].freshness).toBe("current");
  });

  it("marks cues stale for table cell and chart data changes", () => {
    const tableDeck = createPatchTestDeck();
    tableDeck.slides[0].elements.push(createTableElement("el_table"));
    tableDeck.slides[0].semanticCues = [createSemanticCue()];
    const tableResult = applyPatchOrFail(
      tableDeck,
      createPatch([
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_table",
          props: {
            rows: [
              [
                {
                  text: "변경된 값",
                  fill: "transparent",
                  fontSize: 18,
                  fontWeight: "normal",
                  align: "left",
                  verticalAlign: "middle",
                  borderColor: "#CBD5E1",
                  borderWidth: 1,
                  colSpan: 1,
                  rowSpan: 1,
                },
              ],
            ],
          },
        },
      ]),
    );

    const chartDeck = createPatchTestDeck();
    chartDeck.slides[0].elements.push(createChartElement("el_chart"));
    chartDeck.slides[0].semanticCues = [createSemanticCue()];
    const chartResult = applyPatchOrFail(
      chartDeck,
      createPatch([
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_chart",
          props: { data: [{ label: "1분기", value: 20 }] },
        },
      ]),
    );

    expect(tableResult.deck.slides[0].semanticCues[0].freshness).toBe("stale");
    expect(chartResult.deck.slides[0].semanticCues[0].freshness).toBe("stale");
  });

  it("does not mark cues stale for table and chart decoration changes", () => {
    const tableDeck = createPatchTestDeck();
    tableDeck.slides[0].elements.push(createTableElement("el_table"));
    tableDeck.slides[0].semanticCues = [createSemanticCue()];
    const tableResult = applyPatchOrFail(
      tableDeck,
      createPatch([
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_table",
          props: { borderColor: "#111827" },
        },
      ]),
    );

    const chartDeck = createPatchTestDeck();
    chartDeck.slides[0].elements.push(createChartElement("el_chart"));
    chartDeck.slides[0].semanticCues = [createSemanticCue()];
    const chartResult = applyPatchOrFail(
      chartDeck,
      createPatch([
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_chart",
          props: { style: { colors: ["#2563EB"] } },
        },
      ]),
    );

    expect(tableResult.deck.slides[0].semanticCues[0].freshness).toBe("current");
    expect(chartResult.deck.slides[0].semanticCues[0].freshness).toBe("current");
  });

  it("marks cues stale only when speaker notes actually change", () => {
    const deck = createPatchTestDeck();
    deck.slides[0].semanticCues = [createSemanticCue()];
    const unchanged = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "update_speaker_notes",
          slideId: "slide_1",
          speakerNotes: deck.slides[0].speakerNotes,
        },
      ]),
    );
    const changed = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "update_speaker_notes",
          slideId: "slide_1",
          speakerNotes: "근거 문구가 변경된 발표자 노트",
        },
      ]),
    );

    expect(unchanged.deck.slides[0].semanticCues[0].freshness).toBe("current");
    expect(changed.deck.slides[0].semanticCues[0]).toMatchObject({
      reviewStatus: "approved",
      freshness: "stale",
    });
  });

  it("deletes an element and removes animations and actions targeting it", () => {
    const deck = createPatchTestDeck();

    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "cue",
          cue: "강조",
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_1",
        },
      },
    ];

    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "delete_element",
          slideId: "slide_1",
          elementId: "el_1",
        },
      ]),
    );

    expect(result.deck.slides[0].elements).toEqual([]);
    expect(result.deck.slides[0].animations).toEqual([]);
    expect(result.deck.slides[0].actions).toEqual([]);
  });

  it("removes deleted element references and keeps the deck schema valid", () => {
    const deck = createPatchTestDeck();
    deck.slides[0].semanticCues = [
      createSemanticCue({
        sourceRefs: [
          { kind: "element", refId: "el_1", sourceHash: "hash_el_1" },
        ],
        targetElementIds: ["el_1"],
      }),
    ];

    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "delete_element",
          slideId: "slide_1",
          elementId: "el_1",
        },
      ]),
    );

    expect(result.deck.slides[0].semanticCues[0]).toMatchObject({
      reviewStatus: "approved",
      freshness: "stale",
      targetElementIds: [],
      sourceRefs: [],
    });
  });

  it("applies theme, slide style, notes, animation, and slide action operations", () => {
    const result = applyPatchOrFail(
      createPatchTestDeck(),
      createPatch([
        {
          type: "update_theme",
          theme: {
            accentColor: "#ff0000",
            typography: {
              bodySize: 30,
            },
          },
        },
        {
          type: "update_slide_style",
          slideId: "slide_1",
          style: {
            layout: "quote",
            backgroundColor: "#f3f4f6",
          },
        },
        {
          type: "update_speaker_notes",
          slideId: "slide_1",
          speakerNotes: "Updated notes",
        },
        {
          type: "replace_keywords",
          slideId: "slide_1",
          keywords: [
            {
              keywordId: "kw_2",
              text: "패치",
              synonyms: [],
              abbreviations: [],
              required: true,
            },
          ],
        },
        {
          type: "add_animation",
          slideId: "slide_1",
          animation: {
            animationId: "anim_2",
            elementId: "el_1",
            type: "appear",
            order: 2,
            durationMs: 300,
            delayMs: 0,
            easing: "ease-out",
          },
        },
        {
          type: "update_animation",
          slideId: "slide_1",
          animationId: "anim_1",
          animation: {
            durationMs: 1000,
            startMode: "on-click",
          },
        },
        {
          type: "delete_animation",
          slideId: "slide_1",
          animationId: "anim_2",
        },
        {
          type: "add_slide_action",
          slideId: "slide_1",
          action: {
            actionId: "act_1",
            trigger: {
              kind: "cue",
              cue: "강조",
            },
            effect: {
              kind: "play-animation",
              animationId: "anim_1",
            },
          },
        },
        {
          type: "update_slide_action",
          slideId: "slide_1",
          actionId: "act_1",
          action: {
            trigger: {
              kind: "cue",
              cue: "다음",
            },
            effect: {
              kind: "go-to-next-slide",
            },
          },
        },
      ]),
    );
    const slide = result.deck.slides[0];

    expect(result.deck.theme.accentColor).toBe("#ff0000");
    expect(result.deck.theme.typography.bodySize).toBe(30);
    expect(slide.style.layout).toBe("quote");
    expect(slide.style.backgroundColor).toBe("#f3f4f6");
    expect(slide.speakerNotes).toBe("Updated notes");
    expect(slide.keywords).toEqual([
      {
        keywordId: "kw_2",
        text: "패치",
        synonyms: [],
        abbreviations: [],
        required: true,
      },
    ]);
    expect(slide.animations).toHaveLength(1);
    expect(slide.animations[0].durationMs).toBe(1000);
    expect(slide.actions).toEqual([
      {
        actionId: "act_1",
        trigger: {
          kind: "cue",
          cue: "다음",
        },
        effect: {
          kind: "go-to-next-slide",
        },
      },
    ]);
  });

  it("syncs a legacy canvas background when slide background color changes", () => {
    const deck = createPatchTestDeck();
    deck.slides[0].elements.push({
      elementId: "el_background",
      type: "rect",
      role: "background",
      x: 0,
      y: 0,
      width: deck.canvas.width,
      height: deck.canvas.height,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      locked: true,
      visible: true,
      props: {
        fill: "#ffffff",
        stroke: "transparent",
        strokeWidth: 0,
        borderRadius: 0,
      },
    });

    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "update_slide_style",
          slideId: "slide_1",
          style: { backgroundColor: "#0f172a" },
        },
      ]),
    );
    const slide = result.deck.slides[0];
    const background = slide.elements.find(
      (element) => element.elementId === "el_background",
    );

    expect(slide.style.backgroundColor).toBe("#0f172a");
    expect(background).toMatchObject({
      type: "rect",
      props: { fill: "#0f172a" },
    });
  });

  it("deletes slide actions that target a deleted animation", () => {
    const deck = createPatchTestDeck();

    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "cue",
          cue: "강조",
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_1",
        },
      },
    ];

    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "delete_animation",
          slideId: "slide_1",
          animationId: "anim_1",
        },
      ]),
    );

    expect(result.deck.slides[0].animations).toEqual([]);
    expect(result.deck.slides[0].actions).toEqual([]);
  });

  it("removes direct and cascading deleted action references", () => {
    const directDeck = createPatchTestDeck();
    directDeck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: { kind: "cue", cue: "강조" },
        effect: { kind: "go-to-next-slide" },
      },
    ];
    directDeck.slides[0].semanticCues = [
      createSemanticCue({ triggerActionIds: ["act_1"] }),
    ];
    const directResult = applyPatchOrFail(
      directDeck,
      createPatch([
        {
          type: "delete_slide_action",
          slideId: "slide_1",
          actionId: "act_1",
        },
      ]),
    );

    const cascadingDeck = createPatchTestDeck();
    cascadingDeck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: { kind: "cue", cue: "강조" },
        effect: { kind: "play-animation", animationId: "anim_1" },
      },
    ];
    cascadingDeck.slides[0].semanticCues = [
      createSemanticCue({ triggerActionIds: ["act_1"] }),
    ];
    const cascadingResult = applyPatchOrFail(
      cascadingDeck,
      createPatch([
        {
          type: "delete_animation",
          slideId: "slide_1",
          animationId: "anim_1",
        },
      ]),
    );

    for (const result of [directResult, cascadingResult]) {
      expect(result.deck.slides[0].semanticCues[0]).toMatchObject({
        freshness: "stale",
        triggerActionIds: [],
      });
    }
  });

  it("replays semantic content edits deterministically without mutating undo state", () => {
    const deck = createPatchTestDeck();
    deck.slides[0].semanticCues = [createSemanticCue()];
    const patch = createPatch([
      {
        type: "update_element_props",
        slideId: "slide_1",
        elementId: "el_1",
        props: { text: "재생 가능한 변경" },
      },
    ]);

    const first = applyPatchOrFail(deck, patch);
    const replay = applyPatchOrFail(deck, patch);

    expect(deck.slides[0].semanticCues[0].freshness).toBe("current");
    expect(first.deck).toEqual(replay.deck);
    expect(first.deck.slides[0].semanticCues[0].freshness).toBe("stale");
  });

  it("deletes keyword-triggered slide actions when the keyword is removed", () => {
    const deck = createPatchTestDeck();

    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "keyword",
          keywordId: "kw_1",
        },
        effect: {
          kind: "go-to-next-slide",
        },
      },
    ];

    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "replace_keywords",
          slideId: "slide_1",
          keywords: [],
        },
      ]),
    );

    expect(result.deck.slides[0].keywords).toEqual([]);
    expect(result.deck.slides[0].actions).toEqual([]);
  });

  it("replaces semantic cues with an independent slide-scoped copy", () => {
    const deck = createPatchTestDeck();
    deck.slides[0].semanticCues = [createSemanticCue({ cueId: "scue_old" })];
    const semanticCues = [
      createSemanticCue({
        cueId: "scue_new",
        meaning: "발표자는 교체된 핵심 메시지를 설명한다",
        revision: 2,
      }),
    ];

    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "replace_semantic_cues",
          slideId: "slide_1",
          semanticCues,
        },
      ]),
    );

    expect(result.deck.slides[0].semanticCues).toEqual(semanticCues);
    expect(result.changeRecord.operations[0]).toEqual({
      type: "replace_semantic_cues",
      slideId: "slide_1",
      semanticCues,
    });
    semanticCues[0].meaning = "호출자에서 변경된 문구";
    expect(result.deck.slides[0].semanticCues[0].meaning).toBe(
      "발표자는 교체된 핵심 메시지를 설명한다",
    );
  });

  it("fails when a semantic cue replacement targets a missing slide", () => {
    const result = applyDeckPatch(
      createPatchTestDeck(),
      createPatch([
        {
          type: "replace_semantic_cues",
          slideId: "slide_missing",
          semanticCues: [],
        },
      ]),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "SLIDE_NOT_FOUND",
      },
    });
  });

  it("fails when deckId does not match", () => {
    const result = applyDeckPatch(
      createPatchTestDeck(),
      createPatch(
        [
          {
            type: "update_deck",
            title: "Updated Deck",
          },
        ],
        1,
        "deck_other_1",
      ),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "DECK_ID_MISMATCH",
      },
    });
  });

  it("fails when patch payload validation fails", () => {
    const result = applyDeckPatch(createDemoDeck(), {
      deckId: "deck_demo_1",
      baseVersion: 1,
      source: "user",
      operations: [],
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "PATCH_VALIDATION_FAILED",
      },
    });
  });

  it("fails when baseVersion does not match current deck version", () => {
    const result = applyDeckPatch(
      createPatchTestDeck(),
      createPatch(
        [
          {
            type: "update_deck",
            title: "Updated Deck",
          },
        ],
        2,
      ),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "BASE_VERSION_MISMATCH",
      },
    });
  });

  it("fails when target slide does not exist", () => {
    const result = applyDeckPatch(
      createPatchTestDeck(),
      createPatch([
        {
          type: "update_slide",
          slideId: "slide_missing",
          title: "Missing",
        },
      ]),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "SLIDE_NOT_FOUND",
      },
    });
  });

  it("sets and clears a destination slide transition", () => {
    const deck = createPatchTestDeck();
    const setResult = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "update_slide_transition",
          slideId: "slide_1",
          transition: { type: "fade", durationMs: 700 }
        }
      ])
    );

    expect(setResult.deck.slides[0]?.transition).toEqual({
      type: "fade",
      durationMs: 700
    });

    const clearResult = applyPatchOrFail(setResult.deck, {
      ...createPatch([
        {
          type: "update_slide_transition",
          slideId: "slide_1",
          transition: null
        }
      ]),
      baseVersion: setResult.deck.version
    });

    expect(clearResult.deck.slides[0]?.transition).toBeUndefined();
  });

  it("rejects a slide action targeting a slide-entry animation chain", () => {
    const deck = createPatchTestDeck();
    deck.slides[0]!.animations[0]!.startMode = "on-slide-enter";
    const animationId = deck.slides[0]!.animations[0]!.animationId;
    const result = applyDeckPatch(
      deck,
      createPatch([
        {
          type: "add_slide_action",
          slideId: "slide_1",
          action: {
            actionId: "act_entry_animation",
            trigger: { kind: "cue", cue: "entry" },
            effect: { kind: "play-animation", animationId }
          }
        }
      ])
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "SLIDE_ACTION_ANIMATION_TIMING_INCOMPATIBLE"
      }
    });
  });

  it("fails when target element does not exist", () => {
    const result = applyDeckPatch(
      createPatchTestDeck(),
      createPatch([
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_missing",
          props: {
            text: "Missing",
          },
        },
      ]),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "ELEMENT_NOT_FOUND",
      },
    });
  });

  it("clears the composition focal reference when its element is deleted", () => {
    const deck = createPatchTestDeck();
    deck.slides[0]!.aiNotes = {
      emphasisPoints: [],
      sourceEvidence: [],
      compositionPlan: {
        compositionId: "editorial-split",
        variant: "light",
        backgroundMode: "light",
        focalType: "process-step",
        primaryFocalElementId: "el_1",
        assetRole: "none",
        requiredAsset: false,
      },
    };

    const result = applyPatchOrFail(
      deck,
      createPatch([
        {
          type: "delete_element",
          slideId: "slide_1",
          elementId: "el_1",
        },
        {
          type: "add_element",
          slideId: "slide_1",
          element: createTextElement("el_diagram_1"),
        },
      ]),
    );

    expect(
      result.deck.slides[0]?.aiNotes?.compositionPlan?.primaryFocalElementId,
    ).toBeUndefined();
  });

  it("fails when a slide action targets a missing animation", () => {
    const result = applyDeckPatch(
      createPatchTestDeck(),
      createPatch([
        {
          type: "add_slide_action",
          slideId: "slide_1",
          action: {
            actionId: "act_1",
            trigger: {
              kind: "cue",
              cue: "강조",
            },
            effect: {
              kind: "play-animation",
              animationId: "anim_missing",
            },
          },
        },
      ]),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "SLIDE_ACTION_ANIMATION_NOT_FOUND",
      },
    });
  });

  it("fails when the patched deck violates DeckSchema", () => {
    const result = applyDeckPatch(
      createPatchTestDeck(),
      createPatch([
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_1",
          props: { fontSize: -1 },
        },
      ]),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "DECK_VALIDATION_FAILED",
      },
    });
  });
});
