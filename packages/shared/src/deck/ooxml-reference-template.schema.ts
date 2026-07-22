import { z } from "zod";

import { isoDateTimeSchema } from "../common/time.schema";
import {
  aiDeckAudienceSchema,
  aiDeckPurposeSchema,
  aiDeckToneSchema
} from "./deck.schema";
import { deckIdSchema, deckSlideIdSchema } from "./id.schema";
import {
  generateDeckReferencePolicySchema,
  generateDeckSlideCountRangeSchema
} from "./generate-deck.schema";
import {
  ooxmlReferenceSha256Schema,
  ooxmlReferenceTemplateIdSchema,
  ooxmlTemplateSlotMutationSchema,
  ooxmlTemplateSnapshotSchema
} from "./ooxml-reference-template-common.schema";
import { templateBlueprintIdSchema } from "./template-blueprint.schema";

export {
  ooxmlReferenceDeckSnapshotSchema,
  ooxmlReferenceSha256Schema,
  ooxmlReferenceTemplateIdSchema,
  ooxmlTemplateSlotMutationSchema,
  ooxmlTemplateSnapshotSchema
} from "./ooxml-reference-template-common.schema";

export const ooxmlSourceSlideRoleSchema = z.enum([
  "cover",
  "agenda",
  "section",
  "statement",
  "summary",
  "metric",
  "comparison",
  "chart",
  "table",
  "process",
  "timeline",
  "team-role",
  "evidence",
  "closing"
]);

export const ooxmlTemplateSlotRoleSchema = z.enum([
  "title",
  "subtitle",
  "body",
  "caption",
  "label",
  "metric",
  "image",
  "table",
  "chart"
]);

export const ooxmlTemplateSlotLocatorSchema = z
  .object({
    slidePart: z.string().regex(/^ppt\/slides\/slide[^/]+\.xml$/),
    shapeId: z.string().trim().min(1).max(128),
    placeholderType: z.string().trim().min(1).max(128).nullable(),
    relationshipId: z.string().trim().min(1).max(128).nullable()
  })
  .strict();

const ooxmlTemplateSlotBaseSchema = z
  .object({
    slotId: z.string().trim().min(1).max(160),
    semanticRole: ooxmlTemplateSlotRoleSchema,
    required: z.boolean(),
    locator: ooxmlTemplateSlotLocatorSchema,
    mutationPolicy: z.array(ooxmlTemplateSlotMutationSchema).min(1).max(4),
    replacementPolicy: z
      .object({
        overflow: z.literal("fail")
      })
      .strict()
  })
  .strict();

const ooxmlTextTemplateSlotSchema = ooxmlTemplateSlotBaseSchema.extend({
  contentType: z.literal("text"),
  capacity: z
    .object({
      maxChars: z.number().int().positive().max(20_000),
      maxLines: z.number().int().positive().max(500),
      maxParagraphs: z.number().int().positive().max(500).optional(),
      maxBulletDepth: z.number().int().min(0).max(8).optional()
    })
    .strict()
});

const ooxmlImageTemplateSlotSchema = ooxmlTemplateSlotBaseSchema.extend({
  contentType: z.literal("image"),
  capacity: z
    .object({
      minAspectRatio: z.number().finite().positive(),
      maxAspectRatio: z.number().finite().positive(),
      cropPolicy: z.enum(["preserve-frame", "cover", "contain"]),
      alphaRequired: z.boolean().default(false),
      maskRequired: z.boolean().default(false)
    })
    .strict()
    .superRefine((capacity, ctx) => {
      if (capacity.minAspectRatio > capacity.maxAspectRatio) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["minAspectRatio"],
          message: "minimum aspect ratio must not exceed maximum"
        });
      }
    })
});

const ooxmlTableTemplateSlotSchema = ooxmlTemplateSlotBaseSchema.extend({
  contentType: z.literal("table"),
  capacity: z
    .object({
      rowCount: z.number().int().positive().max(200),
      columnCount: z.number().int().positive().max(100),
      mergedCellPolicy: z.literal("preserve"),
      editableCells: z
        .array(
          z
            .object({
              rowIndex: z.number().int().nonnegative().max(199),
              columnIndex: z.number().int().nonnegative().max(99),
              fingerprint: ooxmlReferenceSha256Schema
            })
            .strict()
        )
        .min(1)
        .max(10_000)
    })
    .strict()
});

const ooxmlChartTemplateSlotSchema = ooxmlTemplateSlotBaseSchema.extend({
  contentType: z.literal("chart"),
  capacity: z
    .object({
      chartType: z.enum(["bar", "column", "line", "pie", "doughnut"]),
      maxCategories: z.number().int().positive().max(500),
      maxSeries: z.number().int().positive().max(100),
      workbookUpdatePolicy: z.literal("atomic"),
      workbookFingerprint: ooxmlReferenceSha256Schema
    })
    .strict()
});

export const ooxmlTemplateSlotSchema = z
  .discriminatedUnion("contentType", [
    ooxmlTextTemplateSlotSchema,
    ooxmlImageTemplateSlotSchema,
    ooxmlTableTemplateSlotSchema,
    ooxmlChartTemplateSlotSchema
  ])
  .superRefine((slot, ctx) => {
    const expectedMutation = {
      text: "text-content",
      image: "image-source",
      table: "table-cell-text",
      chart: "chart-data"
    }[slot.contentType];
    if (
      slot.mutationPolicy.length !== 1 ||
      slot.mutationPolicy[0] !== expectedMutation
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mutationPolicy"],
        message: "slot mutation policy must match its content type"
      });
    }
    if (
      slot.contentType === "image" &&
      slot.locator.relationshipId === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locator", "relationshipId"],
        message: "image slots require a relationship locator"
      });
    }
    if (
      slot.contentType === "chart" &&
      slot.locator.relationshipId === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locator", "relationshipId"],
        message: "chart slots require a relationship locator"
      });
    }
  });

export const ooxmlSourceSlideSchema = z
  .object({
    sourceSlideId: z.string().trim().min(1).max(128),
    sourceSlidePart: z.string().regex(/^ppt\/slides\/slide[^/]+\.xml$/),
    sourceOrder: z.number().int().positive().max(500),
    semanticRole: ooxmlSourceSlideRoleSchema,
    relationships: z
      .object({
        layoutPart: z
          .string()
          .regex(/^ppt\/slideLayouts\/slideLayout[^/]+\.xml$/),
        masterPart: z
          .string()
          .regex(/^ppt\/slideMasters\/slideMaster[^/]+\.xml$/),
        themePart: z.string().regex(/^ppt\/theme\/theme[^/]+\.xml$/)
      })
      .strict(),
    capacity: z
      .object({
        textSlotCount: z.number().int().nonnegative().max(500),
        imageSlotCount: z.number().int().nonnegative().max(500),
        tableSlotCount: z.number().int().nonnegative().max(500),
        chartSlotCount: z.number().int().nonnegative().max(500)
      })
      .strict(),
    previewId: z.string().trim().min(1).max(128),
    lockedInventorySha256: ooxmlReferenceSha256Schema,
    slots: z.array(ooxmlTemplateSlotSchema).max(500)
  })
  .strict()
  .superRefine((slide, ctx) => {
    slide.slots.forEach((slot, index) => {
      if (slot.locator.slidePart !== slide.sourceSlidePart) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slots", index, "locator", "slidePart"],
          message: "slot locator must reference its source slide part"
        });
      }
    });
  });

export const ooxmlReferenceTemplateManifestSchema = z
  .object({
    templateId: ooxmlReferenceTemplateIdSchema,
    version: z.number().int().positive(),
    status: z.enum(["active", "disabled"]),
    sourceFormat: z.literal("pptx"),
    sourceSha256: ooxmlReferenceSha256Schema,
    slideCount: z.number().int().positive().max(500),
    canvas: z
      .object({
        aspectRatio: z.enum(["16:9", "4:3"]),
        widthEmu: z.number().int().positive(),
        heightEmu: z.number().int().positive()
      })
      .strict(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    preview: z
      .object({
        coverPreviewId: z.string().trim().min(1).max(128),
        coverPreviewSha256: ooxmlReferenceSha256Schema,
        bodyPreviewId: z.string().trim().min(1).max(128),
        bodyPreviewSha256: ooxmlReferenceSha256Schema
      })
      .strict(),
    sourceSlides: z.array(ooxmlSourceSlideSchema).min(1).max(500),
    provenance: z
      .object({
        authorizationStatus: z.enum(["approved", "pending", "rejected"]),
        inventoryVersion: z.number().int().positive()
      })
      .strict()
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (manifest.slideCount !== manifest.sourceSlides.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slideCount"],
        message: "slide count must match source slide annotations"
      });
    }
    const slideIds = new Set<string>();
    const slideParts = new Set<string>();
    const slotIds = new Set<string>();
    const locators = new Set<string>();
    manifest.sourceSlides.forEach((slide, slideIndex) => {
      if (slideIds.has(slide.sourceSlideId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceSlides", slideIndex, "sourceSlideId"],
          message: "source slide IDs must be unique"
        });
      }
      slideIds.add(slide.sourceSlideId);
      if (slideParts.has(slide.sourceSlidePart)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceSlides", slideIndex, "sourceSlidePart"],
          message: "source slide parts must be unique"
        });
      }
      slideParts.add(slide.sourceSlidePart);
      slide.slots.forEach((slot, slotIndex) => {
        if (slotIds.has(slot.slotId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sourceSlides", slideIndex, "slots", slotIndex, "slotId"],
            message: "slot IDs must be unique"
          });
        }
        slotIds.add(slot.slotId);
        const locator = [
          slot.locator.slidePart,
          slot.locator.shapeId,
          slot.locator.relationshipId ?? ""
        ].join("|");
        if (locators.has(locator)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sourceSlides", slideIndex, "slots", slotIndex, "locator"],
            message: "slot locators must be unique"
          });
        }
        locators.add(locator);
      });
    });
    if (manifest.status === "active") {
      if (manifest.provenance.authorizationStatus !== "approved") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["provenance", "authorizationStatus"],
          message: "active templates require approved authorization"
        });
      }
      const roles = new Set(
        manifest.sourceSlides.map((slide) => slide.semanticRole)
      );
      if (!roles.has("cover") || !roles.has("closing")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceSlides"],
          message: "active templates require cover and closing source roles"
        });
      }
      if (slotIds.size === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceSlides"],
          message: "active templates require at least one editable slot"
        });
      }
    }
  });

export const ooxmlTemplateSelectionSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("user"),
      templateId: ooxmlReferenceTemplateIdSchema,
      version: z.number().int().positive()
    })
    .strict(),
  z.object({ mode: z.literal("auto") }).strict()
]);

export const ooxmlReferenceTemplateGenerationRequestSchema = z
  .object({
    topic: z.string().trim().min(1).max(500),
    prompt: z.string().trim().max(10_000).optional(),
    targetDurationMinutes: z.number().int().min(1).max(120).default(10),
    slideCountRange: generateDeckSlideCountRangeSchema,
    metadata: z
      .object({
        audience: aiDeckAudienceSchema.default("general"),
        purpose: aiDeckPurposeSchema.default("inform"),
        tone: aiDeckToneSchema.default("professional")
      })
      .strict()
      .default({}),
    referencePolicy: generateDeckReferencePolicySchema.default("topic-only"),
    referenceFileIds: z
      .array(z.string().trim().min(1))
      .max(10)
      .default([]),
    templateSelection: ooxmlTemplateSelectionSchema
  })
  .strict();

export const ooxmlReferenceTemplateGenerationJobPayloadSchema = z
  .object({
    jobId: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
    request: ooxmlReferenceTemplateGenerationRequestSchema,
  })
  .strict();

const ooxmlFidelityStatusSchema = z.enum([
  "not-run",
  "passed",
  "failed"
]);

export const ooxmlTemplateFidelityReportSchema = z
  .object({
    status: ooxmlFidelityStatusSchema,
    structuralGate: z
      .object({
        passed: z.boolean(),
        issueCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).max(500)
      })
      .strict(),
    identityControl: z
      .object({
        status: ooxmlFidelityStatusSchema,
        evaluatedSlideCount: z.number().int().nonnegative().max(500),
        packageWarningCount: z.number().int().nonnegative().max(10_000),
        lockedGeometryDriftCount: z.number().int().nonnegative().max(10_000)
      })
      .strict(),
    generatedComparison: z
      .object({
        status: ooxmlFidelityStatusSchema,
        evaluatedSlideCount: z.number().int().nonnegative().max(500),
        lockedRegionDriftCount: z.number().int().nonnegative().max(10_000),
        slotOverflowCount: z.number().int().nonnegative().max(10_000)
      })
      .strict(),
    warningCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).max(500)
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.status === "passed" && !report.structuralGate.passed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "a passed fidelity report requires the structural gate"
      });
    }
  });

export const ooxmlReferenceTemplateGenerationJobResultSchema = z
  .object({
    deckId: deckIdSchema,
    templateId: templateBlueprintIdSchema,
    currentPackageFileId: z.string().trim().min(1),
    renderAssetFileIds: z.array(z.string().trim().min(1)).max(500),
    templateSnapshot: ooxmlTemplateSnapshotSchema,
    fidelityReport: ooxmlTemplateFidelityReportSchema,
    warningCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).max(500)
  })
  .strict();

export const ooxmlReferenceTemplateOptionSchema = z
  .object({
    templateId: ooxmlReferenceTemplateIdSchema,
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    preview: z
      .object({
        coverAssetId: z.string().trim().min(1).max(128),
        bodyAssetId: z.string().trim().min(1).max(128)
      })
      .strict(),
    editableRanges: z
      .array(
        z
          .object({
            contentType: z.enum(["text", "image", "table", "chart"]),
            mutationPolicy: ooxmlTemplateSlotMutationSchema,
            slotCount: z.number().int().positive().max(500)
          })
          .strict()
      )
      .min(1)
      .max(4)
  })
  .strict();

export const ooxmlReferenceTemplateOptionsResponseSchema = z
  .object({
    options: z.array(ooxmlReferenceTemplateOptionSchema).max(100)
  })
  .strict()
  .superRefine((response, ctx) => {
    const identities = response.options.map(
      (option) => `${option.templateId}@${option.version}`
    );
    if (new Set(identities).size !== identities.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "template option identities must be unique"
      });
    }
  });

export const ooxmlReferenceTemplatePreviewResponseSchema = z
  .object({
    jobId: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
    status: z.enum([
      "planning",
      "rendering",
      "materializing",
      "succeeded",
      "failed"
    ]),
    progress: z.number().int().min(0).max(100),
    editable: z.literal(false),
    outline: z
      .array(
        z
          .object({
            order: z.number().int().positive(),
            title: z.string().trim().min(1).max(500)
          })
          .strict()
      )
      .max(500),
    completedSlides: z
      .array(
        z
          .object({
            slideId: deckSlideIdSchema,
            order: z.number().int().positive(),
            renderAssetFileId: z.string().trim().min(1)
          })
          .strict()
      )
      .max(500),
    pendingSlideOrders: z.array(z.number().int().positive()).max(500),
    deckId: deckIdSchema.nullable(),
    updatedAt: isoDateTimeSchema,
    error: z
      .object({
        code: z.string().regex(/^OOXML_REFERENCE_[A-Z0-9_]+$/),
        retryable: z.boolean()
      })
      .strict()
      .nullable()
  })
  .strict()
  .superRefine((preview, ctx) => {
    preview.completedSlides.forEach((slide, index) => {
      if (slide.order !== index + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["completedSlides", index, "order"],
          message: "completed slides must form a continuous prefix"
        });
      }
    });
    if (preview.status === "succeeded" && preview.deckId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deckId"],
        message: "successful previews require a canonical deck ID"
      });
    }
    if (preview.status !== "failed" && preview.error !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["error"],
        message: "only failed previews may expose a bounded error"
      });
    }
  });

export type OoxmlSourceSlide = z.infer<typeof ooxmlSourceSlideSchema>;
export type OoxmlTemplateSlot = z.infer<typeof ooxmlTemplateSlotSchema>;
export type OoxmlTemplateSelection = z.infer<
  typeof ooxmlTemplateSelectionSchema
>;
export type OoxmlReferenceTemplateManifest = z.infer<
  typeof ooxmlReferenceTemplateManifestSchema
>;
export type OoxmlTemplateFidelityReport = z.infer<
  typeof ooxmlTemplateFidelityReportSchema
>;
export type OoxmlReferenceTemplateGenerationRequest = z.infer<
  typeof ooxmlReferenceTemplateGenerationRequestSchema
>;
export type OoxmlReferenceTemplateGenerationJobPayload = z.infer<
  typeof ooxmlReferenceTemplateGenerationJobPayloadSchema
>;
export type OoxmlReferenceTemplateGenerationJobResult = z.infer<
  typeof ooxmlReferenceTemplateGenerationJobResultSchema
>;
export type OoxmlReferenceTemplateOption = z.infer<
  typeof ooxmlReferenceTemplateOptionSchema
>;
export type OoxmlReferenceTemplateOptionsResponse = z.infer<
  typeof ooxmlReferenceTemplateOptionsResponseSchema
>;
export type OoxmlReferenceTemplatePreviewResponse = z.infer<
  typeof ooxmlReferenceTemplatePreviewResponseSchema
>;
