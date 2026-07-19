import { z } from "zod";

import {
  deckElementIdSchema,
  deckIdSchema,
  deckSlideIdSchema,
} from "./id.schema";
import { ooxmlMotionCapabilitiesSchema } from "./deck.schema";
import {
  deckElementTypeSchema,
  ooxmlElementEditCapabilitiesSchema,
  ooxmlOriginSchema,
} from "./slide-object.schema";

export const templateBlueprintIdSchema = z
  .string()
  .regex(/^template_[A-Za-z0-9_-]+$/);

export const templateSlotUsageSchema = z.enum([
  "content-slot",
  "media-slot",
  "fixed-text",
  "decoration",
]);

export const templateSlotRoleSchema = z.enum([
  "title",
  "subtitle",
  "body",
  "caption",
  "label",
  "metric",
  "image",
  "image_placeholder",
  "logo",
  "chart",
  "table",
  "background",
  "unknown",
]);

export const templateSlotReplaceModeSchema = z.enum([
  "replace",
  "preserve",
  "ignore",
]);

export const templateSlotBoundsSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export const templateSlotSourceSchema = z
  .object({
    type: z.enum([
      "placeholder",
      "slide",
      "layout",
      "master",
      "table",
      "image",
      "shape",
      "unknown",
    ]),
    name: z.string().min(1).optional(),
    placeholderType: z.string().min(1).optional(),
    slidePart: z.string().min(1).optional(),
    shapeId: z.string().min(1).optional(),
    relationshipId: z.string().min(1).optional(),
  })
  .passthrough();

export const templateTableCellLocatorSchema = z.object({
  rowIndex: z.number().int().min(0).max(999),
  columnIndex: z.number().int().min(0).max(999),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export const templateTableCellLocatorsSchema = z
  .array(templateTableCellLocatorSchema)
  .min(1)
  .max(10_000)
  .superRefine((locators, ctx) => {
    const coordinates = new Set<string>();
    const columnCount =
      Math.max(...locators.map((locator) => locator.columnIndex)) + 1;
    locators.forEach((locator, index) => {
      const coordinate = `${locator.rowIndex}:${locator.columnIndex}`;
      if (coordinates.has(coordinate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "table cell locator coordinates must be unique",
          path: [index],
        });
      }
      coordinates.add(coordinate);
      const previous = locators[index - 1];
      if (
        previous &&
        (locator.rowIndex < previous.rowIndex ||
          (locator.rowIndex === previous.rowIndex &&
            locator.columnIndex <= previous.columnIndex))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "table cell locators must be in row-major order",
          path: [index],
        });
      }
      const expectedRowIndex = Math.floor(index / columnCount);
      const expectedColumnIndex = index % columnCount;
      if (
        locator.rowIndex !== expectedRowIndex ||
        locator.columnIndex !== expectedColumnIndex
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "table cell locators must form a complete rectangular grid from 0:0",
          path: [index],
        });
      }
    });
    if (locators.length % columnCount !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "table cell locator rows must have the same column count",
      });
    }
  });

export const templateElementSourceSchema = z
  .object({
    elementId: deckElementIdSchema,
    elementType: deckElementTypeSchema.optional(),
    ooxmlOrigin: ooxmlOriginSchema.optional(),
    ooxmlEditCapabilities: ooxmlElementEditCapabilitiesSchema.optional(),
    slidePart: z.string().min(1),
    shapeId: z.string().min(1),
    relationshipId: z.string().min(1).optional(),
    sourceType: z.enum([
      "placeholder",
      "slide",
      "layout",
      "master",
      "table",
      "image",
      "shape",
      "unknown",
    ]),
    writable: z.boolean(),
    tableCellLocators: templateTableCellLocatorsSchema.optional(),
    fallbackReason: z.string().min(1).optional(),
  })
  .superRefine((source, ctx) => {
    if (source.ooxmlEditCapabilities?.tableCellText === true) {
      const hasAuthoritativeTableSource =
        source.elementType === "table" &&
        source.sourceType === "table" &&
        source.writable &&
        source.fallbackReason === undefined &&
        source.tableCellLocators !== undefined;
      if (!hasAuthoritativeTableSource) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "table cell text capability requires an authoritative writable table source",
          path: ["ooxmlEditCapabilities", "tableCellText"],
        });
      }
    }
    if (
      source.tableCellLocators &&
      (source.sourceType !== "table" ||
        (source.elementType !== undefined && source.elementType !== "table"))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "table cell locators require a table source",
        path: ["tableCellLocators"],
      });
    }
  });

export const templateBlueprintSlotSchema = z.object({
  elementId: deckElementIdSchema,
  usage: templateSlotUsageSchema,
  slotRole: templateSlotRoleSchema,
  replaceMode: templateSlotReplaceModeSchema,
  confidence: z.number().finite().min(0).max(1),
  bounds: templateSlotBoundsSchema,
  source: templateSlotSourceSchema,
});

export const templateBlueprintSlideSchema = z
  .object({
    slideId: deckSlideIdSchema.optional(),
    slideIndex: z.number().int().positive(),
    sourceSlideIndex: z.number().int().positive(),
    sourceSlidePart: z
      .string()
      .regex(/^ppt\/slides\/slide[^/]+\.xml$/)
      .optional(),
    ooxmlOrigin: ooxmlOriginSchema.optional(),
    ooxmlMotionCapabilities: ooxmlMotionCapabilitiesSchema.optional(),
    cloneSourceSlideIndex: z.number().int().positive().optional(),
    cloneSourceSlidePart: z.string().min(1).optional(),
    slideRole: z.string().trim().min(1).optional(),
    layoutType: z.string().trim().min(1).optional(),
    contentCapacity: z.enum(["low", "medium", "high"]).optional(),
    selectionReason: z.string().trim().min(1).optional(),
    renderAssetFileId: z.string().min(1).optional(),
    fallbackRenderAssetFileId: z.string().min(1).optional(),
    elementSources: z.array(templateElementSourceSchema).default([]),
    slots: z.array(templateBlueprintSlotSchema).default([]),
  })
  .transform((slide) => {
    if (slide.sourceSlidePart) return slide;
    const writableSlideParts = [
      ...new Set(
        slide.elementSources
          .filter((source) => source.writable)
          .map((source) => source.slidePart)
          .filter((slidePart) =>
            /^ppt\/slides\/slide[^/]+\.xml$/.test(slidePart),
          ),
      ),
    ];
    return writableSlideParts.length === 1
      ? { ...slide, sourceSlidePart: writableSlideParts[0] }
      : slide;
  })
  .superRefine((slide, ctx) => {
    const capabilities = slide.ooxmlMotionCapabilities;
    const hasWritableMotion =
      capabilities?.transitionWritable === true ||
      capabilities?.importedMainSequenceCoverage === "absent" ||
      capabilities?.importedMainSequenceCoverage === "complete";
    if (hasWritableMotion && !slide.sourceSlidePart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "writable motion capability requires a stable slide part",
        path: ["sourceSlidePart"],
      });
    }
  });

export const templateBlueprintSchema = z
  .object({
    templateId: templateBlueprintIdSchema,
    sourceFileId: z.string().min(1),
    sourcePackageFileId: z.string().min(1).optional(),
    currentPackageFileId: z.string().min(1).optional(),
    ooxmlSyncedDeckVersion: z.number().int().positive().optional(),
    logicalGroupElementIds: z.array(deckElementIdSchema).default([]),
    slides: z.array(templateBlueprintSlideSchema).min(1),
  })
  .superRefine((blueprint, ctx) => {
    const sourceSlidePartCounts = new Map<string, number>();
    blueprint.slides.forEach((slide) => {
      if (!slide.sourceSlidePart) return;
      sourceSlidePartCounts.set(
        slide.sourceSlidePart,
        (sourceSlidePartCounts.get(slide.sourceSlidePart) ?? 0) + 1,
      );
    });
    blueprint.slides.forEach((slide, slideIndex) => {
      const capabilities = slide.ooxmlMotionCapabilities;
      const hasWritableMotion =
        capabilities?.transitionWritable === true ||
        capabilities?.importedMainSequenceCoverage === "absent" ||
        capabilities?.importedMainSequenceCoverage === "complete";
      if (!hasWritableMotion || !slide.sourceSlidePart) return;
      if ((sourceSlidePartCounts.get(slide.sourceSlidePart) ?? 0) > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "writable motion slide part must be unambiguous",
          path: ["slides", slideIndex, "sourceSlidePart"],
        });
      }
    });
  });

const qualityScoreSchema = z.number().finite().min(0).max(100);

export const qualityReportSlideStatusSchema = z.enum([
  "passed",
  "vectorization_failed",
  "not_evaluated",
]);

export const qualityReportSlideSchema = z.object({
  slideIndex: z.number().int().positive(),
  status: qualityReportSlideStatusSchema,
  ssim: z.number().finite().min(0).max(1).nullable(),
  reasons: z.array(z.string()).default([]),
  fallback: z.enum(["rendered-background", "none"]).default("none"),
});

export const qualityReportMotionDiagnosticsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    downgraded: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    excluded: z.number().int().nonnegative(),
    details: z
      .array(
        z
          .object({
            slideIndex: z.number().int().positive(),
            code: z.enum([
              "PPTX_MOTION_EFFECT_UNSUPPORTED",
              "PPTX_MOTION_INTERACTIVE_EXCLUDED",
              "PPTX_MOTION_MEDIA_EXCLUDED",
              "PPTX_MOTION_PARAGRAPH_BUILD_DOWNGRADED",
              "PPTX_MOTION_PRESET_UNSUPPORTED",
              "PPTX_MOTION_SERIALIZATION_FAILED",
              "PPTX_MOTION_SOURCE_UNAVAILABLE",
              "PPTX_MOTION_START_MODE_UNSUPPORTED",
              "PPTX_MOTION_STRUCTURE_UNSUPPORTED",
              "PPTX_MOTION_TARGET_FLATTENED",
              "PPTX_MOTION_TARGET_UNRESOLVED",
            ]),
            count: z.number().int().positive(),
          })
          .strict(),
      )
      .max(500)
      .default([]),
  })
  .superRefine((diagnostics, ctx) => {
    if (
      diagnostics.total !==
      diagnostics.unsupported +
        diagnostics.downgraded +
        diagnostics.unresolved +
        diagnostics.excluded
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "motion diagnostic total must equal its category counts",
        path: ["total"],
      });
    }
    const detailTotal = diagnostics.details.reduce(
      (total, detail) => total + detail.count,
      0,
    );
    if (diagnostics.details.length > 0 && detailTotal !== diagnostics.total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "motion diagnostic detail counts must equal total",
        path: ["details"],
      });
    }
  });

export const qualityReportSchema = z.object({
  compositeScore: qualityScoreSchema,
  metrics: z.object({
    geometry: qualityScoreSchema,
    text: qualityScoreSchema,
    color: qualityScoreSchema,
    layer: qualityScoreSchema,
    editability: qualityScoreSchema,
    pixelSimilarity: qualityScoreSchema.nullable(),
  }),
  weights: z.object({
    geometry: z.literal(25),
    text: z.literal(15),
    color: z.literal(10),
    layer: z.literal(10),
    editability: z.literal(10),
    pixelSimilarity: z.literal(30),
  }),
  editabilityCoverage: z.number().finite().min(0).max(1),
  appliedCap: z.number().int().min(0).max(100).nullable().default(null),
  slideReports: z.array(qualityReportSlideSchema).default([]),
  motionDiagnostics: qualityReportMotionDiagnosticsSchema.optional(),
  notes: z.array(z.string()).default([]),
});

export const pptxImportJobResultSchema = z.object({
  deckId: deckIdSchema,
  templateId: templateBlueprintIdSchema,
  qualityReport: qualityReportSchema,
  warnings: z.array(z.string()).default([]),
});

export type TemplateBlueprintId = z.infer<typeof templateBlueprintIdSchema>;
export type TemplateSlotUsage = z.infer<typeof templateSlotUsageSchema>;
export type TemplateSlotRole = z.infer<typeof templateSlotRoleSchema>;
export type TemplateSlotReplaceMode = z.infer<
  typeof templateSlotReplaceModeSchema
>;
export type TemplateBlueprintSlot = z.infer<typeof templateBlueprintSlotSchema>;
export type TemplateElementSource = z.infer<typeof templateElementSourceSchema>;
export type TemplateTableCellLocator = z.infer<
  typeof templateTableCellLocatorSchema
>;
export type TemplateBlueprintSlide = z.infer<
  typeof templateBlueprintSlideSchema
>;
export type TemplateBlueprint = z.infer<typeof templateBlueprintSchema>;

export function recoverTemplateBlueprintSlideIds(
  blueprint: TemplateBlueprint,
  deckSlides: ReadonlyArray<{ slideId: string; order: number }>,
): { blueprint: TemplateBlueprint; recovered: boolean } | null {
  if (blueprint.slides.length > deckSlides.length) return null;

  const deckSlideIds = new Set(deckSlides.map((slide) => slide.slideId));
  const slidesByOrder = new Map(
    deckSlides.map((slide) => [slide.order, slide]),
  );
  const usedSlideIds = new Set<string>();
  let recovered = false;

  const slides: TemplateBlueprintSlide[] = [];
  for (const slide of blueprint.slides) {
    const slideId = slide.slideId;
    if (slideId) {
      if (!deckSlideIds.has(slideId) || usedSlideIds.has(slideId)) {
        return null;
      }
      usedSlideIds.add(slideId);
      slides.push(slide);
      continue;
    }

    const deckSlide = slidesByOrder.get(slide.slideIndex);
    if (!deckSlide || usedSlideIds.has(deckSlide.slideId)) {
      return null;
    }
    usedSlideIds.add(deckSlide.slideId);
    recovered = true;
    slides.push({ ...slide, slideId: deckSlide.slideId });
  }

  if (usedSlideIds.size !== blueprint.slides.length) return null;
  return {
    blueprint: templateBlueprintSchema.parse({ ...blueprint, slides }),
    recovered,
  };
}
export type QualityReport = z.infer<typeof qualityReportSchema>;
export type QualityReportSlideStatus = z.infer<
  typeof qualityReportSlideStatusSchema
>;
export type QualityReportSlide = z.infer<typeof qualityReportSlideSchema>;
export type PptxImportJobResult = z.infer<typeof pptxImportJobResultSchema>;
