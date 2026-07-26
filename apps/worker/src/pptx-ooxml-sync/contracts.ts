import {
  animationSchema,
  deckPatchOperationTypeSchema,
  ooxmlMotionCapabilitiesSchema,
  pptxOoxmlAssetTransportVersionSchema,
  pptxOoxmlStoredAssetSchema,
  slideTransitionSchema,
  templateElementSourceSchema,
  type DeckPatchOperation,
} from "@orbit/shared/deck";
import { z } from "zod";

export const pptxOoxmlSyncPayloadSchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  deckId: z.string().min(1),
  changeId: z.string().min(1),
  targetDeckVersion: z.number().int().positive(),
  syncCapabilityVersion: z.number().int().positive().default(1),
});

const ooxmlSyncOperationTypeSchema = z.enum([
  "add_slide",
  "delete_slide",
  "add_element",
  "update_element_frame",
  "update_element_props",
  "delete_element",
  "reorder_slides",
  "update_speaker_notes",
]);

export const ooxmlUnsupportedReasonCodeSchema = z.enum([
  "ADD_SLIDE_FAILED",
  "ADD_SLIDE_LAYOUT_UNSAFE",
  "ADD_ELEMENT_FAILED",
  "ADD_ELEMENT_TYPE_UNSUPPORTED",
  "AUTHORED_RASTER_FALLBACK_FAILED",
  "CROP_CAPABILITY_UNSAFE",
  "DELETE_SLIDE_FAILED",
  "DELETE_SLIDE_LOCATOR_UNSAFE",
  "DELETE_SLIDE_RELATIONSHIP_UNSAFE",
  "RICH_TEXT_CAPABILITY_UNSAFE",
  "ELEMENT_TYPE_MISMATCH",
  "FRAME_FIELDS_UNSUPPORTED",
  "GROUPED_FRAME_UNSUPPORTED",
  "MOTION_REFERENCE_COVERAGE_UNSAFE",
  "NOTES_BODY_LOCATOR_UNSAFE",
  "NOTES_BODY_NOT_WRITABLE",
  "NOTES_BODY_UPDATE_FAILED",
  "NOTES_MASTER_CAPABILITY_UNSAFE",
  "NOTES_PART_MISSING",
  "OPERATION_TYPE_UNSUPPORTED",
  "PROPS_FIELDS_UNSUPPORTED",
  "PROPS_UPDATE_FAILED",
  "SHAPE_MISSING",
  "SHARED_SHAPE_COHORT_UNSAFE",
  "SLIDE_PART_MISSING",
  "SLIDE_REORDER_LOCATOR_UNSAFE",
  "SLIDE_REORDER_PERMUTATION_INVALID",
  "SLIDE_REORDER_RELATIONSHIP_UNSAFE",
  "LAST_SLIDE_DELETE_FORBIDDEN",
  "SOURCE_MISSING",
  "SOURCE_NOT_WRITABLE",
  "SOURCE_PROVENANCE_UNSAFE",
  "SYNC_RESPONSE_INCOMPLETE",
  "TABLE_CELL_CAPABILITY_UNSAFE",
  "TABLE_STRUCTURE_UNSUPPORTED",
]);

export const ooxmlAppliedOperationSchema = z
  .object({
    operationType: ooxmlSyncOperationTypeSchema,
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1).optional(),
  })
  .strict();

export const ooxmlUnsupportedOperationSchema = z
  .object({
    operationType: deckPatchOperationTypeSchema,
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1).optional(),
    reasonCode: ooxmlUnsupportedReasonCodeSchema,
  })
  .strict();

const ooxmlNotesPageUpdateSchema = z
  .object({
    slideId: z.string().min(1).max(128),
    notesPage: z
      .object({
        status: z.literal("preserved"),
        sourceNotesPart: z
          .string()
          .regex(/^ppt\/notesSlides\/notesSlide[1-9][0-9]*\.xml$/),
        sourceNotesMasterPart: z
          .string()
          .regex(/^ppt\/notesMasters\/notesMaster[1-9][0-9]*\.xml$/),
        bodyShapeId: z.string().min(1).max(64),
        bodyWritable: z.literal(true),
        notesWidthEmu: z.number().int().positive().max(10_000_000_000),
        notesHeightEmu: z.number().int().positive().max(10_000_000_000),
        hasNonBodyContent: z.boolean(),
      })
      .strict(),
  })
  .strict();

const ooxmlNotesPageUpdatesSchema = z
  .array(ooxmlNotesPageUpdateSchema)
  .max(500)
  .refine(
    (updates) =>
      new Set(updates.map((update) => update.slideId)).size === updates.length,
    "notes page updates must have unique slide ids",
  );

const slideMotionTouchedSchema = z
  .object({
    transition: z.boolean(),
    animations: z.boolean(),
  })
  .strict();

export const slideMotionSyncInputSchema = z
  .object({
    slideId: z.string().min(1),
    sourceSlidePart: z
      .string()
      .regex(/^ppt\/slides\/slide[^/]+\.xml$/)
      .optional(),
    transition: slideTransitionSchema.nullable(),
    animations: z.array(animationSchema),
    capabilities: ooxmlMotionCapabilitiesSchema,
    touched: slideMotionTouchedSchema,
  })
  .strict();

const appliedSlideMotionSchema = z
  .object({
    slideId: z.string().min(1),
    transition: z.boolean(),
    animations: z.boolean(),
  })
  .strict();

export const unsupportedSlideMotionSchema = z
  .object({
    slideId: z.string().min(1),
    scope: z.enum(["transition", "animations"]),
    reasonCode: z.enum([
      "SLIDE_MOTION_SOURCE_MISSING",
      "SLIDE_MOTION_PAYLOAD_INVALID",
      "SLIDE_TRANSITION_CAPABILITY_UNSAFE",
      "SLIDE_TRANSITION_UNSUPPORTED",
      "SLIDE_ANIMATION_CAPABILITY_UNSAFE",
      "SLIDE_ANIMATION_UNSUPPORTED",
      "SLIDE_ANIMATION_TARGET_UNRESOLVED",
      "SLIDE_MOTION_STRUCTURE_UNSUPPORTED",
      "SLIDE_MOTION_SYNC_RESPONSE_INCOMPLETE",
    ]),
  })
  .strict();

export const pptxOoxmlSyncWorkerResponseSchema = z.object({
  assetTransport: pptxOoxmlAssetTransportVersionSchema,
  assets: z.array(pptxOoxmlStoredAssetSchema).default([]),
  elementSources: z.array(templateElementSourceSchema).max(500).default([]),
  appliedOperations: z.array(ooxmlAppliedOperationSchema).max(500).default([]),
  unsupportedOperations: z
    .array(ooxmlUnsupportedOperationSchema)
    .max(500)
    .default([]),
  notesPages: ooxmlNotesPageUpdatesSchema.default([]),
  appliedSlideMotion: z.array(appliedSlideMotionSchema).max(500).default([]),
  unsupportedSlideMotion: z
    .array(unsupportedSlideMotionSchema)
    .max(500)
    .default([]),
  warnings: z.array(z.string()).default([]),
});

export type PptxOoxmlSyncWorkerResponse = z.infer<
  typeof pptxOoxmlSyncWorkerResponseSchema
>;
export type OoxmlSyncOperation = Extract<
  DeckPatchOperation,
  {
    type:
      | "add_element"
      | "add_slide"
      | "delete_slide"
      | "update_element_frame"
      | "update_element_props"
      | "delete_element"
      | "reorder_slides"
      | "update_speaker_notes";
  }
>;
export type OoxmlMotionOperation = Extract<
  DeckPatchOperation,
  {
    type:
      | "update_slide_transition"
      | "add_animation"
      | "update_animation"
      | "delete_animation";
  }
>;
export type SlideMotionSyncInput = z.infer<typeof slideMotionSyncInputSchema>;
