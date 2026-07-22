import { describe, expect, it } from "vitest";

import { deckSchema, deckShellSchema } from "./deck.schema";
import { createKeywordOccurrenceId } from "./keyword-occurrences";
import { deckChangeRecordSchema, deckPatchSchema } from "./patch.schema";

type DeckValidationInput = {
  deckId: string;
  projectId: string;
  title: string;
  version: number;
  targetDurationMinutes?: number;
  metadata: {
    language: string;
    locale: string;
    sourceType?: string;
    thumbnailSource?: string;
    generatedBy?: string;
    audience?: string;
    purpose?: string;
    tone?: string;
    presentationProfile?: string;
    generationQuality?: {
      status: string;
      issues: Array<{
        code: string;
        message: string;
        severity: string;
        slideId?: string;
        slideOrder?: number;
      }>;
    };
    designProgramSnapshot?: {
      version: string;
      visualConcept: string;
      paletteRoles: Record<string, string>;
      typography: {
        headingFont: string;
        bodyFont: string;
        typeScale: Record<string, number>;
      };
      backgroundSequence: string[];
      imageStyle: string;
      surfaceStyle: string;
      compositionIds: string[];
      designPackId?: string;
      designPackVersion?: number;
      selectionMode?: string;
      selectionReason?: string;
      selectionFallbackUsed?: boolean;
      layoutIds?: string[];
      layoutCatalogVersion?: number;
    };
    createdFrom?: {
      topic: string;
      references: Array<{ fileId: string }>;
      designReferences?: Array<{ fileId: string }>;
    };
  };
  canvas: {
    preset: string;
    width: number;
    height: number;
    aspectRatio: string;
  };
  slides: Array<{
    slideId: string;
    order: number;
    title: string;
    thumbnailUrl: string;
    estimatedSeconds?: number;
    transition?: {
      type: "fade";
      durationMs: number;
    };
    ooxmlSourceSlidePart?: string;
    style: Record<string, unknown>;
    speakerNotes: string;
    aiNotes?: {
      emphasisPoints: string[];
      sourceEvidence: Array<{
        fileId: string;
        quote?: string;
        note?: string;
        confidence: number;
      }>;
      visualPlan?: {
        visualType: string;
        imageNeeded: boolean;
        imageSourcePolicy: string;
        reason: string;
        imagePrompt?: string;
        imageAlt?: string;
        imagePlacement?: string;
        asset?: {
          fileId: string;
          provider: string;
          sourceUrl?: string;
          sourceAssetUrl?: string;
          sourceAuthority?: string;
          usageBasis?: string;
        };
      };
      sourceLedger?: Array<{
        claim: string;
        source: string;
        sourceType: string;
        sourceId?: string;
        fileId?: string;
        chunkId?: string;
        url?: string;
        title?: string;
        authority?: string;
        confidence: number;
        usedInSlideId: string;
      }>;
      typedMetrics?: Array<{
        value: string;
        unit: string;
        label: string;
        sourceRef: string;
      }>;
      timingPlan?: {
        charsPerMinute?: number;
        speakingTimeRatio?: number;
        targetTotalChars?: number;
        targetSlideCount?: number;
        targetSecondsPerSlide?: number;
        targetSpeakerNotesCharsPerSlide?: number;
        targetSeconds: number;
        targetSpokenSeconds?: number;
        targetSpeakerNotesChars: number;
        actualSpeakerNotesChars: number;
      };
      compositionPlan?: {
        compositionId: string;
        variant: string;
        backgroundMode: string;
        focalType: string;
        primaryFocalElementId?: string;
        assetRole: string;
        requiredAsset: boolean;
      };
    };
    keywords: Array<{
      keywordId: string;
      text: string;
      synonyms: string[];
      abbreviations: string[];
      required?: boolean;
      requiredOccurrenceIds?: string[];
    }>;
    elements: Array<Record<string, unknown>>;
    animations: Array<{
      animationId: string;
      elementId: string;
      type: string;
      order: number;
      startMode?:
        | "on-slide-enter"
        | "on-click"
        | "with-previous"
        | "after-previous";
      durationMs: number;
      delayMs: number;
      easing: string;
    }>;
    actions?: Array<{
      actionId: string;
      trigger:
        | {
            kind: "cue";
            cue: string;
          }
        | {
            kind: "keyword";
            keywordId: string;
          }
        | {
            kind: "keyword-occurrence";
            keywordId: string;
            occurrenceId: string;
          };
      effect:
        | {
            kind: "play-animation";
            animationId: string;
          }
        | {
            kind: "go-to-next-slide";
          };
    }>;
    semanticCues?: Array<{
      cueId: string;
      slideId: string;
      meaning: string;
      required: boolean;
      priority: 1 | 2 | 3;
      candidateKeywords: string[];
      aliases: Record<string, string[]>;
      requiredConcepts: string[];
      nliHypotheses: string[];
      negativeHints?: string[];
      targetElementIds?: string[];
      triggerActionIds?: string[];
      reviewStatus?: "suggested" | "approved" | "excluded";
      freshness?: "current" | "stale";
      sourceRefs?: Array<{
        kind:
          | "slide-title"
          | "speaker-notes"
          | "element"
          | "table"
          | "chart"
          | "image-analysis";
        refId?: string;
        sourceHash: string;
      }>;
    }>;
  }>;
};

const createValidDeck = (): DeckValidationInput => ({
  deckId: "deck_test_1",
  projectId: "project_test_1",
  title: "Test Deck",
  version: 1,
  metadata: {
    language: "ko",
    locale: "ko-KR"
  },
  canvas: {
    preset: "wide-16-9",
    width: 1920,
    height: 1080,
    aspectRatio: "16:9"
  },
  slides: [
    {
      slideId: "slide_1",
      order: 1,
      title: "Intro",
      thumbnailUrl: "",
      style: {},
      speakerNotes: "",
      keywords: [
        {
          keywordId: "kw_1",
          text: "ORBIT",
          synonyms: [],
          abbreviations: []
        }
      ],
      elements: [
        {
          elementId: "el_1",
          type: "text",
          role: "title",
          x: 120,
          y: 80,
          width: 640,
          height: 120,
          rotation: 0,
          opacity: 1,
          zIndex: 0,
          locked: false,
          visible: true,
          props: {
            text: "ORBIT"
          }
        }
      ],
      animations: [
        {
          animationId: "anim_1",
          elementId: "el_1",
          type: "fade-in",
          order: 1,
          durationMs: 400,
          delayMs: 0,
          easing: "ease-out"
        }
      ],
      actions: []
    }
  ]
});

const createValidPatch = () => ({
  deckId: "deck_test_1",
  baseVersion: 1,
  source: "user",
  operations: [
    {
      type: "update_deck",
      title: "Updated Deck"
    }
  ]
});

const createValidChangeRecord = () => ({
  changeId: "change_1",
  deckId: "deck_test_1",
  beforeVersion: 1,
  afterVersion: 2,
  source: "user",
  createdAt: "2026-06-27T01:00:00+09:00",
  operations: [
    {
      type: "update_deck",
      title: "Updated Deck"
    }
  ]
});

const expectValidDeck = (deck: unknown) => {
  expect(deckSchema.safeParse(deck).success).toBe(true);
};

const expectInvalidDeck = (deck: unknown) => {
  expect(deckSchema.safeParse(deck).success).toBe(false);
};

describe("deckSchema validation", () => {
  it("accepts a 1920x1080 wide-16-9 deck", () => {
    expectValidDeck(createValidDeck());
  });

  it("accepts finite element coordinates outside the canvas", () => {
    const deck = createValidDeck();
    deck.slides[0].elements[0].x = -240;
    deck.slides[0].elements[0].y = -80;

    expectValidDeck(deck);
  });

  it("rejects element coordinates outside the supported absolute range", () => {
    const positiveDeck = createValidDeck();
    positiveDeck.slides[0].elements[0].x = 1_000_001;
    const negativeDeck = createValidDeck();
    negativeDeck.slides[0].elements[0].y = -1_000_001;

    expectInvalidDeck(positiveDeck);
    expectInvalidDeck(negativeDeck);
  });

  it("projects a deck shell without slide validation state", () => {
    const shell = deckShellSchema.parse(createValidDeck());

    expect(shell).not.toHaveProperty("slides");
    expect(shell.deckId).toBe("deck_test_1");
  });

  it("accepts a program-v2 design snapshot and composition plan", () => {
    const deck = createValidDeck();
    deck.metadata.designProgramSnapshot = {
      version: "program-v2",
      visualConcept: "Energetic ink launch",
      paletteRoles: { dominant: "#FFFFFF", focal: "#6D28D9" },
      typography: {
        headingFont: "Pretendard",
        bodyFont: "Pretendard",
        typeScale: { title: 56, body: 22 }
      },
      backgroundSequence: ["dark"],
      imageStyle: "Official game imagery with crisp crops",
      surfaceStyle: "Flat color fields",
      compositionIds: ["hero-split"]
    };
    deck.slides[0].aiNotes = {
      emphasisPoints: [],
      sourceEvidence: [],
      compositionPlan: {
        compositionId: "hero-split",
        variant: "dark",
        backgroundMode: "dark",
        focalType: "hero-image",
        primaryFocalElementId: "el_1",
        assetRole: "evidence",
        requiredAsset: true
      }
    };

    expectValidDeck(deck);
  });

  it("accepts optional system design pack provenance in a program snapshot", () => {
    const deck = createValidDeck();
    deck.metadata.designProgramSnapshot = {
      version: "program-v2",
      visualConcept: "Neutral Korean report",
      paletteRoles: { dominant: "#FFFFFF", focal: "#2563EB" },
      typography: {
        headingFont: "Pretendard",
        bodyFont: "Pretendard",
        typeScale: { title: 56, body: 22 }
      },
      backgroundSequence: ["light"],
      imageStyle: "Optional evidence media",
      surfaceStyle: "Flat neutral surfaces",
      compositionIds: ["editorial-split"],
      designPackId: "neutral-light",
      designPackVersion: 1,
      selectionMode: "auto",
      selectionReason: "deterministic-compatible-match",
      selectionFallbackUsed: false,
      layoutIds: ["neutral-content-01"],
      layoutCatalogVersion: 1
    };

    expectValidDeck(deck);
  });

  it("accepts a grounded typed metric in slide AI notes", () => {
    const deck = createValidDeck();
    deck.slides[0].aiNotes = {
      emphasisPoints: [],
      sourceEvidence: [],
      sourceLedger: [
        {
          claim: "전환율은 42%입니다",
          source: "사용자 입력",
          sourceType: "topic",
          sourceId: "topic:brief",
          confidence: 1,
          usedInSlideId: deck.slides[0].slideId
        }
      ],
      typedMetrics: [
        {
          value: "42",
          unit: "%",
          label: "전환율",
          sourceRef: "topic:brief"
        }
      ]
    };

    expectValidDeck(deck);
  });

  it("rejects a composition plan whose focal element is missing", () => {
    const deck = createValidDeck();
    deck.slides[0].aiNotes = {
      emphasisPoints: [],
      sourceEvidence: [],
      compositionPlan: {
        compositionId: "hero-split",
        variant: "light",
        backgroundMode: "light",
        focalType: "hero-image",
        primaryFocalElementId: "el_missing",
        assetRole: "evidence",
        requiredAsset: true
      }
    };

    expectInvalidDeck(deck);
  });

  it("accepts decks with more than 20 editor-managed slides", () => {
    const deck = createValidDeck();
    const templateSlide = deck.slides[0];

    deck.slides = Array.from({ length: 21 }, (_, index) => ({
      ...templateSlide,
      slideId: `slide_${index + 1}`,
      order: index + 1,
      title: `Slide ${index + 1}`,
      elements: templateSlide.elements.map((element) => ({
        ...element,
        elementId: `el_${index + 1}`
      })),
      animations: [],
      actions: []
    }));

    expect(deckSchema.parse(deck).slides).toHaveLength(21);
  });

  it("defaults deck targetDurationMinutes to the generation request default", () => {
    const deck = deckSchema.parse(createValidDeck());

    expect(deck.targetDurationMinutes).toBe(10);
  });

  it("defaults slide actions to an empty list", () => {
    const deck = createValidDeck();

    delete deck.slides[0].actions;

    const result = deckSchema.parse(deck);

    expect(result.slides[0].actions).toEqual([]);
  });

  it("defaults slide semantic cues to an empty list", () => {
    const result = deckSchema.parse(createValidDeck());

    expect(result.slides[0].semanticCues).toEqual([]);
  });

  it("accepts semantic cues that reference slide elements and actions", () => {
    const deck = createValidDeck();

    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "cue",
          cue: "CAC"
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_1"
        }
      }
    ];
    deck.slides[0].semanticCues = [
      {
        cueId: "scue_1",
        slideId: "slide_1",
        meaning: "CAC가 높은 원인은 초기 영업 비용입니다",
        required: true,
        priority: 1,
        candidateKeywords: ["CAC", "영업 비용"],
        aliases: {
          CAC: ["고객 획득 비용"]
        },
        requiredConcepts: ["초기 영업 비용", "고객 획득 비용"],
        nliHypotheses: ["고객 획득 비용이 초기 영업 비용 때문에 높다"],
        negativeHints: ["CAC가 단순히 중요하다는 설명"],
        targetElementIds: ["el_1"],
        triggerActionIds: ["act_1"]
      }
    ];

    const result = deckSchema.parse(deck);

    expect(result.slides[0].semanticCues[0]?.nliHypotheses).toHaveLength(1);
    expect(result.slides[0].semanticCues[0]).toMatchObject({
      importance: "supporting",
      reviewStatus: "suggested",
      freshness: "current",
      origin: "imported",
      revision: 1
    });
  });

  it("rejects semantic cue references outside the same slide", () => {
    const deck = createValidDeck();

    deck.slides[0].semanticCues = [
      {
        cueId: "scue_1",
        slideId: "slide_other",
        meaning: "의미 단위",
        required: true,
        priority: 1,
        candidateKeywords: ["CAC"],
        aliases: {},
        requiredConcepts: ["초기 영업 비용"],
        nliHypotheses: ["CAC가 초기 영업 비용 때문에 높다"],
        targetElementIds: ["el_missing"],
        triggerActionIds: ["act_missing"]
      }
    ];

    expectInvalidDeck(deck);
  });

  it("accepts an approved stale cue after element and action references are removed", () => {
    const deck = createValidDeck();
    deck.slides[0].semanticCues = [
      {
        cueId: "scue_1",
        slideId: "slide_1",
        meaning: "발표자는 핵심 원인을 설명한다",
        required: true,
        priority: 1,
        candidateKeywords: ["원인"],
        aliases: {},
        requiredConcepts: ["핵심 원인"],
        nliHypotheses: ["발표자는 핵심 원인을 설명했다"],
        targetElementIds: [],
        triggerActionIds: [],
        sourceRefs: [],
        reviewStatus: "approved",
        freshness: "stale"
      }
    ];

    expectValidDeck(deck);
  });

  it("accepts explicit deck and slide presenter timing fields", () => {
    const deck = createValidDeck();

    deck.targetDurationMinutes = 20;
    deck.slides[0].estimatedSeconds = 90;

    const result = deckSchema.parse(deck);

    expect(result.targetDurationMinutes).toBe(20);
    expect(result.slides[0].estimatedSeconds).toBe(90);
  });

  it("accepts persisted advisory generation quality reasons", () => {
    const deck = createValidDeck();
    deck.metadata.generationQuality = {
      status: "advisory",
      issues: [
        {
          code: "IMAGE_CROP_WEAK",
          message: "The focal subject is cropped too tightly.",
          severity: "warning",
          slideId: "slide_1",
          slideOrder: 1,
        },
      ],
    };

    expect(deckSchema.parse(deck).metadata.generationQuality?.issues).toHaveLength(1);
  });

  it("accepts cue-driven slide actions", () => {
    const deck = createValidDeck();

    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "cue",
          cue: "강조"
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_1"
        }
      },
      {
        actionId: "act_2",
        trigger: {
          kind: "cue",
          cue: "다음"
        },
        effect: {
          kind: "go-to-next-slide"
        }
      }
    ];

    expectValidDeck(deck);
  });

  it("accepts keyword-triggered slide actions", () => {
    const deck = createValidDeck();

    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "keyword",
          keywordId: "kw_1"
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_1"
        }
      }
    ];

    expectValidDeck(deck);
  });

  it("accepts keyword occurrence-triggered slide actions", () => {
    const deck = createValidDeck();

    deck.slides[0].speakerNotes = "ORBIT 다시 ORBIT";
    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "keyword-occurrence",
          keywordId: "kw_1",
          occurrenceId: "kwo_slide_1_kw_1_9_14"
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_1"
        }
      }
    ];

    expectValidDeck(deck);
  });

  it("accepts keyword occurrence actions from case-insensitive speaker note matches", () => {
    const deck = createValidDeck();

    deck.slides[0].speakerNotes = "ai 흐름을 설명합니다.";
    deck.slides[0].keywords = [
      {
        keywordId: "kw_1",
        text: "AI",
        synonyms: [],
        abbreviations: []
      }
    ];
    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "keyword-occurrence",
          keywordId: "kw_1",
          occurrenceId: createKeywordOccurrenceId("slide_1", "kw_1", 0, 2)
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_1"
        }
      }
    ];

    expectValidDeck(deck);
  });

  it("accepts keyword occurrence actions from synonym and abbreviation matches", () => {
    const deck = createValidDeck();

    deck.slides[0].speakerNotes = "발표 도우미와 OBT를 소개합니다.";
    deck.slides[0].keywords = [
      {
        keywordId: "kw_1",
        text: "ORBIT",
        synonyms: ["발표 도우미"],
        abbreviations: ["OBT"]
      }
    ];
    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "keyword-occurrence",
          keywordId: "kw_1",
          occurrenceId: createKeywordOccurrenceId("slide_1", "kw_1", 0, 6)
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_1"
        }
      },
      {
        actionId: "act_2",
        trigger: {
          kind: "keyword-occurrence",
          keywordId: "kw_1",
          occurrenceId: createKeywordOccurrenceId("slide_1", "kw_1", 8, 11)
        },
        effect: {
          kind: "go-to-next-slide"
        }
      }
    ];

    expectValidDeck(deck);
  });

  it("accepts required keyword occurrence IDs from speaker notes", () => {
    const deck = createValidDeck();

    deck.slides[0].speakerNotes = "ORBIT 다시 ORBIT";
    deck.slides[0].keywords[0].required = true;
    deck.slides[0].keywords[0].requiredOccurrenceIds = [
      createKeywordOccurrenceId("slide_1", "kw_1", 9, 14)
    ];

    expectValidDeck(deck);
  });

  it("rejects required keyword occurrence IDs that target missing occurrences", () => {
    const deck = createValidDeck();

    deck.slides[0].speakerNotes = "ORBIT 다시 ORBIT";
    deck.slides[0].keywords[0].required = true;
    deck.slides[0].keywords[0].requiredOccurrenceIds = [
      createKeywordOccurrenceId("slide_1", "kw_1", 20, 25)
    ];

    expectInvalidDeck(deck);
  });

  it("rejects required keyword occurrence IDs with mismatched keyword IDs", () => {
    const deck = createValidDeck();

    deck.slides[0].speakerNotes = "ORBIT AI";
    deck.slides[0].keywords = [
      {
        keywordId: "kw_1",
        text: "ORBIT",
        synonyms: [],
        abbreviations: [],
        required: true,
        requiredOccurrenceIds: [
          createKeywordOccurrenceId("slide_1", "kw_2", 6, 8)
        ]
      },
      {
        keywordId: "kw_2",
        text: "AI",
        synonyms: [],
        abbreviations: []
      }
    ];

    expectInvalidDeck(deck);
  });

  it("rejects keyword occurrence-triggered slide actions that target missing keywords", () => {
    const deck = createValidDeck();

    deck.slides[0].speakerNotes = "ORBIT 다시 ORBIT";
    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "keyword-occurrence",
          keywordId: "kw_missing",
          occurrenceId: "kwo_slide_1_kw_missing_9_14"
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_1"
        }
      }
    ];

    expectInvalidDeck(deck);
  });

  it("rejects keyword occurrence-triggered slide actions that target missing occurrences", () => {
    const deck = createValidDeck();

    deck.slides[0].speakerNotes = "ORBIT 다시 ORBIT";
    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "keyword-occurrence",
          keywordId: "kw_1",
          occurrenceId: "kwo_slide_1_kw_1_20_25"
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_1"
        }
      }
    ];

    expectInvalidDeck(deck);
  });

  it("rejects keyword occurrence-triggered slide actions with mismatched keyword IDs", () => {
    const deck = createValidDeck();

    deck.slides[0].speakerNotes = "ORBIT AI";
    deck.slides[0].keywords = [
      {
        keywordId: "kw_1",
        text: "ORBIT",
        synonyms: [],
        abbreviations: []
      },
      {
        keywordId: "kw_2",
        text: "AI",
        synonyms: [],
        abbreviations: []
      }
    ];
    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "keyword-occurrence",
          keywordId: "kw_1",
          occurrenceId: "kwo_slide_1_kw_2_6_8"
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_1"
        }
      }
    ];

    expectInvalidDeck(deck);
  });

  it("rejects slide actions that target missing animations", () => {
    const deck = createValidDeck();

    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "cue",
          cue: "강조"
        },
        effect: {
          kind: "play-animation",
          animationId: "anim_missing"
        }
      }
    ];

    expectInvalidDeck(deck);
  });

  it("rejects keyword-triggered slide actions that target missing keywords", () => {
    const deck = createValidDeck();

    deck.slides[0].actions = [
      {
        actionId: "act_1",
        trigger: {
          kind: "keyword",
          keywordId: "kw_missing"
        },
        effect: {
          kind: "go-to-next-slide"
        }
      }
    ];

    expectInvalidDeck(deck);
  });

  it.each([0, -1, 1.5])(
    "rejects invalid slide estimatedSeconds value %s",
    (estimatedSeconds) => {
      const deck = createValidDeck();

      deck.slides[0].estimatedSeconds = estimatedSeconds;

      expectInvalidDeck(deck);
    }
  );

  it("accepts image crop focus controls", () => {
    const deck = createValidDeck();

    deck.slides[0].elements[0] = {
      elementId: "el_1",
      type: "image",
      role: "media",
      x: 120,
      y: 80,
      width: 640,
      height: 360,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      locked: false,
      visible: true,
      props: {
        alt: "Hero",
        fit: "cover",
        focusX: 0.25,
        focusY: 0.75,
        src: "/hero.png"
      }
    };

    expectValidDeck(deck);
  });

  it("accepts editable SVG media elements", () => {
    const deck = createValidDeck();

    deck.slides[0].elements[0] = {
      elementId: "el_1",
      type: "svg",
      role: "media",
      x: 120,
      y: 80,
      width: 320,
      height: 180,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      locked: false,
      visible: true,
      props: {
        alt: "Vector logo",
        fit: "stretch",
        focusX: 0.5,
        focusY: 0.5,
        src: "/logo.svg"
      }
    };

    expectValidDeck(deck);
  });

  it("accepts editable pattern fill props", () => {
    const deck = createValidDeck();

    deck.slides[0].elements[0] = {
      ...deck.slides[0].elements[0],
      type: "rect",
      role: "decoration",
      props: {
        fill: {
          type: "pattern",
          preset: "pct20",
          foreground: "#111827",
          background: "#F59E0B"
        },
        stroke: "transparent",
        strokeWidth: 0
      }
    };

    expectValidDeck(deck);
  });

  it("accepts high fidelity PPTX visual props", () => {
    const deck = createValidDeck();

    deck.slides[0].elements = [
      {
        elementId: "el_text",
        type: "text",
        role: "title",
        x: 120,
        y: 80,
        width: 640,
        height: 120,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        locked: false,
        visible: true,
        props: {
          text: "Hello World",
          runs: [
            {
              text: "Hello ",
              fontFamily: "Aptos",
              fontSize: 36,
              fontWeight: "bold",
              color: "#111827"
            },
            {
              text: "World",
              fontFamily: "Aptos",
              fontSize: 36,
              fontWeight: "normal",
              color: "#2563eb"
            }
          ],
          paragraphs: [
            {
              text: "Hello World",
              runs: [
                {
                  text: "Hello ",
                  fontFamily: "Aptos",
                  fontSize: 36,
                  fontWeight: "bold",
                  color: "#111827"
                },
                {
                  text: "World",
                  fontFamily: "Aptos",
                  fontSize: 36,
                  fontWeight: "normal",
                  color: "#2563eb"
                }
              ],
              align: "left",
              lineHeight: 1.15,
              spaceBefore: 0,
              spaceAfter: 8,
              indent: 12
            }
          ],
          bodyInset: {
            left: 14,
            right: 14,
            top: 7,
            bottom: 7
          },
          writingMode: "vertical-270",
          bullet: {
            enabled: true,
            character: "\u2022",
            indent: 24
          }
        }
      },
      {
        elementId: "el_shape",
        type: "rect",
        role: "decoration",
        x: 80,
        y: 240,
        width: 400,
        height: 180,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        locked: false,
        visible: true,
        props: {
          fill: {
            type: "linear-gradient",
            angle: 90,
            stops: [
              { offset: 0, color: "#2563eb", opacity: 1 },
              { offset: 1, color: "#7c3aed", opacity: 0.75 }
            ]
          },
          stroke: "#111827",
          strokeWidth: 2,
          dash: [8, 4],
          lineCap: "round",
          lineJoin: "round"
        }
      },
      {
        elementId: "el_image",
        type: "image",
        role: "media",
        x: 520,
        y: 240,
        width: 320,
        height: 180,
        rotation: 0,
        opacity: 1,
        zIndex: 2,
        locked: false,
        visible: true,
        props: {
          src: "/image.png",
          fit: "stretch",
          crop: {
            left: 0.1,
            top: 0.05,
            right: 0.2,
            bottom: 0.15
          }
        }
      }
    ];

    expectValidDeck(deck);
  });

  it("does not materialize rich text style defaults in a legacy plain text deck", () => {
    const parsed = deckSchema.parse(createValidDeck());
    const element = parsed.slides[0].elements[0];

    expect(element?.type).toBe("text");
    if (!element || element.type !== "text") {
      throw new Error("expected a text element");
    }

    expect(parsed.version).toBe(1);
    expect(element.props).toEqual({
      text: "ORBIT",
      fontSize: 24,
      fontWeight: "normal",
      align: "left",
      verticalAlign: "top",
      lineHeight: 1.2
    });
    expect(element.props).not.toHaveProperty("italic");
    expect(element.props).not.toHaveProperty("underline");
  });

  it("preserves mixed italic and underline styles through Deck serialization", () => {
    const deck = createValidDeck();
    const runs = [
      {
        text: "Bold italic",
        fontWeight: "bold",
        italic: true,
        underline: false,
        color: "#111827"
      },
      {
        text: " and underlined",
        fontWeight: "normal",
        italic: false,
        underline: true,
        color: "#2563EB"
      }
    ];
    deck.slides[0].elements[0] = {
      ...deck.slides[0].elements[0],
      props: {
        text: "Bold italic and underlined",
        runs,
        paragraphs: [
          {
            text: "Bold italic and underlined",
            runs,
            italic: true,
            underline: false
          }
        ],
        italic: false,
        underline: true
      }
    };

    const parsed = deckSchema.parse(deck);
    const reparsed = deckSchema.parse(JSON.parse(JSON.stringify(parsed)));
    const element = reparsed.slides[0].elements[0];

    expect(element?.type).toBe("text");
    if (!element || element.type !== "text") {
      throw new Error("expected a text element");
    }

    expect(reparsed).toEqual(parsed);
    expect(reparsed.version).toBe(deck.version);
    expect(element.props).toMatchObject({
      italic: false,
      underline: true,
      runs: [
        { italic: true, underline: false },
        { italic: false, underline: true }
      ],
      paragraphs: [
        {
          italic: true,
          underline: false,
          runs: [
            { italic: true, underline: false },
            { italic: false, underline: true }
          ]
        }
      ]
    });
  });

  it("accepts canonical single and multi-paragraph text projections", () => {
    const singleParagraphDeck = createValidDeck();
    const mirroredRuns = [
      { text: "Single ", italic: true },
      { text: "paragraph", underline: true }
    ];
    singleParagraphDeck.slides[0].elements[0] = {
      ...singleParagraphDeck.slides[0].elements[0],
      props: {
        text: "Single paragraph",
        runs: mirroredRuns,
        paragraphs: [
          {
            text: "Single paragraph",
            runs: mirroredRuns
          }
        ]
      }
    };

    const singleParsed = deckSchema.parse(singleParagraphDeck);
    const singleElement = singleParsed.slides[0].elements[0];
    expect(singleElement?.type).toBe("text");
    if (!singleElement || singleElement.type !== "text") {
      throw new Error("expected a text element");
    }
    expect(singleElement.props.runs).toEqual(
      singleElement.props.paragraphs?.[0]?.runs
    );

    const multiParagraphDeck = createValidDeck();
    multiParagraphDeck.slides[0].elements[0] = {
      ...multiParagraphDeck.slides[0].elements[0],
      props: {
        text: "First paragraph\nSecond paragraph",
        paragraphs: [
          {
            text: "First paragraph",
            runs: [
              { text: "First ", italic: true },
              { text: "paragraph", underline: true }
            ]
          },
          {
            text: "Second paragraph"
          }
        ]
      }
    };

    const multiParsed = deckSchema.parse(multiParagraphDeck);
    const multiElement = multiParsed.slides[0].elements[0];
    expect(multiElement?.type).toBe("text");
    if (!multiElement || multiElement.type !== "text") {
      throw new Error("expected a text element");
    }

    const paragraphProjection = multiElement.props.paragraphs
      ?.map((paragraph) =>
        paragraph.runs?.length
          ? paragraph.runs.map((run) => run.text).join("")
          : paragraph.text
      )
      .join("\n");
    expect(multiElement.props.text).toBe(paragraphProjection);
    expect(multiElement.props.runs).toBeUndefined();
    expect(multiParsed.version).toBe(multiParagraphDeck.version);
  });

  it("keeps legacy runs-only text valid until an edit commit normalizes it", () => {
    const deck = createValidDeck();
    deck.slides[0].elements[0] = {
      ...deck.slides[0].elements[0],
      props: {
        text: "Legacy runs",
        runs: [
          { text: "Legacy ", italic: true },
          { text: "runs", underline: true }
        ]
      }
    };

    const parsed = deckSchema.parse(deck);
    const element = parsed.slides[0].elements[0];

    expect(element?.type).toBe("text");
    if (!element || element.type !== "text") {
      throw new Error("expected a text element");
    }

    expect(element.props.paragraphs).toBeUndefined();
    expect(element.props.runs?.map((run) => run.text).join("")).toBe(
      element.props.text
    );
    expect(parsed.version).toBe(deck.version);
  });

  it("accepts a 1024x768 standard-4-3 deck", () => {
    const deck = createValidDeck();

    deck.canvas = {
      preset: "standard-4-3",
      width: 1024,
      height: 768,
      aspectRatio: "4:3"
    };

    expectValidDeck(deck);
  });

  it.each([
    ["x", Number.NaN],
    ["y", Number.POSITIVE_INFINITY],
    ["width", 0],
    ["height", 0]
  ])("rejects invalid element %s", (field, value) => {
    const deck = createValidDeck();

    deck.slides[0].elements[0] = {
      ...deck.slides[0].elements[0],
      [field]: value
    };

    expectInvalidDeck(deck);
  });

  it.each(["shape", "video", "unknown"])(
    "rejects unsupported object type %s",
    (type) => {
      const deck = createValidDeck();

      deck.slides[0].elements[0] = {
        ...deck.slides[0].elements[0],
        type,
        props: {}
      };

      expectInvalidDeck(deck);
    }
  );

  it.each(["area", "radar"])("rejects unsupported chart type %s", (type) => {
    const deck = createValidDeck();

    deck.slides[0].elements[0] = {
      ...deck.slides[0].elements[0],
      type: "chart",
      props: {
        type,
        data: []
      }
    };

    expectInvalidDeck(deck);
  });

  it("accepts an empty supported chart", () => {
    const deck = createValidDeck();

    deck.slides[0].elements[0] = {
      ...deck.slides[0].elements[0],
      type: "chart",
      props: {
        type: "bar",
        data: []
      }
    };

    expectValidDeck(deck);
  });

  it("accepts an editable table element", () => {
    const deck = createValidDeck();

    deck.slides[0].elements[0] = {
      ...deck.slides[0].elements[0],
      type: "table",
      role: "table",
      props: {
        rows: [
          [
            { text: "A", fill: "#EFF6FF", borderColor: "#93C5FD" },
            { text: "B", fill: "#EFF6FF", borderColor: "#93C5FD" }
          ],
          [
            { text: "C", borderColor: "#CBD5E1" },
            { text: "D", borderColor: "#CBD5E1" }
          ]
        ],
        columnWidths: [240, 240],
        rowHeights: [80, 80],
        borderColor: "#CBD5E1",
        borderWidth: 1
      }
    };

    expectValidDeck(deck);
  });

  it("accepts a custom shape with typed path editing props", () => {
    const deck = createValidDeck();

    deck.slides[0].elements[0] = {
      ...deck.slides[0].elements[0],
      type: "customShape",
      props: {
        pathData:
          "M 20 20 L 200 20 L 200 100 L 92 100 L 48 148 L 56 100 L 20 100 Z",
        viewBoxWidth: 220,
        viewBoxHeight: 160,
        fill: "#f5edff",
        stroke: "#9333ea",
        strokeWidth: 2,
        closed: true,
        nodes: [
          { x: 20, y: 20, mode: "corner" },
          { x: 200, y: 20, mode: "corner" },
          { x: 200, y: 100, mode: "corner" },
          { x: 92, y: 100, mode: "corner" },
          { x: 48, y: 148, mode: "corner" },
          { x: 56, y: 100, mode: "corner" },
          { x: 20, y: 100, mode: "corner" }
        ]
      }
    };

    expectValidDeck(deck);
  });

  it("rejects a custom shape without pathData", () => {
    const deck = createValidDeck();

    deck.slides[0].elements[0] = {
      ...deck.slides[0].elements[0],
      type: "customShape",
      props: {
        viewBoxWidth: 220,
        viewBoxHeight: 160,
        closed: true,
        nodes: []
      }
    };

    expectInvalidDeck(deck);
  });

  it("rejects negative radial chart values", () => {
    const deck = createValidDeck();

    deck.slides[0].elements[0] = {
      ...deck.slides[0].elements[0],
      type: "chart",
      props: {
        type: "pie",
        data: [
          {
            label: "Loss",
            value: -1
          }
        ]
      }
    };

    expectInvalidDeck(deck);
  });

  it("rejects scatter chart data without x and y", () => {
    const deck = createValidDeck();

    deck.slides[0].elements[0] = {
      ...deck.slides[0].elements[0],
      type: "chart",
      props: {
        type: "scatter",
        data: [
          {
            label: "Point",
            value: 10
          }
        ]
      }
    };

    expectInvalidDeck(deck);
  });

  it("rejects unsupported canvas preset", () => {
    const deck = createValidDeck();

    deck.canvas = {
      preset: "portrait-9-16",
      width: 1080,
      height: 1920,
      aspectRatio: "9:16"
    };

    expectInvalidDeck(deck);
  });

  it("rejects unsupported canvas size", () => {
    const deck = createValidDeck();

    deck.canvas = {
      preset: "wide-16-9",
      width: 1280,
      height: 720,
      aspectRatio: "16:9"
    };

    expectInvalidDeck(deck);
  });

  it("rejects mismatched canvas preset and aspect ratio", () => {
    const deck = createValidDeck();

    deck.canvas = {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "4:3"
    };

    expectInvalidDeck(deck);
  });

  it("rejects unsupported metadata language", () => {
    const deck = createValidDeck();

    deck.metadata.language = "en";

    expectInvalidDeck(deck);
  });

  it("rejects unsupported metadata locale", () => {
    const deck = createValidDeck();

    deck.metadata.locale = "en-US";

    expectInvalidDeck(deck);
  });

  it("accepts AI metadata and slide notes on generated decks", () => {
    const deck = createValidDeck();

    deck.metadata = {
      ...deck.metadata,
      sourceType: "ai",
      generatedBy: "ai",
      audience: "technical",
      purpose: "inform",
      tone: "professional",
      presentationProfile: "technical",
      createdFrom: {
        topic: "AI 발표 자동화",
        references: [{ fileId: "file_1" }]
      }
    };
    deck.slides[0].aiNotes = {
      emphasisPoints: ["근거 기반 메시지"],
      sourceEvidence: [
        {
          fileId: "file_1",
          quote: "reference",
          confidence: 0.8
        }
      ],
      visualPlan: {
        visualType: "diagram",
        imageNeeded: false,
        imageSourcePolicy: "minimal",
        reason: "Shapes and typography explain the message.",
        imagePrompt: "A precise system diagram with a clear focal flow",
        imageAlt: "System flow diagram",
        imagePlacement: "right",
        asset: {
          fileId: "file_official_1",
          provider: "official-web",
          sourceUrl: "https://official.example/game",
          sourceAssetUrl: "https://official.example/key-art.png",
          sourceAuthority: "official",
          usageBasis: "official-reference"
        }
      },
      sourceLedger: [
        {
          claim: "evidence-based message",
          source: "file_1",
          sourceType: "uploaded",
          sourceId: "uploaded:file_1:chunk_1",
          fileId: "file_1",
          chunkId: "chunk_1",
          confidence: 0.8,
          usedInSlideId: deck.slides[0].slideId
        },
        {
          claim: "published evidence",
          source: "https://example.com/report",
          sourceType: "web",
          sourceId: "web:https://example.com/report",
          url: "https://example.com/report",
          title: "Example report",
          authority: "independent",
          confidence: 0.9,
          usedInSlideId: deck.slides[0].slideId
        }
      ],
      timingPlan: {
        charsPerMinute: 260,
        speakingTimeRatio: 0.8,
        targetTotalChars: 2080,
        targetSlideCount: 10,
        targetSecondsPerSlide: 60,
        targetSpeakerNotesCharsPerSlide: 208,
        targetSeconds: 60,
        targetSpokenSeconds: 48,
        targetSpeakerNotesChars: 208,
        actualSpeakerNotesChars: 201
      }
    };

    expectValidDeck(deck);
    expect(deckSchema.parse(deck).slides[0].aiNotes?.visualPlan).toMatchObject({
      imagePrompt: "A precise system diagram with a clear focal flow",
      imageAlt: "System flow diagram",
      imagePlacement: "right",
      asset: expect.objectContaining({
        sourceAuthority: "official",
        usageBasis: "official-reference"
      })
    });
  });

  it("defaults AI metadata design references to an empty list", () => {
    const deck = createValidDeck();

    deck.metadata = {
      ...deck.metadata,
      sourceType: "ai",
      generatedBy: "ai",
      createdFrom: {
        topic: "AI design reference",
        references: []
      }
    };

    const result = deckSchema.parse(deck);

    expect(result.metadata.createdFrom?.designReferences).toEqual([]);
  });

  it("keeps historical AI metadata design references readable", () => {
    const deck = createValidDeck();

    deck.metadata = {
      ...deck.metadata,
      sourceType: "ai",
      generatedBy: "ai",
      createdFrom: {
        topic: "Historical AI design reference",
        references: [],
        designReferences: [{ fileId: "file_design_legacy" }]
      }
    };

    expect(
      deckSchema.parse(deck).metadata.createdFrom?.designReferences
    ).toEqual([{ fileId: "file_design_legacy" }]);
  });

  it("accepts every supported AI presentation profile", () => {
    for (const presentationProfile of [
      "proposal",
      "executive-report",
      "product-launch",
      "education",
      "technical",
      "research",
      "general-inform"
    ]) {
      const deck = createValidDeck();
      deck.metadata.presentationProfile = presentationProfile;

      expect(deckSchema.parse(deck).metadata.presentationProfile).toBe(
        presentationProfile
      );
    }
  });

  it("keeps presentation profile optional for existing decks", () => {
    expect(
      deckSchema.parse(createValidDeck()).metadata.presentationProfile
    ).toBeUndefined();
  });

  it("accepts imported deck thumbnail source metadata", () => {
    const deck = createValidDeck();

    deck.metadata = {
      ...deck.metadata,
      sourceType: "import",
      thumbnailSource: "import-render"
    };

    expectValidDeck(deck);
  });

  it("rejects empty and duplicate slide keyword terms", () => {
    const deck = createValidDeck();

    deck.slides[0].keywords = [
      {
        keywordId: "kw_1",
        text: "ORBIT",
        synonyms: ["발표 도우미", ""],
        abbreviations: ["OD"]
      },
      {
        keywordId: "kw_2",
        text: "orbit",
        synonyms: ["발표 도우미"],
        abbreviations: ["od"]
      }
    ];

    expectInvalidDeck(deck);
  });

  it("rejects slide keyword terms duplicated across keyword types", () => {
    const deck = createValidDeck();

    deck.slides[0].keywords = [
      {
        keywordId: "kw_1",
        text: "ORBIT",
        synonyms: ["발표 도우미"],
        abbreviations: ["OD"]
      },
      {
        keywordId: "kw_2",
        text: "리허설",
        synonyms: ["orbit"],
        abbreviations: []
      }
    ];

    expectInvalidDeck(deck);
  });

  it("rejects duplicate slide keyword IDs", () => {
    const deck = createValidDeck();

    deck.slides[0].keywords = [
      {
        keywordId: "kw_1",
        text: "ORBIT",
        synonyms: [],
        abbreviations: []
      },
      {
        keywordId: "kw_1",
        text: "리허설",
        synonyms: [],
        abbreviations: []
      }
    ];

    expectInvalidDeck(deck);
  });

  it.each([
    ["deckId", "deckId"],
    ["slideId", "slides.0.slideId"],
    ["elementId", "slides.0.elements.0.elementId"],
    ["animationId", "slides.0.animations.0.animationId"],
    ["keywordId", "slides.0.keywords.0.keywordId"]
  ])("rejects invalid %s prefix", (_label, path) => {
    const deck = createValidDeck();

    if (path === "deckId") {
      deck.deckId = "bad_1";
    }

    if (path === "slides.0.slideId") {
      deck.slides[0].slideId = "bad_1";
    }

    if (path === "slides.0.elements.0.elementId") {
      deck.slides[0].elements[0].elementId = "bad_1";
    }

    if (path === "slides.0.animations.0.animationId") {
      deck.slides[0].animations[0].animationId = "bad_1";
    }

    if (path === "slides.0.keywords.0.keywordId") {
      deck.slides[0].keywords[0].keywordId = "bad_1";
    }

    expectInvalidDeck(deck);
  });

  it("rejects an empty slide list", () => {
    const deck = createValidDeck();

    deck.slides = [];

    expectInvalidDeck(deck);
  });

  it("rejects non-positive slide order", () => {
    const deck = createValidDeck();

    deck.slides[0].order = 0;

    expectInvalidDeck(deck);
  });

  it("rejects unsupported animation type", () => {
    const deck = createValidDeck();

    deck.slides[0].animations[0].type = "slide-in";

    expectInvalidDeck(deck);
  });

  it("accepts an optional fade transition and every animation start mode", () => {
    const deck = createValidDeck();
    deck.slides[0].transition = { type: "fade", durationMs: 700 };
    deck.slides[0].animations = [
      "on-slide-enter",
      "on-click",
      "with-previous",
      "after-previous"
    ].map((startMode, index) => ({
      ...deck.slides[0].animations[0],
      animationId: `anim_${index + 1}`,
      order: index + 1,
      startMode: startMode as
        | "on-slide-enter"
        | "on-click"
        | "with-previous"
        | "after-previous"
    }));

    const parsed = deckSchema.parse(deck);

    expect(parsed.slides[0].transition).toEqual({
      type: "fade",
      durationMs: 700
    });
    expect(
      parsed.slides[0].animations.map((animation) => animation.startMode)
    ).toEqual([
      "on-slide-enter",
      "on-click",
      "with-previous",
      "after-previous"
    ]);
  });

  it("keeps legacy animation startMode absent for contextual migration", () => {
    const parsed = deckSchema.parse(createValidDeck());

    expect(parsed.slides[0].transition).toBeUndefined();
    expect(parsed.slides[0].animations[0].startMode).toBeUndefined();
  });

  it("accepts only a stable OOXML source slide part locator", () => {
    const deck = createValidDeck();
    deck.slides[0].ooxmlSourceSlidePart = "ppt/slides/slide3.xml";

    expect(deckSchema.parse(deck).slides[0].ooxmlSourceSlidePart).toBe(
      "ppt/slides/slide3.xml"
    );

    deck.slides[0].ooxmlSourceSlidePart = "../slide3.xml";
    expectInvalidDeck(deck);
  });

  it.each([
    { transition: { type: "push", durationMs: 700 }, name: "type" },
    { transition: { type: "fade", durationMs: 0 }, name: "duration" }
  ])("rejects an invalid slide transition $name", ({ transition }) => {
    const deck = createValidDeck();
    deck.slides[0].transition = transition as never;

    expectInvalidDeck(deck);
  });

  it("rejects an invalid animation start mode", () => {
    const deck = createValidDeck();
    deck.slides[0].animations[0].startMode = "same-time" as never;

    expectInvalidDeck(deck);
  });

  it("rejects invalid element opacity", () => {
    const deck = createValidDeck();

    deck.slides[0].elements[0].opacity = 1.1;

    expectInvalidDeck(deck);
  });

  it("rejects invalid element zIndex", () => {
    const deck = createValidDeck();

    deck.slides[0].elements[0].zIndex = -1;

    expectInvalidDeck(deck);
  });
});

describe("deckPatchSchema validation", () => {
  it("accepts a valid deck patch", () => {
    expect(deckPatchSchema.safeParse(createValidPatch()).success).toBe(true);
  });

  it("accepts an element frame patch with off-canvas coordinates", () => {
    const patch: unknown = {
      ...createValidPatch(),
      operations: [
        {
          type: "update_element_frame",
          slideId: "slide_1",
          elementId: "el_1",
          frame: {
            x: -240,
            y: -80
          }
        }
      ]
    };

    expect(deckPatchSchema.safeParse(patch).success).toBe(true);
  });

  it("rejects an element frame patch outside the supported coordinate range", () => {
    const patch: unknown = {
      ...createValidPatch(),
      operations: [
        {
          type: "update_element_frame",
          slideId: "slide_1",
          elementId: "el_1",
          frame: {
            x: 1_000_001,
            y: -1_000_001
          }
        }
      ]
    };

    expect(deckPatchSchema.safeParse(patch).success).toBe(false);
  });

  it("accepts deck metadata update patches", () => {
    const patch: unknown = {
      ...createValidPatch(),
      operations: [
        {
          metadata: {
            thumbnailSource: "canvas"
          },
          type: "update_deck"
        }
      ]
    };

    expect(deckPatchSchema.safeParse(patch).success).toBe(true);
  });

  it("accepts deck and slide target duration update patches", () => {
    const patch: unknown = {
      ...createValidPatch(),
      operations: [
        { type: "update_deck", targetDurationMinutes: 12 },
        { type: "update_slide", slideId: "slide_1", estimatedSeconds: 90 }
      ]
    };

    expect(deckPatchSchema.safeParse(patch).success).toBe(true);
  });

  it.each([0, 121, 1.5])(
    "rejects invalid deck target duration %s",
    (targetDurationMinutes) => {
      const patch: unknown = {
        ...createValidPatch(),
        operations: [{ type: "update_deck", targetDurationMinutes }]
      };

      expect(deckPatchSchema.safeParse(patch).success).toBe(false);
    }
  );

  it("accepts setting and clearing a transition and updating startMode", () => {
    const setPatch: unknown = {
      ...createValidPatch(),
      operations: [
        {
          type: "update_slide_transition",
          slideId: "slide_1",
          transition: { type: "fade", durationMs: 700 }
        },
        {
          type: "update_animation",
          slideId: "slide_1",
          animationId: "anim_1",
          animation: { startMode: "after-previous" }
        }
      ]
    };
    const clearPatch: unknown = {
      ...createValidPatch(),
      operations: [
        {
          type: "update_slide_transition",
          slideId: "slide_1",
          transition: null
        }
      ]
    };

    expect(deckPatchSchema.safeParse(setPatch).success).toBe(true);
    expect(deckPatchSchema.safeParse(clearPatch).success).toBe(true);
  });

  it("rejects unsupported transition and animation startMode patches", () => {
    const patches: unknown[] = [
      {
        ...createValidPatch(),
        operations: [
          {
            type: "update_slide_transition",
            slideId: "slide_1",
            transition: { type: "push", durationMs: 700 }
          }
        ]
      },
      {
        ...createValidPatch(),
        operations: [
          {
            type: "update_animation",
            slideId: "slide_1",
            animationId: "anim_1",
            animation: { startMode: "same-time" }
          }
        ]
      }
    ];

    expect(
      patches.every((patch) => !deckPatchSchema.safeParse(patch).success)
    ).toBe(true);
  });

  it("rejects replace keyword patches with duplicate keyword IDs", () => {
    const patch: unknown = {
      ...createValidPatch(),
      operations: [
        {
          type: "replace_keywords",
          slideId: "slide_1",
          keywords: [
            {
              keywordId: "kw_1",
              text: "ORBIT",
              synonyms: [],
              abbreviations: []
            },
            {
              keywordId: "kw_1",
              text: "리허설",
              synonyms: [],
              abbreviations: []
            }
          ]
        }
      ]
    };

    expect(deckPatchSchema.safeParse(patch).success).toBe(false);
  });

  it("accepts a slide-scoped semantic cue replacement patch", () => {
    const patch: unknown = {
      ...createValidPatch(),
      operations: [
        {
          type: "replace_semantic_cues",
          slideId: "slide_1",
          semanticCues: [
            {
              cueId: "scue_1",
              slideId: "slide_1",
              meaning: "발표자는 핵심 원인을 설명한다",
              nliHypotheses: ["발표자는 핵심 원인을 설명했다"]
            }
          ]
        }
      ]
    };

    const result = deckPatchSchema.parse(patch);
    const operation = result.operations[0];

    expect(operation.type).toBe("replace_semantic_cues");
    if (operation.type === "replace_semantic_cues") {
      expect(operation.semanticCues[0]).toMatchObject({
        reviewStatus: "suggested",
        freshness: "current",
        origin: "imported",
        revision: 1
      });
    }
  });

  it("rejects empty patch operations", () => {
    const patch = createValidPatch();

    patch.operations = [];

    expect(deckPatchSchema.safeParse(patch).success).toBe(false);
  });

  it("rejects unsupported patch source", () => {
    const patch = createValidPatch();

    patch.source = "assistant";

    expect(deckPatchSchema.safeParse(patch).success).toBe(false);
  });
});

describe("deckChangeRecordSchema validation", () => {
  it("accepts a valid deck change record", () => {
    expect(deckChangeRecordSchema.safeParse(createValidChangeRecord()).success).toBe(
      true
    );
  });

  it("rejects invalid changeId prefix", () => {
    const record = createValidChangeRecord();

    record.changeId = "bad_1";

    expect(deckChangeRecordSchema.safeParse(record).success).toBe(false);
  });

  it("rejects afterVersion equal to beforeVersion", () => {
    const record = createValidChangeRecord();

    record.afterVersion = record.beforeVersion;

    expect(deckChangeRecordSchema.safeParse(record).success).toBe(false);
  });

  it("rejects afterVersion less than beforeVersion", () => {
    const record = createValidChangeRecord();

    record.afterVersion = record.beforeVersion - 1;

    expect(deckChangeRecordSchema.safeParse(record).success).toBe(false);
  });
});
