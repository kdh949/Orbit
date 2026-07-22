import { describe, expect, it } from "vitest";

import {
  deckColorCustomizationRequestSchema,
  deckColorCustomizationResponseSchema,
  deckColorOptionRequestSchema,
  deckColorOptionsResponseSchema,
  generateDeckDiagnosticsSchema,
  generateDeckJobResultSchema,
  generateDeckRequestSchema,
  generateDeckResponseSchema,
  generateDeckStoredJobPayloadSchema
} from "./generate-deck.schema";

describe("generateDeckRequestSchema", () => {
  it("normalizes MVP defaults", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "AI 덱 생성",
      references: [{ fileId: "file_1" }]
    });

    expect(request.targetDurationMinutes).toBe(10);
    expect(request.slideCountRange).toEqual({ min: 5, max: 8 });
    expect(request.metadata).toEqual({
      audience: "general",
      purpose: "inform",
      tone: "professional"
    });
    expect(request.brief).toEqual({
      referencePolicy: "topic-only"
    });
    expect(request.design).toEqual({
      visualRhythm: "auto",
      densityTarget: "medium",
      mediaPolicy: "balanced",
      layoutDiversity: "stable"
    });
    expect(request.template).toBe("default");
    expect(request.referenceKeywords).toEqual([]);
    expect(request.referenceContext).toEqual([]);
  });

  it("rejects more than 10 referenceFileIds", () => {
    const result = generateDeckRequestSchema.safeParse({
      topic: "AI deck generation",
      referenceFileIds: Array.from(
        { length: 11 },
        (_, index) => `file_${index + 1}`
      )
    });

    expect(result.success).toBe(false);
  });

  it("rejects more than 10 public references", () => {
    const result = generateDeckRequestSchema.safeParse({
      topic: "AI deck generation",
      references: Array.from({ length: 11 }, (_, index) => ({
        fileId: `file_${index + 1}`
      }))
    });

    expect(result.success).toBe(false);
  });

  it("accepts survey brief fields for AI PPT generation", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "Brandlogy renewal",
      brief: {
        presentationContext: "internal strategy meeting",
        audienceText: "executives",
        presentationType: "planning proposal",
        successCriteria: "align on MVP scope",
        durationMinutes: 12,
        referencePolicy: "references-first"
      }
    });

    expect(request.brief).toEqual({
      presentationContext: "internal strategy meeting",
      audienceText: "executives",
      presentationType: "planning proposal",
      successCriteria: "align on MVP scope",
      durationMinutes: 12,
      referencePolicy: "references-first"
    });
  });

  it("accepts an optional saved design pack selection", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "Reusable report",
      savedDesignPack: {
        id: "design_pack_user_1",
        version: 3
      }
    });

    expect(request.savedDesignPack).toEqual({
      id: "design_pack_user_1",
      version: 3
    });
  });

  it("accepts a one-shot palette override without changing the theme contract", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "Travel product strategy",
      design: {
        stylePackId: "brandlogy-modern",
        paletteOverride: {
          primary: "#0EA5E9",
          secondary: "#F472B6",
          background: "#F8FAFC",
          text: "#111827",
          accentColor: "#2563EB"
        }
      }
    });

    expect(request.design.paletteOverride).toEqual({
      primary: "#0EA5E9",
      secondary: "#F472B6",
      background: "#F8FAFC",
      text: "#111827",
      accentColor: "#2563EB"
    });
  });

  it("rejects invalid palette override colors", () => {
    const result = generateDeckRequestSchema.safeParse({
      topic: "Travel product strategy",
      design: {
        paletteOverride: {
          primary: "blue"
        }
      }
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["legacy mode", { generationMode: "legacy" }],
    ["design-pack mode", { generationMode: "design-pack" }],
    ["recipe-v1 engine", { design: { engineVersion: "recipe-v1" } }],
    ["program-v2 engine", { design: { engineVersion: "program-v2" } }],
    ["design references", { designReferences: [{ fileId: "file_design" }] }],
    ["template blueprint", { templateBlueprintId: "template_file_design" }],
    ["slide preset", { design: { slidePresetId: "process-cards-horizontal-6" } }],
    ["unknown root field", { unknownField: true }],
    ["unknown nested field", { design: { unknownField: true } }],
    ["blank reference file ID", { referenceFileIds: ["   "] }],
    ["blank official asset file ID", { officialAssetFileIds: ["   "] }],
    ["blank reference ID", { references: [{ fileId: "   " }] }],
    [
      "blank reference context content",
      { referenceContext: [{ fileId: "file_1", content: "   " }] }
    ],
    [
      "blank reference context source ID",
      {
        referenceContext: [
          { fileId: "file_1", content: "content", sourceId: "   " }
        ]
      }
    ],
    [
      "blank coaching brief ID",
      {
        coachingContext: {
          briefRef: { mode: "briefed", briefId: "   ", revision: 1 },
          evaluatorLensRef: { lensId: "general-novice", revision: 1 }
        }
      }
    ]
  ])("rejects deprecated or extra %s input", (_name, input) => {
    expect(
      generateDeckRequestSchema.safeParse({
        topic: "AI deck generation",
        ...input
      }).success
    ).toBe(false);
  });

  it("normalizes design direction defaults", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "AI deck generation",
      design: {
        visualRhythm: "technical",
        mediaPolicy: "placeholder-ok",
        layoutDiversity: "varied"
      }
    });

    expect(request.design).toEqual({
      visualRhythm: "technical",
      densityTarget: "medium",
      mediaPolicy: "placeholder-ok",
      layoutDiversity: "varied"
    });
  });

  it("accepts v1 design profiles", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "AI deck generation",
      design: {
        profile: "startup-pitch"
      }
    });

    expect(request.design.profile).toBe("startup-pitch");
  });

  it("accepts v2 design-pack font and policy options", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "AI PPT generation",
      referencePolicy: "references-first",
      referenceFileIds: ["file_reference_1"],
      visualPlanPolicy: { mediaPolicy: "minimal" },
      design: {
        mediaPolicy: "minimal",
        referencePolicy: "references-first",
        fontOverride: {
          fontId: "pretendard",
          name: "Pretendard",
          headingFontFamily: "Pretendard",
          bodyFontFamily: "Pretendard",
          fallbackFamily: "Arial",
          weights: [400, 600, 700],
          supportsKorean: true,
          pptxEmbeddable: true,
          moodTags: ["professional", "modern"],
          license: "SIL Open Font License",
          sourceUrl: "https://github.com/orioncactus/pretendard"
        }
      }
    });

    expect(request.referencePolicy).toBe("references-first");
    expect(request.referenceFileIds).toEqual(["file_reference_1"]);
    expect(request.visualPlanPolicy?.mediaPolicy).toBe("minimal");
    expect(request.design.mediaPolicy).toBe("minimal");
    expect(request.design.fontOverride?.bodyFontFamily).toBe("Pretendard");
    expect(request.design.fontOverride?.recommendedTitleSize).toBe(48);
    expect(request.design.fontOverride?.overflowRisk).toBe("medium");
  });

  it("accepts an optional v2 style pack override", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "AI deck generation",
      design: {
        stylePackId: "teal-professional-process"
      }
    });

    expect(request.design.stylePackId).toBe("teal-professional-process");
  });

  it("accepts hybrid media without a public engine selector", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "Splatoon Raiders launch",
      design: {
        mediaPolicy: "hybrid"
      },
      visualPlanPolicy: { mediaPolicy: "hybrid" },
      officialAssetFileIds: ["file_official_1"]
    });

    expect(request.design.mediaPolicy).toBe("hybrid");
    expect(request.visualPlanPolicy?.mediaPolicy).toBe("hybrid");
    expect(request.officialAssetFileIds).toEqual(["file_official_1"]);
  });

  it("accepts an optional design prompt", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "AI deck generation",
      prompt: "Explain the workflow",
      designPrompt: "retro pixel palette"
    });

    expect(request.prompt).toBe("Explain the workflow");
    expect(request.designPrompt).toBe("retro pixel palette");
  });

  it("accepts design-pack color intent and hard design constraints", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "AI deck generation",
      design: {
        stylePackId: "brandlogy-modern",
        colorIntent: {
          mood: "trustworthy",
          trustLevel: "high",
          energyLevel: "low",
          formality: "professional",
          preferredHue: "blue",
          backgroundPreference: "white",
          forbiddenStyles: ["gradient", "pastel"]
        },
        constraints: {
          canvasBackground: "white",
          forbiddenStyles: ["gradient", "pastel"]
        }
      }
    });

    expect(request.design.colorIntent).toMatchObject({
      mood: "trustworthy",
      preferredHue: "blue",
      backgroundPreference: "white"
    });
    expect(request.design.constraints).toEqual({
      canvasBackground: "white",
      forbiddenStyles: ["gradient", "pastel"]
    });
  });

  it("accepts normalized reference keywords", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "AI 덱 생성",
      referenceKeywords: [{ text: " 실시간 발표 피드백 " }]
    });

    expect(request.referenceKeywords).toEqual([{ text: "실시간 발표 피드백" }]);
  });

  it("accepts direct reference context for worker-side grounding", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "AI deck generation",
      references: [{ fileId: "file_design" }],
      referenceContext: [
        {
          fileId: "file_design",
          sourceId: "uploaded:file_design:chunk_1",
          chunkId: "chunk_1",
          title: " template.pptx ",
          content: " PPTX source text "
        }
      ]
    });

    expect(request.referenceContext).toEqual([
      {
        fileId: "file_design",
        sourceId: "uploaded:file_design:chunk_1",
        chunkId: "chunk_1",
        title: "template.pptx",
        content: "PPTX source text"
      }
    ]);
  });

  it("rejects an inverted slide count range", () => {
    expect(
      generateDeckRequestSchema.safeParse({
        topic: "AI 덱 생성",
        slideCountRange: { min: 8, max: 5 }
      }).success
    ).toBe(false);
  });
});

describe("generateDeckStoredJobPayloadSchema", () => {
  it("accepts legacy payloads and records the requesting user for new jobs", () => {
    expect(
      generateDeckStoredJobPayloadSchema.parse({
        request: { topic: "legacy" },
      }),
    ).toMatchObject({ request: { topic: "legacy" } });

    expect(
      generateDeckStoredJobPayloadSchema.parse({
        request: { topic: "postgres transport" },
        requestedByUserId: "user-a",
        imageAssetScope: { userId: "user-a" },
      }),
    ).toMatchObject({ requestedByUserId: "user-a" });
  });

  it("rejects undeclared stored payload fields", () => {
    expect(() =>
      generateDeckStoredJobPayloadSchema.parse({
        request: { topic: "postgres transport" },
        requestedByUserId: "user-a",
        rawProviderResponse: { output: "private" },
      }),
    ).toThrow();
  });
});

describe("generateDeckDiagnosticsSchema", () => {
  it("defaults research diagnostics without breaking old payloads", () => {
    expect(generateDeckDiagnosticsSchema.parse({})).toMatchObject({
      researchQuality: "not-run",
      researchIssueCodes: [],
      independentWebSourceCount: 0,
      researchFactCoverageSatisfied: false,
      warningCodes: []
    });
  });

  it("accepts a partial research result with safe limitation codes", () => {
    expect(
      generateDeckDiagnosticsSchema.parse({
        researchQuality: "partial",
        researchIssueCodes: ["independent-missing", "fact-coverage"],
        relevantWebSourceCount: 1,
        officialWebSourceCount: 1,
        independentWebSourceCount: 0,
        researchFactCoverageSatisfied: false
      })
    ).toMatchObject({
      researchQuality: "partial",
      researchIssueCodes: ["independent-missing", "fact-coverage"],
      relevantWebSourceCount: 1,
      officialWebSourceCount: 1,
      independentWebSourceCount: 0,
      researchFactCoverageSatisfied: false
    });
  });

  it("accepts reproducible system design pack selection diagnostics", () => {
    expect(
      generateDeckDiagnosticsSchema.parse({
        designPackId: "neutral-light",
        designPackVersion: 1,
        designPackSelectionMode: "auto",
        designPackLayoutIds: ["neutral-cover-01", "neutral-closing-01"],
        designPackCatalogVersion: 1,
        designPackFallbackUsed: false,
      }),
    ).toMatchObject({
      designPackId: "neutral-light",
      designPackVersion: 1,
      designPackSelectionMode: "auto",
      designPackCatalogVersion: 1,
      designPackFallbackUsed: false,
    });
  });

  it("rejects unknown research limitation codes", () => {
    expect(
      generateDeckDiagnosticsSchema.safeParse({
        researchIssueCodes: ["provider stack trace"]
      }).success
    ).toBe(false);
  });

  it("rejects unknown diagnostics fields instead of stripping them", () => {
    expect(
      generateDeckDiagnosticsSchema.safeParse({
        researchQuality: "partial",
        providerResponse: { raw: true }
      }).success
    ).toBe(false);
  });

  it("accepts unavailable rendered visual QA with warning codes", () => {
    expect(
      generateDeckDiagnosticsSchema.parse({
        visualQaStatus: "unavailable",
        warningCodes: ["GENERATE_DECK_VISUAL_QA_UNAVAILABLE"],
      }),
    ).toMatchObject({
      visualQaStatus: "unavailable",
      warningCodes: ["GENERATE_DECK_VISUAL_QA_UNAVAILABLE"],
    });
  });

  it("accepts advisory rendered visual QA with affected slides", () => {
    expect(generateDeckDiagnosticsSchema.parse({
      visualQaStatus: "advisory",
      visualIssueCodes: ["BALANCE_WEAK"],
      visualIssueSlideOrders: [1, 2, 3],
      warningCodes: ["GENERATE_DECK_VISUAL_ADVISORY"]
    })).toMatchObject({
      visualQaStatus: "advisory",
      visualIssueCodes: ["BALANCE_WEAK"],
      visualIssueSlideOrders: [1, 2, 3],
      warningCodes: ["GENERATE_DECK_VISUAL_ADVISORY"]
    });
  });

  it("accepts extensible uppercase codes and rejects user-facing warning text", () => {
    expect(
      generateDeckDiagnosticsSchema.parse({
        warningCodes: ["FUTURE_DEGRADED_RESULT"],
      }).warningCodes,
    ).toEqual(["FUTURE_DEGRADED_RESULT"]);

    for (const warningCode of [
      "",
      "   ",
      "visual_qa_unavailable",
      "VISUAL-QA",
      "Visual QA unavailable",
    ]) {
      expect(
        generateDeckDiagnosticsSchema.safeParse({
          warningCodes: [warningCode],
        }).success,
      ).toBe(false);
    }
  });
});

describe("deckColorOptionsResponseSchema", () => {
  it("accepts color intent and constraints in color option requests", () => {
    const request = deckColorOptionRequestSchema.parse({
      topic: "Trustworthy product update",
      colorMood: "white background, no pastel",
      colorIntent: {
        mood: "trustworthy",
        preferredHue: "blue",
        backgroundPreference: "white"
      },
      constraints: {
        canvasBackground: "white",
        forbiddenStyles: ["pastel"]
      }
    });

    expect(request.stylePackId).toBe("brandlogy-modern");
    expect(request.colorIntent?.preferredHue).toBe("blue");
    expect(request.constraints).toEqual({
      canvasBackground: "white",
      forbiddenStyles: ["pastel"]
    });
  });

  it("requires exactly three color options", () => {
    const response = deckColorOptionsResponseSchema.parse({
      options: [
        {
          optionId: "ocean",
          name: "Resort Blue",
          palette: {
            primary: "#0EA5E9",
            secondary: "#0369A1",
            background: "#F0F9FF",
            surface: "#FFFFFF",
            muted: "#E0F2FE",
            border: "#BAE6FD",
            text: "#0F172A",
            accentColor: "#F472B6"
          },
          rationale: "Bright and relaxed."
        },
        {
          optionId: "expert",
          name: "Executive Blue",
          palette: {
            primary: "#1D4ED8",
            secondary: "#334155",
            background: "#F8FAFC",
            surface: "#FFFFFF",
            muted: "#E2E8F0",
            border: "#CBD5E1",
            text: "#0F172A",
            accentColor: "#DB2777"
          },
          rationale: "Professional and clear."
        },
        {
          optionId: "violet",
          name: "Topic Violet",
          palette: {
            primary: "#7C3AED",
            secondary: "#4F46E5",
            background: "#FAF5FF",
            surface: "#FFFFFF",
            muted: "#EDE9FE",
            border: "#DDD6FE",
            text: "#18181B",
            accentColor: "#EC4899"
          },
          rationale: "Expressive and modern."
        }
      ]
    });

    expect(response.options).toHaveLength(3);
  });

  it("rejects color option responses with fewer than three options", () => {
    const result = deckColorOptionsResponseSchema.safeParse({
      options: [
        {
          optionId: "ocean",
          name: "Resort Blue",
          palette: { primary: "#0EA5E9" },
          rationale: "Bright and relaxed."
        }
      ]
    });

    expect(result.success).toBe(false);
  });
});

describe("deckColorCustomizationResponseSchema", () => {
  const palette = {
    primary: "#D97706",
    secondary: "#92400E",
    background: "#FFFBEB",
    surface: "#FFFFFF",
    muted: "#FEF3C7",
    border: "#FDE68A",
    text: "#1C1917",
    accentColor: "#2563EB"
  };

  it("requires a complete base palette and one strict result", () => {
    const request = deckColorCustomizationRequestSchema.parse({
      topic: "제품 전략",
      instruction: "포인트 컬러만 더 따뜻하게",
      basePalette: palette,
      tone: "professional"
    });
    const response = deckColorCustomizationResponseSchema.parse({
      option: {
        optionId: "ai-custom",
        name: "따뜻한 전략",
        palette,
        rationale: "기존 배경을 유지하고 포인트를 조정했습니다."
      }
    });

    expect(request.stylePackId).toBe("brandlogy-modern");
    expect(response.option.palette).toEqual(palette);
  });

  it("rejects extra fields and incomplete palettes", () => {
    expect(
      deckColorCustomizationRequestSchema.safeParse({
        topic: "제품 전략",
        instruction: "파란색으로",
        basePalette: { primary: "#2563EB" },
        tone: "professional",
        providerPrompt: "do not expose"
      }).success
    ).toBe(false);
  });
});

describe("generateDeckJobResultSchema", () => {
  it("requires a valid generated deck payload", () => {
    const result = generateDeckJobResultSchema.safeParse({
      deckId: "deck_ai_1",
      deck: {
        deckId: "deck_ai_1",
        projectId: "project_demo_1",
        title: "AI 덱 생성",
        version: 1,
        metadata: {
          language: "ko",
          locale: "ko-KR",
          sourceType: "ai",
          generatedBy: "ai"
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
            title: "Opening",
            thumbnailUrl: "",
            style: {},
            speakerNotes: "발표자 노트",
            elements: [],
            keywords: [],
            animations: [],
            actions: [],
            aiNotes: {
              emphasisPoints: ["핵심 메시지"],
              sourceEvidence: [{ fileId: "file_1" }]
            }
          }
        ]
      },
      warnings: [],
      validation: {
        passed: true,
        layoutIssues: [],
        contentIssues: [],
        designIssues: [],
        presentationIssues: []
      }
    });

    expect(result.success).toBe(true);
  });
});

describe("generateDeckResponseSchema", () => {
  it("normalizes legacy validation issues with structured defaults", () => {
    const response = generateDeckResponseSchema.safeParse({
      deck: {
        deckId: "deck_ai_1",
        projectId: "project_demo_1",
        title: "AI generation",
        version: 1,
        metadata: { language: "ko", locale: "ko-KR" },
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
            title: "Opening",
            thumbnailUrl: "",
            style: {},
            speakerNotes: "notes",
            elements: [],
            keywords: [],
            animations: [],
            actions: []
          }
        ]
      },
      validation: {
        passed: false,
        layoutIssues: [
          { scope: "slide", path: "slides.0", message: "legacy warning" }
        ]
      }
    });

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.validation.layoutIssues[0]).toMatchObject({
        code: "UNSPECIFIED",
        severity: "warning",
        blocking: false
      });
      expect(response.data.diagnostics).toMatchObject({
        referencePolicy: "topic-only",
        researchAttempts: 0,
        relevantWebSourceCount: 0,
        officialWebSourceCount: 0,
        repairAttempted: false,
        validationIssueCount: 0
      });
    }
  });

  it("rejects passed validation that still contains issues", () => {
    const valid = generateDeckJobResultSchema.parse({
      deckId: "deck_ai_1",
      deck: {
        deckId: "deck_ai_1",
        projectId: "project_demo_1",
        title: "AI generation",
        version: 1,
        metadata: { language: "ko", locale: "ko-KR" },
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
            title: "Opening",
            thumbnailUrl: "",
            style: {},
            speakerNotes: "notes",
            elements: [],
            keywords: [],
            animations: [],
            actions: []
          }
        ]
      },
      validation: { passed: true }
    });

    expect(
      generateDeckResponseSchema.safeParse({
        ...valid,
        validation: {
          ...valid.validation,
          passed: true,
          contentIssues: [
            {
              code: "CONTENT_MISSING",
              scope: "slide",
              severity: "error",
              blocking: true,
              path: "slides.0",
              message: "content missing"
            }
          ]
        }
      }).success
    ).toBe(false);
  });

  it("accepts optional template selection mapping", () => {
    const response = generateDeckResponseSchema.parse({
      deck: {
        deckId: "deck_ai_1",
        projectId: "project_demo_1",
        title: "AI generation",
        version: 1,
        metadata: {
          language: "ko",
          locale: "ko-KR",
          sourceType: "ai",
          generatedBy: "ai"
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
            title: "Opening",
            thumbnailUrl: "",
            style: {},
            speakerNotes: "notes",
            elements: [],
            keywords: [],
            animations: [],
            actions: []
          }
        ]
      },
      templateSelection: [
        {
          generatedOrder: 1,
          sourceSlideIndex: 3,
          selectionReason: "cover layout matched"
        }
      ],
      validation: {
        passed: true,
        layoutIssues: [],
        contentIssues: [],
        designIssues: [],
        presentationIssues: []
      },
      diagnostics: {
        referencePolicy: "research-first",
        uploadedSourceCount: 1,
        webSourceCount: 2,
        researchAttempts: 2,
        relevantWebSourceCount: 2,
        officialWebSourceCount: 1,
        repairAttempted: true,
        repairReasons: [
          "SLIDE_COUNT_SHORT",
          "CONTENT_DUPLICATED",
          "UNSUPPORTED_NUMERIC_CLAIM",
          "SPEAKER_NOTES_SHORT"
        ],
        uniqueCoreLayoutCount: 5,
        validationIssueCount: 0,
        visualQaStatus: "passed",
        visualReviewAttempts: 2,
        visualRepairAttempts: 1,
        visualIssueCodes: []
      }
    });

    expect(response.templateSelection?.[0]?.sourceSlideIndex).toBe(3);
    expect(response.diagnostics).toMatchObject({
      webSourceCount: 2,
      researchAttempts: 2,
      relevantWebSourceCount: 2,
      officialWebSourceCount: 1,
      uniqueCoreLayoutCount: 5,
      visualQaStatus: "passed",
      visualReviewAttempts: 2,
      visualRepairAttempts: 1
    });
  });
});
