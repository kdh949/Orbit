import { z } from "zod";
import { evaluatorLensRefSchema, frozenBriefRefSchema } from "../coaching/coaching-common.schema";
import { jobSchema } from "../jobs/job.schema";

import {
  aiDeckAudienceSchema,
  aiDeckPurposeSchema,
  aiDeckToneSchema,
  deckSchema
} from "./deck.schema";
import {
  deckCompositionBackgroundModeSchema,
  deckCompositionIdSchema
} from "./composition.schema";
import { deckElementIdSchema, deckIdSchema, deckSlideIdSchema } from "./id.schema";
import {
  savedDesignPackSelectionSchema,
  savedDesignPackSnapshotSchema
} from "./saved-design-pack.schema";
import { themeColorSchema } from "./theme.schema";

export const generateDeckTemplateSchema = z.enum([
  "default",
  "pitch",
  "report",
  "lesson"
]);

export const generateDeckReferenceSchema = z.object({
  fileId: z.string().trim().min(1)
}).strict();

export const generateDeckReferenceKeywordSchema = z.object({
  text: z.string().trim().min(1)
}).strict();

export const generateDeckReferenceContextSchema = z.object({
  fileId: z.string().trim().min(1),
  title: z.string().trim().default(""),
  content: z.string().trim().min(1),
  sourceId: z.string().trim().min(1).optional(),
  chunkId: z.string().trim().min(1).optional()
}).strict();

export const generateDeckMetadataSchema = z
  .object({
    audience: aiDeckAudienceSchema.default("general"),
    purpose: aiDeckPurposeSchema.default("inform"),
    tone: aiDeckToneSchema.default("professional")
  })
  .strict()
  .default({});

export const generateDeckReferencePolicySchema = z.enum([
  "topic-only",
  "user-input-only",
  "references-first",
  "references-only",
  "research-first"
]);

export const generateDeckMediaPolicySchema = z.enum([
  "avoid",
  "balanced",
  "placeholder-ok",
  "provided-only",
  "public-assets",
  "ai-generated",
  "hybrid",
  "minimal"
]);

export const generateDeckForbiddenStyleSchema = z.enum(["gradient", "pastel"]);

export const generateDeckDesignConstraintsSchema = z.object({
  canvasBackground: z.enum(["auto", "white"]).default("auto"),
  forbiddenStyles: z.array(generateDeckForbiddenStyleSchema).default([])
}).strict();

export const generateDeckColorIntentSchema = z.object({
  mood: z
    .enum([
      "auto",
      "calm",
      "trustworthy",
      "relaxed",
      "energetic",
      "premium",
      "creative"
    ])
    .default("auto"),
  trustLevel: z.enum(["low", "medium", "high"]).default("medium"),
  energyLevel: z.enum(["low", "medium", "high"]).default("medium"),
  formality: z.enum(["casual", "professional", "formal"]).default("professional"),
  preferredHue: z
    .enum([
      "auto",
      "blue",
      "teal",
      "green",
      "violet",
      "pink",
      "orange",
      "red",
      "yellow",
      "slate",
      "monochrome"
    ])
    .default("auto"),
  backgroundPreference: z.enum(["auto", "white", "light", "dark"]).default("auto"),
  forbiddenStyles: z.array(generateDeckForbiddenStyleSchema).default([])
}).strict();

export const generateDeckBriefSchema = z
  .object({
    presentationContext: z.string().trim().optional(),
    audienceText: z.string().trim().optional(),
    presentationType: z.string().trim().optional(),
    successCriteria: z.string().trim().optional(),
    durationMinutes: z.number().int().min(1).max(120).optional(),
    referencePolicy: generateDeckReferencePolicySchema.default("topic-only")
  })
  .strict()
  .default({});

export const generateDeckPaletteOverrideSchema = z
  .object({
    primary: themeColorSchema.optional(),
    secondary: themeColorSchema.optional(),
    background: themeColorSchema.optional(),
    surface: themeColorSchema.optional(),
    muted: themeColorSchema.optional(),
    border: themeColorSchema.optional(),
    text: themeColorSchema.optional(),
    accentColor: themeColorSchema.optional()
  })
  .partial()
  .strict();

export const generateDeckFontOverrideSchema = z.object({
  fontId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  headingFontFamily: z.string().trim().min(1),
  bodyFontFamily: z.string().trim().min(1),
  fallbackFamily: z.string().trim().min(1).default("Arial"),
  weights: z.array(z.number().int().positive()).default([]),
  supportsKorean: z.boolean().default(true),
  pptxEmbeddable: z.boolean().default(true),
  moodTags: z.array(z.string().trim().min(1)).default([]),
  license: z.string().trim().default(""),
  sourceUrl: z.string().trim().default(""),
  recommendedTitleSize: z.number().int().min(28).max(72).default(48),
  recommendedBodySize: z.number().int().min(14).max(36).default(22),
  lineHeight: z.number().min(1).max(1.6).default(1.15),
  widthFactor: z.number().min(0.8).max(1.4).default(1),
  overflowRisk: z.enum(["low", "medium", "high"]).default("medium")
}).strict();

export const generateDeckDesignSelectionSchema = z
  .object({
    paletteOptionId: z.string().trim().min(1).max(80),
    paletteOverride: generateDeckPaletteOverrideSchema.required(),
    fontOverride: generateDeckFontOverrideSchema,
    designPrompt: z.string().trim().max(500).optional(),
  })
  .strict();

export const generateDeckCoverPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(1000),
    audience: z.string().trim().max(500).default(""),
  })
  .strict();

export const generateDeckVisualPlanPolicySchema = z
  .object({
    mediaPolicy: generateDeckMediaPolicySchema.default("balanced")
  })
  .strict()
  .default({});

export const generateDeckDesignSchema = z
  .object({
    profile: z
      .enum([
        "executive-report",
        "startup-pitch",
        "editorial",
        "technical",
        "training"
      ])
      .optional(),
    stylePackId: z.string().trim().min(1).optional(),
    visualRhythm: z
      .enum(["auto", "clean", "editorial", "bold", "technical"])
      .default("auto"),
    densityTarget: z.enum(["low", "medium", "high"]).default("medium"),
    mediaPolicy: generateDeckMediaPolicySchema.default("balanced"),
    layoutDiversity: z.enum(["stable", "varied"]).default("stable"),
    colorIntent: generateDeckColorIntentSchema.optional(),
    constraints: generateDeckDesignConstraintsSchema.optional(),
    paletteOverride: generateDeckPaletteOverrideSchema.optional(),
    fontOverride: generateDeckFontOverrideSchema.optional(),
    referencePolicy: generateDeckReferencePolicySchema.optional()
  })
  .strict()
  .default({});

export const generateDeckSlideCountRangeSchema = z
  .object({
    min: z.number().int().min(1).max(20).default(5),
    max: z.number().int().min(1).max(20).default(8)
  })
  .strict()
  .default({})
  .superRefine((range, ctx) => {
    if (range.min > range.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["min"],
        message: "min must be less than or equal to max"
      });
    }
  });

/**
 * The deck generation pipeline never produces fewer than this many slides: the
 * worker floors both the chosen count and the requested range to this value
 * (services/python-worker/app/ai/deck_generation/pipeline.py). Consumers that
 * surface an expected slide count (e.g. the preview API) must apply the same
 * floor so the UI matches what the worker actually generates.
 */
export const MIN_GENERATED_SLIDE_COUNT = 4;

export function effectiveGeneratedSlideCountRange(range: {
  min: number;
  max: number;
}): { min: number; max: number } {
  return {
    min: Math.max(MIN_GENERATED_SLIDE_COUNT, range.min),
    max: Math.max(MIN_GENERATED_SLIDE_COUNT, range.max)
  };
}

export const generateDeckRequestSchema = z.object({
  topic: z.string().trim().min(1),
  prompt: z.string().trim().optional(),
  designPrompt: z.string().trim().optional(),
  brief: generateDeckBriefSchema,
  targetDurationMinutes: z.number().int().min(1).max(120).default(10),
  slideCountRange: generateDeckSlideCountRangeSchema,
  template: generateDeckTemplateSchema.default("default"),
  metadata: generateDeckMetadataSchema,
  design: generateDeckDesignSchema,
  savedDesignPack: savedDesignPackSelectionSchema.strict().optional(),
  visualPlanPolicy: generateDeckVisualPlanPolicySchema.optional(),
  referencePolicy: generateDeckReferencePolicySchema.optional(),
  referenceFileIds: z.array(z.string().trim().min(1)).max(10).default([]),
  officialAssetFileIds: z.array(z.string().trim().min(1)).optional(),
  references: z.array(generateDeckReferenceSchema).max(10).default([]),
  referenceKeywords: z.array(generateDeckReferenceKeywordSchema).default([]),
  referenceContext: z.array(generateDeckReferenceContextSchema).default([]),
  coachingContext: z
    .object({
      briefRef: frozenBriefRefSchema,
      evaluatorLensRef: evaluatorLensRefSchema,
    })
    .strict()
    .nullable()
    .default(null)
}).strict();

export const generateDeckStoredJobPayloadSchema = z
  .object({
    request: generateDeckRequestSchema,
    designPackSnapshot: savedDesignPackSnapshotSchema.optional(),
    imageAssetScope: z
      .object({
        userId: z.string().trim().min(1)
      })
      .strict()
      .optional(),
    requestedByUserId: z.string().trim().min(1).optional(),
    designSelection: generateDeckDesignSelectionSchema.optional(),
    coverPlan: generateDeckCoverPlanSchema.optional()
  })
  .strict();

export const generateDeckStartResponseSchema = z
  .object({ job: jobSchema })
  .strict();

export const aiDeckDesignSelectionStatusSchema = z.enum([
  "selecting",
  "selected",
  "generating",
  "failed",
  "cancelled",
]);

export const aiDeckDesignSelectionResponseSchema = z
  .object({
    jobId: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
    status: aiDeckDesignSelectionStatusSchema,
    styleContext: z
      .object({
        topic: z.string().trim().min(1),
        tone: aiDeckToneSchema,
      })
      .strict(),
    selection: generateDeckDesignSelectionSchema.nullable(),
  })
  .strict();

export const deckColorOptionRequestSchema = z.object({
  topic: z.string().trim().min(1),
  colorMood: z.string().trim().default(""),
  stylePackId: z.string().trim().min(1).default("brandlogy-modern"),
  colorIntent: generateDeckColorIntentSchema.optional(),
  constraints: generateDeckDesignConstraintsSchema.optional()
});

export const deckColorOptionSchema = z.object({
  optionId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  palette: generateDeckPaletteOverrideSchema,
  rationale: z.string().trim().default("")
});

export const deckColorOptionsResponseSchema = z.object({
  options: z.array(deckColorOptionSchema).length(3)
});

export const deckColorPaletteSchema = generateDeckPaletteOverrideSchema.required();

export const deckColorCustomizationRequestSchema = z
  .object({
    topic: z.string().trim().min(1).max(200),
    instruction: z.string().trim().min(1).max(500),
    basePalette: deckColorPaletteSchema,
    stylePackId: z.string().trim().min(1).default("brandlogy-modern"),
    tone: z.enum(["professional", "friendly", "confident", "concise"])
  })
  .strict();

export const deckColorCustomizationResponseSchema = z
  .object({
    option: z
      .object({
        optionId: z.string().trim().min(1),
        name: z.string().trim().min(1),
        palette: deckColorPaletteSchema,
        rationale: z.string().trim().default("")
      })
      .strict()
  })
  .strict();

export const generateDeckValidationIssueSchema = z.object({
  code: z.string().trim().min(1).default("UNSPECIFIED"),
  scope: z.enum(["deck", "slide", "element"]),
  severity: z.enum(["warning", "error"]).default("warning"),
  blocking: z.boolean().default(false),
  path: z.string().default(""),
  message: z.string().min(1)
});

export const generateDeckValidationSchema = z
  .object({
    passed: z.boolean(),
    layoutIssues: z.array(generateDeckValidationIssueSchema).default([]),
    contentIssues: z.array(generateDeckValidationIssueSchema).default([]),
    designIssues: z.array(generateDeckValidationIssueSchema).default([]),
    presentationIssues: z.array(generateDeckValidationIssueSchema).default([])
  })
  .superRefine((validation, ctx) => {
    const issueCount =
      validation.layoutIssues.length +
      validation.contentIssues.length +
      validation.designIssues.length +
      validation.presentationIssues.length;
    if (validation.passed && issueCount > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passed"],
        message: "passed must be false when validation contains any issue"
      });
    }
  });

export const templateSelectionItemSchema = z.object({
  generatedOrder: z.number().int().positive(),
  sourceSlideIndex: z.number().int().positive(),
  selectionReason: z.string().trim().min(1).optional()
});

export const generateDeckRepairReasonSchema = z.enum([
  "SLIDE_COUNT_SHORT",
  "CONTENT_DUPLICATED",
  "CONTENT_CAPACITY",
  "UNSUPPORTED_NUMERIC_CLAIM",
  "SPEAKER_NOTES_SHORT",
  "SPEAKER_NOTES_LONG",
  "SPEAKER_NOTES_REPEATED"
]);

export const generateDeckVisualIssueCodeSchema = z.enum([
  "FOCAL_POINT_WEAK",
  "BALANCE_WEAK",
  "IMAGE_CONTENT_MISMATCH",
  "IMAGE_CROP_WEAK",
  "LAYOUT_REPETITIVE",
  "BACKGROUND_RHYTHM_FLAT",
  "CARD_OVERUSED",
  "COLOR_HARMONY_WEAK",
  "VISUAL_STYLE_INCONSISTENT"
]);

export const generateDeckVisualRepairActionTypeSchema = z.enum([
  "changeComposition",
  "increaseFocalScale",
  "replaceImage",
  "changeCrop",
  "switchBackgroundMode",
  "reduceCards",
  "promoteMetric",
  "shortenCopy",
  "moveSupportingContent"
]);

export const generateDeckVisualRepairActionSchema = z.object({
  action: generateDeckVisualRepairActionTypeSchema,
  slideId: deckSlideIdSchema,
  targetElementId: deckElementIdSchema.optional(),
  compositionId: deckCompositionIdSchema.optional(),
  backgroundMode: deckCompositionBackgroundModeSchema.optional(),
  reason: z.string().trim().min(1)
});

export const generateDeckWarningCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/);

export const generateDeckResearchQualitySchema = z.enum([
  "not-run",
  "complete",
  "partial",
  "unavailable"
]);

export const generateDeckResearchIssueCodeSchema = z.enum([
  "provider-unavailable",
  "provider-call-failed",
  "no-citations",
  "vetting-failed",
  "official-missing",
  "independent-missing",
  "fact-coverage"
]);

export const generateDeckDiagnosticsSchema = z
  .object({
    referencePolicy: generateDeckReferencePolicySchema.default("topic-only"),
    uploadedSourceCount: z.number().int().nonnegative().default(0),
    webSourceCount: z.number().int().nonnegative().default(0),
    researchAttempts: z.number().int().nonnegative().default(0),
    relevantWebSourceCount: z.number().int().nonnegative().default(0),
    officialWebSourceCount: z.number().int().nonnegative().default(0),
    independentWebSourceCount: z.number().int().nonnegative().default(0),
    researchQuality: generateDeckResearchQualitySchema.default("not-run"),
    researchIssueCodes: z
      .array(generateDeckResearchIssueCodeSchema)
      .default([]),
    researchFactCoverageSatisfied: z.boolean().default(false),
    repairAttempted: z.boolean().default(false),
    repairReasons: z.array(generateDeckRepairReasonSchema).default([]),
    uniqueCoreLayoutCount: z.number().int().nonnegative().default(0),
    validationIssueCount: z.number().int().nonnegative().default(0),
    warningCodes: z.array(generateDeckWarningCodeSchema).default([]),
    visualQaStatus: z
      .enum(["not-run", "passed", "advisory", "failed", "unavailable"])
      .optional(),
    visualReviewAttempts: z.number().int().nonnegative().optional(),
    visualRepairAttempts: z.number().int().nonnegative().optional(),
    visualIssueCodes: z.array(generateDeckVisualIssueCodeSchema).optional(),
    visualIssueSlideOrders: z.array(z.number().int().positive()).optional()
  })
  .strict()
  .default({});

export const generateDeckResponseSchema = z.object({
  deck: deckSchema,
  templateSelection: z.array(templateSelectionItemSchema).optional(),
  warnings: z.array(z.string()).default([]),
  validation: generateDeckValidationSchema,
  diagnostics: generateDeckDiagnosticsSchema
});

export const generateDeckJobResultSchema = generateDeckResponseSchema
  .extend({
    deckId: deckIdSchema,
    coachingProvenance: z
      .object({
        briefRef: frozenBriefRefSchema,
        evaluatorLensRef: evaluatorLensRefSchema,
      })
      .strict()
      .nullable()
      .default(null)
  })
  .superRefine((result, ctx) => {
    if (result.deckId !== result.deck.deckId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deckId"],
        message: "deckId must match deck.deckId"
      });
    }
  });

export type GenerateDeckTemplate = z.infer<typeof generateDeckTemplateSchema>;
export type GenerateDeckReference = z.infer<typeof generateDeckReferenceSchema>;
export type GenerateDeckReferenceKeyword = z.infer<
  typeof generateDeckReferenceKeywordSchema
>;
export type GenerateDeckReferenceContext = z.infer<
  typeof generateDeckReferenceContextSchema
>;
export type GenerateDeckMetadata = z.infer<typeof generateDeckMetadataSchema>;
export type GenerateDeckReferencePolicy = z.infer<
  typeof generateDeckReferencePolicySchema
>;
export type GenerateDeckMediaPolicy = z.infer<
  typeof generateDeckMediaPolicySchema
>;
export type GenerateDeckForbiddenStyle = z.infer<
  typeof generateDeckForbiddenStyleSchema
>;
export type GenerateDeckDesignConstraints = z.infer<
  typeof generateDeckDesignConstraintsSchema
>;
export type GenerateDeckColorIntent = z.infer<
  typeof generateDeckColorIntentSchema
>;
export type GenerateDeckBrief = z.infer<typeof generateDeckBriefSchema>;
export type GenerateDeckPaletteOverride = z.infer<
  typeof generateDeckPaletteOverrideSchema
>;
export type GenerateDeckFontOverride = z.infer<
  typeof generateDeckFontOverrideSchema
>;
export type GenerateDeckVisualPlanPolicy = z.infer<
  typeof generateDeckVisualPlanPolicySchema
>;
export type GenerateDeckDesign = z.infer<typeof generateDeckDesignSchema>;
export type GenerateDeckSlideCountRange = z.infer<
  typeof generateDeckSlideCountRangeSchema
>;
export type GenerateDeckRequest = z.infer<typeof generateDeckRequestSchema>;
export type GenerateDeckStoredJobPayload = z.infer<
  typeof generateDeckStoredJobPayloadSchema
>;
export type GenerateDeckDesignSelection = z.infer<
  typeof generateDeckDesignSelectionSchema
>;
export type GenerateDeckCoverPlan = z.infer<
  typeof generateDeckCoverPlanSchema
>;
export type AiDeckDesignSelectionResponse = z.infer<
  typeof aiDeckDesignSelectionResponseSchema
>;
export type DeckColorOptionRequest = z.infer<typeof deckColorOptionRequestSchema>;
export type DeckColorOption = z.infer<typeof deckColorOptionSchema>;
export type DeckColorOptionsResponse = z.infer<
  typeof deckColorOptionsResponseSchema
>;
export type DeckColorCustomizationRequest = z.infer<
  typeof deckColorCustomizationRequestSchema
>;
export type DeckColorCustomizationResponse = z.infer<
  typeof deckColorCustomizationResponseSchema
>;
export type GenerateDeckValidationIssue = z.infer<
  typeof generateDeckValidationIssueSchema
>;
export type GenerateDeckValidation = z.infer<typeof generateDeckValidationSchema>;
export type TemplateSelectionItem = z.infer<typeof templateSelectionItemSchema>;
export type GenerateDeckResponse = z.infer<typeof generateDeckResponseSchema>;
export type GenerateDeckDiagnostics = z.infer<
  typeof generateDeckDiagnosticsSchema
>;
export type GenerateDeckWarningCode = z.infer<
  typeof generateDeckWarningCodeSchema
>;
export type GenerateDeckResearchQuality = z.infer<
  typeof generateDeckResearchQualitySchema
>;
export type GenerateDeckResearchIssueCode = z.infer<
  typeof generateDeckResearchIssueCodeSchema
>;
export type GenerateDeckVisualIssueCode = z.infer<
  typeof generateDeckVisualIssueCodeSchema
>;
export type GenerateDeckVisualRepairAction = z.infer<
  typeof generateDeckVisualRepairActionSchema
>;
export type GenerateDeckJobResult = z.infer<typeof generateDeckJobResultSchema>;
