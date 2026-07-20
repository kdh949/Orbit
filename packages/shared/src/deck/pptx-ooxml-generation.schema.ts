import { z } from "zod";

import {
  deckElementIdSchema,
  deckIdSchema,
  deckSlideIdSchema,
} from "./id.schema";
import { deckElementSchema, deckElementTypeSchema } from "./slide-object.schema";
import { themeSchema } from "./theme.schema";
import {
  qualityReportSchema,
  templateBlueprintIdSchema,
} from "./template-blueprint.schema";

export const pptxOoxmlGenerationRequestSchema = z
  .object({
    fileId: z.string().min(1),
  })
  .strict();

export const PPTX_OOXML_SYNC_CAPABILITY_VERSION = 2 as const;

export const authoredOoxmlRasterElementTypeSchema = z.enum([
  "ellipse",
  "line",
  "arrow",
  "polygon",
  "star",
  "ring",
  "svg",
  "customShape",
  "chart",
]);

export const authoredElementRasterFallbackReasonSchema = z.literal(
  "AUTHORED_ELEMENT_TYPE_RASTERIZED",
);

export const authoredElementFallbacksSchema = z
  .object({
    theme: themeSchema,
    elements: z
      .array(
        z
          .object({
            slideId: deckSlideIdSchema,
            element: deckElementSchema.refine(
              (element) =>
                authoredOoxmlRasterElementTypeSchema.safeParse(element.type)
                  .success,
              "element type is not eligible for authored raster fallback",
            ),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export const rasterizedElementSchema = z
  .object({
    slideId: deckSlideIdSchema,
    elementId: deckElementIdSchema,
    elementType: deckElementTypeSchema,
    reasonCode: authoredElementRasterFallbackReasonSchema,
  })
  .strict();

export const pptxOoxmlGenerationJobResultSchema = z.object({
  deckId: deckIdSchema,
  templateId: templateBlueprintIdSchema,
  sourceFileId: z.string().min(1),
  currentPackageFileId: z.string().min(1),
  qualityReport: qualityReportSchema,
  warnings: z.array(z.string()).default([]),
});

export const pptxOoxmlSyncJobResultSchema = z.object({
  deckId: deckIdSchema,
  templateId: templateBlueprintIdSchema,
  currentPackageFileId: z.string().min(1),
  renderAssetFileIds: z.array(z.string().min(1)).default([]),
  syncedDeckVersion: z.number().int().positive(),
  syncCapabilityVersion: z.number().int().positive().default(1),
  rasterizedElements: z.array(rasterizedElementSchema).max(500).default([]),
  warnings: z.array(z.string()).default([]),
});

export type PptxOoxmlGenerationRequest = z.infer<
  typeof pptxOoxmlGenerationRequestSchema
>;
export type PptxOoxmlGenerationJobResult = z.infer<
  typeof pptxOoxmlGenerationJobResultSchema
>;
export type PptxOoxmlSyncJobResult = z.infer<
  typeof pptxOoxmlSyncJobResultSchema
>;
export type AuthoredElementFallbacks = z.infer<
  typeof authoredElementFallbacksSchema
>;
export type RasterizedElement = z.infer<typeof rasterizedElementSchema>;
