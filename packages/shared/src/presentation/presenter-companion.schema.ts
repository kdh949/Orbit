import { z } from "zod";

import {
  activityDefinitionSchema,
  activityResultDefinitionSchema,
} from "../activity/activity-definition.schema";
import { activityIdSchema } from "../activity/activity-id.schema";
import { activityPublicResultSchema } from "../activity/activity-results.schema";
import { activityRuntimeStatusSchema } from "../activity/activity-runtime.schema";
import { animationSchema } from "../deck/animation.schema";
import {
  deckCanvasSchema,
  slideImportRenderModeSchema,
  slideKindSchema,
  slideOrderSchema,
  slideStyleSchema,
  slideTransitionSchema,
} from "../deck/deck.schema";
import { deckElementSchema } from "../deck/slide-object.schema";
import {
  deckAnimationIdSchema,
  deckIdSchema,
  deckSlideIdSchema,
} from "../deck/id.schema";
import { themeSchema } from "../deck/theme.schema";
import { isoDateTimeSchema } from "../common/time.schema";
import { presentationSessionPurposeSchema } from "./presentation.schema";

export const companionAccessScopeSchema = z.enum([
  "view-audience-output",
  "write-annotation",
]);

export const companionAccessScopesSchema = z
  .array(companionAccessScopeSchema)
  .min(1)
  .max(2);

const companionSlideBaseFields = {
  slideId: deckSlideIdSchema,
  kind: slideKindSchema,
  order: slideOrderSchema,
  thumbnailUrl: z.string().min(1).optional(),
  transition: slideTransitionSchema.optional(),
  style: slideStyleSchema,
  importRenderMode: slideImportRenderModeSchema.optional(),
  elements: z.array(deckElementSchema),
  animations: z.array(animationSchema),
  triggerAnimationIds: z.array(deckAnimationIdSchema),
};

export const companionContentSlideSchema = z
  .object({
    ...companionSlideBaseFields,
    kind: z.literal("content"),
  })
  .strict();

export const companionActivitySlideSchema = z
  .object({
    ...companionSlideBaseFields,
    kind: z.literal("activity"),
    activity: activityDefinitionSchema,
  })
  .strict();

export const companionActivityResultSlideSchema = z
  .object({
    ...companionSlideBaseFields,
    kind: z.literal("activity-results"),
    activityResult: activityResultDefinitionSchema,
  })
  .strict();

export const companionSlideSchema = z.discriminatedUnion("kind", [
  companionContentSlideSchema,
  companionActivitySlideSchema,
  companionActivityResultSlideSchema,
]).superRefine((slide, context) => {
  const animationIds = new Set(
    slide.animations.map((animation) => animation.animationId),
  );
  for (const [index, animationId] of slide.triggerAnimationIds.entries()) {
    if (!animationIds.has(animationId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["triggerAnimationIds", index],
        message: "trigger animation must reference a projected animation",
      });
    }
  }
});

export const companionDeckSnapshotSchema = z
  .object({
    deckId: deckIdSchema,
    projectId: z.string().min(1),
    version: z.number().int().positive(),
    canvas: deckCanvasSchema,
    theme: themeSchema,
    slides: z.array(companionSlideSchema).min(1),
  })
  .strict();

export type CompanionSlide = z.infer<typeof companionSlideSchema>;
export type CompanionDeckSnapshot = z.infer<
  typeof companionDeckSnapshotSchema
>;

export const presentationCompanionPairingResponseSchema = z
  .object({
    pairingUrl: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === "https:", {
        message: "pairingUrl must use HTTPS",
      }),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const presentationCompanionExchangeResponseSchema = z
  .object({
    sessionId: z.string().min(1),
    expiresAt: isoDateTimeSchema,
    scopes: companionAccessScopesSchema,
  })
  .strict();

export const presentationCompanionStatusSchema = z
  .object({
    connected: z.boolean(),
    pairingGeneration: z.number().int().positive().nullable(),
    connectedAt: isoDateTimeSchema.nullable(),
    rttBucket: z.enum(["fast", "moderate", "slow", "unknown"]).nullable(),
  })
  .strict();

export const presentationCompanionBootstrapSchema = z
  .object({
    sessionId: z.string().min(1),
    sessionPurpose: presentationSessionPurposeSchema,
    expiresAt: isoDateTimeSchema,
    scopes: companionAccessScopesSchema,
    deck: companionDeckSnapshotSchema,
  })
  .strict();

export type CompanionAccessScope = z.infer<
  typeof companionAccessScopeSchema
>;
export type PresentationCompanionPairingResponse = z.infer<
  typeof presentationCompanionPairingResponseSchema
>;
export type PresentationCompanionExchangeResponse = z.infer<
  typeof presentationCompanionExchangeResponseSchema
>;
export type PresentationCompanionStatus = z.infer<
  typeof presentationCompanionStatusSchema
>;
export type PresentationCompanionBootstrap = z.infer<
  typeof presentationCompanionBootstrapSchema
>;

export const presentationCompanionActivityProjectionSchema = z
  .object({
    activityId: activityIdSchema,
    audienceUrl: z.string().min(1).nullable(),
    run: z
      .object({
        status: activityRuntimeStatusSchema,
      })
      .strict()
      .nullable(),
    publicResult: activityPublicResultSchema.nullable(),
  })
  .strict()
  .superRefine((projection, context) => {
    if (
      projection.run === null &&
      (projection.audienceUrl !== null || projection.publicResult !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "activity projection requires a current run",
      });
    }
    if (
      projection.publicResult !== null &&
      (projection.run?.status !== "results" ||
        projection.publicResult.activityId !== projection.activityId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publicResult"],
        message: "public result must match a revealed activity run",
      });
    }
  });

export type PresentationCompanionActivityProjection = z.infer<
  typeof presentationCompanionActivityProjectionSchema
>;
