import { z } from "zod";

import { isoDateTimeSchema } from "../common/time.schema";
import { activityQuestionTypeSchema } from "./activity-definition.schema";
import {
  activityIdSchema,
  activityOptionIdSchema,
  activityQuestionIdSchema,
  activityRunIdSchema,
  activityTextEntryIdSchema
} from "./activity-id.schema";
import {
  activityRuntimeStatusSchema,
  activityTextModerationStatusSchema
} from "./activity-runtime.schema";

export const activityChoiceAggregateItemSchema = z
  .object({
    optionId: activityOptionIdSchema,
    count: z.number().int().nonnegative(),
    ratio: z.number().finite().min(0).max(1)
  })
  .strict();

export const activityRatingAggregateItemSchema = z
  .object({
    value: z.number().int().min(1).max(5),
    count: z.number().int().nonnegative(),
    ratio: z.number().finite().min(0).max(1)
  })
  .strict();

export const activityQuestionAggregateSchema = z
  .object({
    questionId: activityQuestionIdSchema,
    type: activityQuestionTypeSchema,
    responseCount: z.number().int().nonnegative(),
    average: z.number().finite().min(1).max(5).nullable(),
    ratingDistribution: z.array(activityRatingAggregateItemSchema).max(5),
    choices: z.array(activityChoiceAggregateItemSchema).max(8)
  })
  .strict();

export const activityPresenterTextEntrySchema = z
  .object({
    entryId: activityTextEntryIdSchema,
    questionId: activityQuestionIdSchema,
    text: z.string().max(2000),
    displayName: z.string().max(40).nullable(),
    moderationStatus: activityTextModerationStatusSchema,
    answeredAt: isoDateTimeSchema.nullable(),
    updatedAt: isoDateTimeSchema
  })
  .strict();

export const activityPublicTextEntrySchema = z
  .object({
    entryId: activityTextEntryIdSchema,
    questionId: activityQuestionIdSchema,
    text: z.string().max(2000),
    answered: z.boolean()
  })
  .strict();

const activityResultBaseShape = {
  activityRunId: activityRunIdSchema,
  activityId: activityIdSchema,
  status: activityRuntimeStatusSchema,
  revision: z.number().int().nonnegative(),
  responseCount: z.number().int().nonnegative(),
  aggregates: z.array(activityQuestionAggregateSchema).max(5)
};

export const activityPresenterResultSchema = z
  .object({
    ...activityResultBaseShape,
    participantCount: z.number().int().nonnegative(),
    responseRate: z.number().int().min(0).max(100),
    textEntries: z.array(activityPresenterTextEntrySchema)
  })
  .strict();

export const activityPublicResultSchema = z
  .object({
    ...activityResultBaseShape,
    approvedTextEntries: z.array(activityPublicTextEntrySchema)
  })
  .strict();

export const activityEditorSummarySchema = z
  .object({
    presentationSessionId: z.string().trim().min(1),
    activityRunId: activityRunIdSchema,
    activityId: activityIdSchema,
    status: activityRuntimeStatusSchema,
    responseCount: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative()
  })
  .strict();

export type ActivityChoiceAggregateItem = z.infer<
  typeof activityChoiceAggregateItemSchema
>;
export type ActivityRatingAggregateItem = z.infer<
  typeof activityRatingAggregateItemSchema
>;
export type ActivityQuestionAggregate = z.infer<
  typeof activityQuestionAggregateSchema
>;
export type ActivityPresenterTextEntry = z.infer<
  typeof activityPresenterTextEntrySchema
>;
export type ActivityPublicTextEntry = z.infer<
  typeof activityPublicTextEntrySchema
>;
export type ActivityPresenterResult = z.infer<
  typeof activityPresenterResultSchema
>;
export type ActivityPublicResult = z.infer<typeof activityPublicResultSchema>;
export type ActivityEditorSummary = z.infer<
  typeof activityEditorSummarySchema
>;

export function calculateActivityResponseRate(
  responseCount: number,
  participantCount: number
): number {
  if (participantCount === 0) return 0;
  return Math.min(100, Math.round((responseCount / participantCount) * 100));
}

export function createAudienceActivityProjection(
  result: ActivityPresenterResult
): ActivityPublicResult | null {
  if (result.status !== "results") return null;

  return activityPublicResultSchema.parse({
    activityRunId: result.activityRunId,
    activityId: result.activityId,
    status: result.status,
    revision: result.revision,
    responseCount: result.responseCount,
    aggregates: result.aggregates,
    approvedTextEntries: result.textEntries
      .filter((entry) => entry.moderationStatus === "approved")
      .map((entry) => ({
        entryId: entry.entryId,
        questionId: entry.questionId,
        text: entry.text,
        answered: entry.answeredAt !== null
      }))
  });
}
