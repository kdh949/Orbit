import { z } from "zod";

import { isoDateTimeSchema } from "../common/time.schema";
import { deckSnapshotIdSchema } from "../deck/deck-api.schema";
import type { Slide } from "../deck/deck.schema";
import { jobSchema } from "../jobs/job.schema";

const identifierSchema = z.string().trim().min(1).max(128);

const slideQuestionSlideSourceRefSchema = z.object({
  kind: z.literal("slide"),
  slideId: identifierSchema,
  objectId: identifierSchema.nullable(),
  deckVersion: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const slideQuestionReferenceSourceRefSchema = z.object({
  kind: z.literal("reference"),
  fileId: identifierSchema,
  chunkId: identifierSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const slideQuestionGuideWebSourceRefSchema = z.object({
  kind: z.literal("web"),
  sourceId: identifierSchema,
  url: z.string().url().max(2_048),
  title: z.string().trim().min(1).max(500),
  authority: z.literal("official"),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  retrievedAt: isoDateTimeSchema,
}).strict();

const slideQuestionGuideV1SourceRefSchema = z.discriminatedUnion("kind", [
  slideQuestionSlideSourceRefSchema,
  slideQuestionReferenceSourceRefSchema,
]);

export const slideQuestionSourceRefSchema = z.discriminatedUnion("kind", [
  slideQuestionSlideSourceRefSchema,
  slideQuestionReferenceSourceRefSchema,
  slideQuestionGuideWebSourceRefSchema,
]);

export const slideQuestionGuideSourceSnapshotSchema = z.object({
  deckSnapshotId: deckSnapshotIdSchema.optional(),
  contentHashVersion: z.literal("slide-text-v1").optional(),
  slideId: identifierSchema,
  deckVersion: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().trim().max(500),
  content: z.string().trim().max(8_000),
}).strict();

export function slideQuestionGuideTextHashInput(slide: Slide) {
  const textSegments: string[] = [];
  const visit = (value: unknown, key = "") => {
    if (typeof value === "string" && ["alt", "text", "title"].includes(key)) {
      if (value.trim()) textSegments.push(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .forEach(([childKey, child]) => visit(child, childKey));
    }
  };
  visit(slide);
  return {
    speakerNotes: slide.speakerNotes.trim(),
    textSegments: Array.from(new Set(textSegments)),
  };
}

export const slideQuestionGuideDeckContextSlideSchema = z.object({
  slideId: identifierSchema,
  order: z.number().int().positive(),
  deckVersion: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().trim().max(500),
  content: z.string().trim().max(4_000),
  speakerNotes: z.string().trim().max(6_000),
}).strict();

export const slideQuestionTypeSchema = z.enum([
  "evidence",
  "objection",
  "decision",
]);

export const slideQuestionSupportStateSchema = z.enum([
  "grounded",
  "insufficient",
]);

function createSlideQuestionGuideItemCoreSchema(
  sourceRefSchema: typeof slideQuestionSourceRefSchema | typeof slideQuestionGuideV1SourceRefSchema,
) {
  return z.object({
    questionId: identifierSchema,
    questionType: slideQuestionTypeSchema,
    questionText: z.string().trim().min(1).max(500),
    supportState: slideQuestionSupportStateSchema,
    keyConcepts: z.array(z.object({
      label: z.string().trim().min(1).max(120),
      sourceRefs: z.array(sourceRefSchema).min(1).max(8),
    }).strict()).max(8),
    suggestedAnswer: z.object({
      summary: z.string().trim().min(1).max(1_000),
      structure: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
      caveats: z.array(z.string().trim().min(1).max(300)).max(6),
    }).strict().nullable(),
    remediation: z.object({
      message: z.string().trim().min(1).max(500),
      actions: z.array(z.string().trim().min(1).max(200)).min(1).max(4),
    }).strict().nullable(),
    sourceRefs: z.array(sourceRefSchema).max(12),
  }).strict();
}

const slideQuestionGuideItemV1CoreSchema = createSlideQuestionGuideItemCoreSchema(
  slideQuestionGuideV1SourceRefSchema,
);
export const slideQuestionGuideItemCoreSchema = createSlideQuestionGuideItemCoreSchema(
  slideQuestionSourceRefSchema,
);

function applyItemSupportBoundary<T extends z.infer<typeof slideQuestionGuideItemCoreSchema>>(
  item: T,
  context: z.RefinementCtx,
) {
  if (item.supportState === "grounded" && item.suggestedAnswer === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["suggestedAnswer"],
      message: "Grounded questions require a suggested answer",
    });
  }
  if (item.supportState === "insufficient" && item.remediation === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["remediation"],
      message: "Insufficient questions require remediation guidance",
    });
  }
}

const slideQuestionGuideItemV1Schema = slideQuestionGuideItemV1CoreSchema.superRefine(
  applyItemSupportBoundary,
);
export const slideQuestionGuideItemSchema = slideQuestionGuideItemCoreSchema.superRefine(
  applyItemSupportBoundary,
);

export const slideQuestionGuideResearchIssueCodeSchema = z.enum([
  "query-unavailable",
  "provider-call-failed",
  "no-citations",
  "vetting-failed",
  "official-missing",
]);

export const slideQuestionGuideResearchSchema = z.object({
  status: z.enum(["succeeded", "unavailable"]),
  attempts: z.number().int().min(0).max(2),
  officialSourceCount: z.number().int().min(0).max(5),
  issueCodes: z.array(slideQuestionGuideResearchIssueCodeSchema).max(5),
  researchedAt: isoDateTimeSchema.nullable(),
}).strict().superRefine((research, context) => {
  if (research.status === "succeeded" && research.officialSourceCount < 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["officialSourceCount"],
      message: "Successful research requires an official source",
    });
  }
  if (research.status === "unavailable" && research.officialSourceCount !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["officialSourceCount"],
      message: "Unavailable research cannot include official sources",
    });
  }
});

export const createSlideQuestionGuideRequestSchema = z.object({
  clientRequestId: identifierSchema,
  deckId: identifierSchema,
  slideId: identifierSchema,
  expectedDeckVersion: z.number().int().positive(),
  questionCount: z.literal(3),
}).strict();

export const autoCreateSlideQuestionGuidesRequestSchema = z.object({
  clientRequestId: identifierSchema,
  deckId: identifierSchema,
  expectedDeckVersion: z.number().int().positive(),
  questionCount: z.literal(3),
}).strict();

export const slideQuestionGuideJobPayloadSchema = z.object({
  jobId: identifierSchema,
  projectId: identifierSchema,
  guideId: identifierSchema,
}).strict();

export const slideQuestionGuideJobResultSchema = z.object({
  guideId: identifierSchema,
  projectId: identifierSchema,
  deckId: identifierSchema,
  deckVersion: z.number().int().positive(),
  slideId: identifierSchema,
  itemCount: z.number().int().min(0).max(3),
  generatedAt: isoDateTimeSchema,
}).strict();

const slideQuestionGuideIdentityShape = {
  guideId: identifierSchema,
  projectId: identifierSchema,
  deckId: identifierSchema,
  deckVersion: z.number().int().positive(),
  slideId: identifierSchema,
  slideContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: isoDateTimeSchema,
  promptVersion: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
};

const slideQuestionGuideV1Schema = z.object({
  schemaVersion: z.literal(1),
  ...slideQuestionGuideIdentityShape,
  items: z.array(slideQuestionGuideItemV1Schema).length(3),
}).strict();

const slideQuestionGuideV2Schema = z.object({
  schemaVersion: z.literal(2),
  ...slideQuestionGuideIdentityShape,
  research: slideQuestionGuideResearchSchema,
  items: z.array(slideQuestionGuideItemSchema).length(3),
}).strict();

export const slideQuestionGuideSchema = z.discriminatedUnion("schemaVersion", [
  slideQuestionGuideV1Schema,
  slideQuestionGuideV2Schema,
]);

export const slideQuestionGuideJobResponseSchema = z.object({
  job: jobSchema,
  guideId: identifierSchema,
}).strict();

export const autoCreateSlideQuestionGuidesResponseSchema = z.object({
  deckId: identifierSchema,
  deckVersion: z.number().int().positive(),
  slides: z.array(z.discriminatedUnion("status", [
    z.object({
      status: z.literal("accepted"),
      slideId: identifierSchema,
      guideId: identifierSchema,
      job: jobSchema,
    }).strict(),
    z.object({
      status: z.literal("failed"),
      slideId: identifierSchema,
      errorCode: z.string().trim().min(1).max(100),
    }).strict(),
  ])).max(500),
}).strict();

export const slideQuestionGuideListResponseSchema = z.object({
  guides: z.array(slideQuestionGuideSchema).max(50),
}).strict();

export type SlideQuestionGuideItem = z.infer<typeof slideQuestionGuideItemSchema>;
export type SlideQuestionGuide = z.infer<typeof slideQuestionGuideSchema>;
export type CreateSlideQuestionGuideRequest = z.infer<typeof createSlideQuestionGuideRequestSchema>;
export type AutoCreateSlideQuestionGuidesRequest = z.infer<typeof autoCreateSlideQuestionGuidesRequestSchema>;
export type AutoCreateSlideQuestionGuidesResponse = z.infer<typeof autoCreateSlideQuestionGuidesResponseSchema>;
export type SlideQuestionGuideJobPayload = z.infer<typeof slideQuestionGuideJobPayloadSchema>;
export type SlideQuestionGuideJobResult = z.infer<typeof slideQuestionGuideJobResultSchema>;
