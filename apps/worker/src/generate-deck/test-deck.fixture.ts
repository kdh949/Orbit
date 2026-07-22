import {
  deckSchema,
  type Deck,
  type GenerateDeckValidation,
} from "@orbit/shared";

const baselineCompositionSequence = [
  "cover-classic-corporate",
  "editorial-split",
  "metric-poster",
  "editorial-split",
  "kpi-strip-evidence",
  "editorial-split",
  "statement-poster",
  "cta-closing",
] as const;

export const visualQualityBaselineSnapshot = {
  compositionSequence: baselineCompositionSequence,
  validationSummary: {
    passed: false,
    layoutIssueCount: 0,
    contentIssueCount: 0,
    designIssueCodes: ["BALANCE_WEAK", "TEXT_CONTRAST_LOW"],
    presentationIssueCount: 0,
  },
} as const;

export function createTestDeck(projectId = "project-a"): Deck {
  return deckSchema.parse({
    deckId: "deck_ai_test",
    projectId,
    title: "AI deck test",
    version: 1,
    metadata: { language: "ko", locale: "ko-KR" },
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    slides: [
      {
        slideId: "slide_test_1",
        order: 1,
        title: "Test slide",
        elements: [
          {
            elementId: "el_test_1",
            type: "text",
            role: "body",
            x: 100,
            y: 100,
            width: 500,
            height: 120,
            rotation: 0,
            opacity: 1,
            zIndex: 1,
            locked: false,
            visible: true,
            props: {
              text: "Test content",
              fontSize: 32,
              fontWeight: 400,
              color: "#111111",
              align: "left",
              verticalAlign: "top",
              lineHeight: 1.2,
            },
          },
        ],
      },
    ],
  });
}

export function createVisualQualityBaselineFixture(
  projectId = "project-a",
): { deck: Deck; validation: GenerateDeckValidation } {
  const base = createTestDeck(projectId);
  const slides = baselineCompositionSequence.map((compositionId, index) => {
    const order = index + 1;
    const slide = structuredClone(base.slides[0]);
    const element = slide.elements[0];
    if (!element || element.type !== "text") {
      throw new Error("Visual quality baseline text fixture is missing.");
    }
    slide.slideId = `slide_visual_baseline_${order}`;
    slide.order = order;
    slide.title = `Visual baseline ${order}`;
    element.elementId = `el_visual_baseline_${order}`;
    element.x = index % 2 === 0 ? 120 : 1160;
    element.y = 160;
    element.width = 640;
    element.height = 180;
    if (order === 4) element.props.color = "#F3F4F6";
    slide.style = {
      ...slide.style,
      backgroundColor: "#FFFFFF",
    };
    slide.aiNotes = {
      emphasisPoints: [],
      sourceEvidence: [],
      compositionPlan: {
        compositionId,
        variant: "light",
        backgroundMode: "light",
        focalType: order === 1 ? "title" : "message",
        primaryFocalElementId: element.elementId,
        assetRole: "none",
        requiredAsset: false,
      },
    };
    return slide;
  });
  const deck = deckSchema.parse({
    ...base,
    metadata: {
      ...base.metadata,
      sourceType: "ai",
      generatedBy: "ai",
      presentationProfile: "general-inform",
      designProgramSnapshot: {
        version: "program-v2",
        visualConcept: "Deterministic no-media visual quality baseline",
        paletteRoles: {
          dominant: "#FFFFFF",
          focal: "#2563EB",
          text: "#111827",
        },
        typography: {
          headingFont: "Pretendard",
          bodyFont: "Pretendard",
          typeScale: { title: 56, body: 24 },
        },
        backgroundSequence: slides.map(() => "light"),
        imageStyle: "No media",
        surfaceStyle: "Flat white surfaces",
        compositionIds: [...baselineCompositionSequence],
      },
    },
    slides,
  });
  const validation: GenerateDeckValidation = {
    passed: false,
    layoutIssues: [],
    contentIssues: [],
    designIssues: [
      {
        code: "BALANCE_WEAK",
        scope: "slide",
        severity: "warning",
        blocking: false,
        path: "slides.2",
        message: "The focal content leaves the opposite field unbalanced.",
      },
      {
        code: "TEXT_CONTRAST_LOW",
        scope: "element",
        severity: "error",
        blocking: true,
        path: "slides.3.elements.0.props.color",
        message: "Text contrast is below the deterministic threshold.",
      },
    ],
    presentationIssues: [],
  };
  return { deck, validation };
}
