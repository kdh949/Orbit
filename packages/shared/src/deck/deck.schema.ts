import { z } from "zod";

import {
  activityDefinitionSchema,
  activityResultDefinitionSchema
} from "../activity/activity-definition.schema";
import { animationSchema } from "./animation.schema";
import {
  deckCompositionBackgroundModeSchema,
  deckCompositionIdSchema
} from "./composition.schema";
import {
  deckElementIdSchema,
  deckIdSchema,
  deckKeywordIdSchema,
  deckKeywordOccurrenceIdSchema,
  deckSlideIdSchema
} from "./id.schema";
import { deriveKeywordOccurrences } from "./keyword-occurrences";
import { semanticCueSchema } from "./semantic-cue.schema";
import { slideActionSchema } from "./slide-action.schema";
import { deckElementSchema, ooxmlOriginSchema } from "./slide-object.schema";
import { savedDesignPackSnapshotSchema } from "./saved-design-pack.schema";
import { themeColorSchema, themeSchema } from "./theme.schema";

export const deckSourceTypeSchema = z.enum(["manual", "import", "ai"]);

export const deckThumbnailSourceSchema = z.enum([
  "canvas",
  "import-render"
]);

export const aiDeckAudienceSchema = z.enum([
  "general",
  "executive",
  "technical",
  "sales"
]);

export const aiDeckPurposeSchema = z.enum([
  "inform",
  "persuade",
  "teach",
  "report"
]);

export const aiDeckToneSchema = z.enum([
  "professional",
  "friendly",
  "confident",
  "concise"
]);

export const aiDeckPresentationProfileSchema = z.enum([
  "proposal",
  "executive-report",
  "product-launch",
  "education",
  "technical",
  "research",
  "general-inform"
]);

export const deckDesignProgramSnapshotSchema = z.object({
  version: z.string().trim().min(1),
  visualConcept: z.string().trim().min(1),
  paletteRoles: z.record(themeColorSchema),
  typography: z.object({
    headingFont: z.string().trim().min(1),
    bodyFont: z.string().trim().min(1),
    typeScale: z.record(z.number().finite().positive())
  }),
  backgroundSequence: z.array(deckCompositionBackgroundModeSchema).min(1),
  imageStyle: z.string().trim().min(1),
  surfaceStyle: z.string().trim().min(1),
  compositionIds: z.array(deckCompositionIdSchema).min(1)
});

export const deckCreatedFromReferenceSchema = z.object({
  fileId: z.string().min(1)
});

export const deckCreatedFromSchema = z.object({
  topic: z.string().min(1),
  references: z.array(deckCreatedFromReferenceSchema).default([]),
  designReferences: z.array(deckCreatedFromReferenceSchema).default([])
});

export const deckGenerationQualityIssueSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  severity: z.enum(["warning", "risk"]).default("warning"),
  slideId: deckSlideIdSchema.optional(),
  slideOrder: z.number().int().positive().optional()
});

export const deckGenerationQualitySchema = z.object({
  status: z.enum(["passed", "advisory", "unavailable"]),
  issues: z.array(deckGenerationQualityIssueSchema).default([])
});

export const deckMetadataSchema = z.object({
  language: z.literal("ko").default("ko"),
  locale: z.literal("ko-KR").default("ko-KR"),
  sourceType: deckSourceTypeSchema.optional(),
  thumbnailSource: deckThumbnailSourceSchema.optional(),
  generatedBy: z.literal("ai").optional(),
  audience: aiDeckAudienceSchema.optional(),
  purpose: aiDeckPurposeSchema.optional(),
  tone: aiDeckToneSchema.optional(),
  presentationProfile: aiDeckPresentationProfileSchema.optional(),
  generationQuality: deckGenerationQualitySchema.optional(),
  designPackSnapshot: z.lazy(() => savedDesignPackSnapshotSchema).optional(),
  designProgramSnapshot: deckDesignProgramSnapshotSchema.optional(),
  createdFrom: deckCreatedFromSchema.optional()
});

export const wideDeckCanvasSchema = z.object({
  preset: z.literal("wide-16-9"),
  width: z.literal(1920),
  height: z.literal(1080),
  aspectRatio: z.literal("16:9")
});

export const standardDeckCanvasSchema = z.object({
  preset: z.literal("standard-4-3"),
  width: z.literal(1024),
  height: z.literal(768),
  aspectRatio: z.literal("4:3")
});

export const deckCanvasSchema = z.discriminatedUnion("preset", [
  wideDeckCanvasSchema,
  standardDeckCanvasSchema
]);

export const keywordTermSchema = z.string().trim().min(1);

export const keywordSchema = z.object({
  keywordId: deckKeywordIdSchema,
  text: keywordTermSchema,
  synonyms: z.array(keywordTermSchema).default([]),
  abbreviations: z.array(keywordTermSchema).default([]),
  required: z.boolean().default(true),
  requiredOccurrenceIds: z.array(deckKeywordOccurrenceIdSchema).optional()
});

export const slideKeywordsSchema = z
  .array(keywordSchema)
  .superRefine((keywords, ctx) => {
    const keywordIds = new Set<string>();
    const terms = new Set<string>();

    keywords.forEach((keyword, keywordIndex) => {
      requireUniqueKeywordId(ctx, keywordIds, keyword.keywordId, [
        keywordIndex,
        "keywordId"
      ]);
      requireUniqueKeywordTerm(ctx, terms, keyword.text, [
        keywordIndex,
        "text"
      ]);

      keyword.synonyms.forEach((synonym, synonymIndex) => {
        requireUniqueKeywordTerm(ctx, terms, synonym, [
          keywordIndex,
          "synonyms",
          synonymIndex
        ]);
      });

      keyword.abbreviations.forEach((abbreviation, abbreviationIndex) => {
        requireUniqueKeywordTerm(ctx, terms, abbreviation, [
          keywordIndex,
          "abbreviations",
          abbreviationIndex
        ]);
      });
    });
  });

export const slideOrderSchema = z.number().int().positive();

export const slideTransitionSchema = z.object({
  type: z.literal("fade"),
  durationMs: z.number().int().positive()
});

export const importedMainSequenceCoverageSchema = z.enum([
  "unknown",
  "absent",
  "partial",
  "complete"
]);

export const ooxmlMotionCapabilitiesSchema = z.object({
  transitionWritable: z.boolean(),
  importedMainSequenceCoverage: importedMainSequenceCoverageSchema
});

export const slideLayoutSchema = z.enum([
  "title",
  "title-content",
  "section",
  "two-column",
  "image-left",
  "image-right",
  "chart-focus",
  "quote",
  "closing"
]);

export const slideBackgroundImageFitSchema = z.enum([
  "contain",
  "cover",
  "stretch"
]);

export const slideBackgroundImageSchema = z.object({
  src: z.string().min(1),
  alt: z.string().default(""),
  fit: slideBackgroundImageFitSchema.default("cover"),
  opacity: z.number().finite().min(0).max(1).default(1)
});

export const slideStyleSchema = z
  .object({
    layout: slideLayoutSchema.optional(),
    fontFamily: z.string().min(1).optional(),
    backgroundColor: themeColorSchema.optional(),
    textColor: themeColorSchema.optional(),
    accentColor: themeColorSchema.optional(),
    backgroundImage: slideBackgroundImageSchema.optional()
  })
  .default({});

export const slideSourceEvidenceSchema = z.object({
  fileId: z.string().min(1),
  quote: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  confidence: z.number().finite().min(0).max(1).default(0.5)
});

export const slideVisualPlanSchema = z.object({
  visualType: z.string().min(1),
  imageNeeded: z.boolean().default(false),
  imageSourcePolicy: z.string().min(1).default("minimal"),
  reason: z.string().min(1),
  imagePrompt: z.string().trim().min(1).optional(),
  imageAlt: z.string().trim().min(1).optional(),
  imagePlacement: z.string().trim().min(1).optional(),
  asset: z
    .object({
      fileId: z.string().min(1),
      provider: z.string().min(1),
      sourceUrl: z.string().url().optional(),
      sourceAssetUrl: z.string().url().optional(),
      sourceAuthority: z.enum(["official", "independent", "unknown"]).optional(),
      usageBasis: z
        .enum(["user-provided", "licensed", "official-reference", "generated"])
        .optional(),
      author: z.string().min(1).optional(),
      license: z.string().min(1).optional(),
      checkedAt: z.string().datetime().optional()
    })
    .optional()
});

export const slideSourceLedgerSchema = z.object({
  claim: z.string().min(1),
  source: z.string().min(1),
  sourceType: z.enum(["topic", "uploaded", "web", "generated", "none"]),
  sourceId: z.string().min(1).optional(),
  fileId: z.string().min(1).optional(),
  chunkId: z.string().min(1).optional(),
  url: z.string().url().optional(),
  title: z.string().min(1).optional(),
  authority: z.enum(["official", "independent", "unknown"]).optional(),
  confidence: z.number().finite().min(0).max(1).default(0.5),
  usedInSlideId: deckSlideIdSchema
});

export const slideTimingPlanSchema = z.object({
  charsPerMinute: z.number().int().positive().optional(),
  speakingTimeRatio: z.number().finite().min(0).max(1).optional(),
  targetTotalChars: z.number().int().nonnegative().optional(),
  targetSlideCount: z.number().int().positive().optional(),
  targetSecondsPerSlide: z.number().int().positive().optional(),
  targetSpeakerNotesCharsPerSlide: z.number().int().nonnegative().optional(),
  targetSeconds: z.number().int().positive(),
  targetSpokenSeconds: z.number().int().positive().optional(),
  targetSpeakerNotesChars: z.number().int().nonnegative(),
  actualSpeakerNotesChars: z.number().int().nonnegative()
});

export const slideCompositionPlanSchema = z.object({
  compositionId: deckCompositionIdSchema,
  variant: z.string().trim().min(1),
  backgroundMode: deckCompositionBackgroundModeSchema,
  focalType: z.string().trim().min(1),
  primaryFocalElementId: deckElementIdSchema.optional(),
  assetRole: z.enum(["evidence", "atmosphere", "decoration", "none"]),
  requiredAsset: z.boolean()
});

export const slideAiNotesSchema = z
  .object({
    emphasisPoints: z.array(z.string().min(1)).default([]),
    sourceEvidence: z.array(slideSourceEvidenceSchema).default([]),
    visualPlan: slideVisualPlanSchema.optional(),
    sourceLedger: z.array(slideSourceLedgerSchema).optional(),
    timingPlan: slideTimingPlanSchema.optional(),
    compositionPlan: slideCompositionPlanSchema.optional()
  })
  .default({});

export const slideKindSchema = z.enum([
  "content",
  "activity",
  "activity-results"
]);

const slideBaseSchema = z.object({
    slideId: deckSlideIdSchema,
    ooxmlOrigin: ooxmlOriginSchema.optional(),
    ooxmlSourceSlidePart: z
      .string()
      .regex(/^ppt\/slides\/slide[^/]+\.xml$/)
      .optional(),
    ooxmlMotionCapabilities: ooxmlMotionCapabilitiesSchema.optional(),
    order: slideOrderSchema,
    title: z.string().default(""),
    thumbnailUrl: z.string().default(""),
    estimatedSeconds: z.number().int().positive().optional(),
    transition: slideTransitionSchema.optional(),
    style: slideStyleSchema,
    speakerNotes: z.string().default(""),
    elements: z.array(deckElementSchema).default([]),
    keywords: slideKeywordsSchema.default([]),
    semanticCues: z.array(semanticCueSchema).default([]),
    animations: z.array(animationSchema).default([]),
    actions: z.array(slideActionSchema).default([]),
    aiNotes: slideAiNotesSchema.optional()
  });

export const contentSlideSchema = slideBaseSchema.extend({
  kind: z.literal("content")
});

export const activitySlideSchema = slideBaseSchema
  .extend({
    kind: z.literal("activity"),
    activity: activityDefinitionSchema
  })
  .strict();

export const activityResultsSlideSchema = slideBaseSchema
  .extend({
    kind: z.literal("activity-results"),
    activityResult: activityResultDefinitionSchema
  })
  .strict();

const normalizedSlideSchema = z.discriminatedUnion("kind", [
  contentSlideSchema,
  activitySlideSchema,
  activityResultsSlideSchema
]);

export type Slide = z.infer<typeof normalizedSlideSchema>;
export type SlideTransition = z.infer<typeof slideTransitionSchema>;
export type ImportedMainSequenceCoverage = z.infer<
  typeof importedMainSequenceCoverageSchema
>;
export type OoxmlMotionCapabilities = z.infer<
  typeof ooxmlMotionCapabilitiesSchema
>;

export const slideSchema: z.ZodType<Slide, z.ZodTypeDef, unknown> = z
  .preprocess((input) => {
    if (
      typeof input === "object" &&
      input !== null &&
      !Array.isArray(input) &&
      !("kind" in input)
    ) {
      return { ...input, kind: "content" };
    }
    return input;
  }, normalizedSlideSchema)
  .superRefine((slide, ctx) => {
    const actionIds = new Set<string>();
    const elementIds = new Set(slide.elements.map((element) => element.elementId));
    const keywordIds = new Set(slide.keywords.map((keyword) => keyword.keywordId));
    const semanticCueIds = new Set<string>();
    const keywordOccurrences = new Map(
      deriveKeywordOccurrences(slide).map((occurrence) => [
        occurrence.occurrenceId,
        occurrence
      ])
    );
    const animationIds = new Set(
      slide.animations.map((animation) => animation.animationId)
    );
    const focalElementId = slide.aiNotes?.compositionPlan?.primaryFocalElementId;

    if (
      focalElementId !== undefined &&
      !slide.elements.some((element) => element.elementId === focalElementId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aiNotes", "compositionPlan", "primaryFocalElementId"],
        message: "primary focal element must exist in the same slide"
      });
    }

    slide.keywords.forEach((keyword, keywordIndex) => {
      keyword.requiredOccurrenceIds?.forEach((occurrenceId, occurrenceIndex) => {
        const occurrence = keywordOccurrences.get(occurrenceId);
        const path = ["keywords", keywordIndex, "requiredOccurrenceIds", occurrenceIndex];

        if (occurrence === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: "required keyword occurrence must exist in speaker notes"
          });
          return;
        }

        if (occurrence.keywordId !== keyword.keywordId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: "required keyword occurrence must belong to the keyword"
          });
        }
      });
    });

    slide.actions.forEach((action, actionIndex) => {
      if (actionIds.has(action.actionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actions", actionIndex, "actionId"],
          message: "slide action IDs must be unique within the same slide"
        });
      } else {
        actionIds.add(action.actionId);
      }

      if (
        action.trigger.kind === "keyword" &&
        !keywordIds.has(action.trigger.keywordId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actions", actionIndex, "trigger", "keywordId"],
          message: "slide action must target a keyword in the same slide"
        });
      }

      if (action.trigger.kind === "keyword-occurrence") {
        if (!keywordIds.has(action.trigger.keywordId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["actions", actionIndex, "trigger", "keywordId"],
            message: "slide action must target a keyword in the same slide"
          });
        }

        const occurrence = keywordOccurrences.get(action.trigger.occurrenceId);

        if (occurrence === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["actions", actionIndex, "trigger", "occurrenceId"],
            message: "slide action must target a keyword occurrence in speaker notes"
          });
        } else if (occurrence.keywordId !== action.trigger.keywordId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["actions", actionIndex, "trigger", "occurrenceId"],
            message: "slide action keyword occurrence must match trigger keyword"
          });
        }
      }

      if (
        action.effect.kind === "play-animation" &&
        !animationIds.has(action.effect.animationId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actions", actionIndex, "effect", "animationId"],
          message: "slide action must target an animation in the same slide"
        });
      }
    });

    slide.semanticCues.forEach((cue, cueIndex) => {
      if (semanticCueIds.has(cue.cueId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["semanticCues", cueIndex, "cueId"],
          message: "semantic cue IDs must be unique within the same slide"
        });
      } else {
        semanticCueIds.add(cue.cueId);
      }

      if (cue.slideId !== slide.slideId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["semanticCues", cueIndex, "slideId"],
          message: "semantic cue slideId must match the containing slide"
        });
      }

      cue.targetElementIds.forEach((elementId, elementIndex) => {
        if (!elementIds.has(elementId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["semanticCues", cueIndex, "targetElementIds", elementIndex],
            message: "semantic cue target element must exist in the same slide"
          });
        }
      });

      cue.triggerActionIds.forEach((actionId, actionIndex) => {
        if (!actionIds.has(actionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["semanticCues", cueIndex, "triggerActionIds", actionIndex],
            message: "semantic cue trigger action must exist in the same slide"
          });
        }
      });
    });
  });

const deckObjectSchema = z.object({
  deckId: deckIdSchema,
  projectId: z.string().min(1),
  title: z.string().min(1),
  version: z.number().int().positive(),
  metadata: deckMetadataSchema.default({}),
  targetDurationMinutes: z.number().int().positive().default(10),
  canvas: deckCanvasSchema,
  theme: themeSchema.default({}),
  slides: z.array(slideSchema).min(1)
});

export const deckShellSchema = deckObjectSchema.omit({ slides: true });

export const deckSchema = deckObjectSchema.superRefine((deck, ctx) => {
  const activityIds = new Set<string>();
  const hasActivitySlides = deck.slides.some(
    (slide) => slide.kind === "activity" || slide.kind === "activity-results"
  );

  if (hasActivitySlides && deck.canvas.preset !== "wide-16-9") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["canvas", "preset"],
      message: "Decks with Activity slides must use the wide-16-9 canvas"
    });
  }

  deck.slides.forEach((slide, index) => {
    if (slide.kind !== "activity") {
      return;
    }

    if (activityIds.has(slide.activity.activityId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slides", index, "activity", "activityId"],
        message: "activity IDs must be unique within a Deck"
      });
    }
    activityIds.add(slide.activity.activityId);
  });
});

export type Deck = z.infer<typeof deckSchema>;
export type DeckShell = z.infer<typeof deckShellSchema>;
export type DeckCanvas = z.infer<typeof deckCanvasSchema>;
export type DeckMetadata = z.infer<typeof deckMetadataSchema>;
export type DeckSourceType = z.infer<typeof deckSourceTypeSchema>;
export type DeckThumbnailSource = z.infer<typeof deckThumbnailSourceSchema>;
export type AiDeckAudience = z.infer<typeof aiDeckAudienceSchema>;
export type AiDeckPurpose = z.infer<typeof aiDeckPurposeSchema>;
export type AiDeckTone = z.infer<typeof aiDeckToneSchema>;
export type DeckDesignProgramSnapshot = z.infer<
  typeof deckDesignProgramSnapshotSchema
>;
export type DeckCreatedFrom = z.infer<typeof deckCreatedFromSchema>;
export type SlideKind = z.infer<typeof slideKindSchema>;
export type ContentSlide = z.infer<typeof contentSlideSchema>;
export type ActivitySlide = z.infer<typeof activitySlideSchema>;
export type ActivityResultsSlide = z.infer<typeof activityResultsSlideSchema>;
export type SlideLayout = z.infer<typeof slideLayoutSchema>;
export type SlideStyle = z.infer<typeof slideStyleSchema>;
export type SlideBackgroundImage = z.infer<typeof slideBackgroundImageSchema>;
export type SlideBackgroundImageFit = z.infer<
  typeof slideBackgroundImageFitSchema
>;
export type SlideSourceEvidence = z.infer<typeof slideSourceEvidenceSchema>;
export type SlideVisualPlan = z.infer<typeof slideVisualPlanSchema>;
export type SlideSourceLedger = z.infer<typeof slideSourceLedgerSchema>;
export type SlideTimingPlan = z.infer<typeof slideTimingPlanSchema>;
export type SlideCompositionPlan = z.infer<typeof slideCompositionPlanSchema>;
export type SlideAiNotes = z.infer<typeof slideAiNotesSchema>;
export type KeywordTerm = z.infer<typeof keywordTermSchema>;
export type Keyword = z.infer<typeof keywordSchema>;

function requireUniqueKeywordId(
  ctx: z.RefinementCtx,
  seen: Set<string>,
  value: string,
  path: Array<string | number>
): void {
  if (seen.has(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "keyword IDs must be unique within the same slide"
    });
    return;
  }

  seen.add(value);
}

function requireUniqueKeywordTerm(
  ctx: z.RefinementCtx,
  seen: Set<string>,
  rawValue: string,
  path: Array<string | number>
): void {
  const value = rawValue.toLocaleLowerCase("ko-KR");

  if (seen.has(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "keyword terms must be unique within the same slide"
    });
    return;
  }

  seen.add(value);
}
