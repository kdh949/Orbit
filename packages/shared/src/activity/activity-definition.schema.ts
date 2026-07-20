import { z } from "zod";

import {
  activityIdSchema,
  activityOptionIdSchema,
  activityQuestionIdSchema
} from "./activity-id.schema";

const activityTitleSchema = z.string().trim().min(1).max(120);
const activityDescriptionSchema = z.string().trim().max(500);
const activityQuestionPromptSchema = z.string().trim().min(1).max(500);
const ratingLabelSchema = z.string().trim().max(40);

export const activityTemplateSchema = z.enum([
  "pre-question",
  "poll",
  "satisfaction"
]);

export const activityQuestionTypeSchema = z.enum([
  "rating",
  "single-choice",
  "multiple-choice",
  "free-text"
]);

export const activityOptionSchema = z
  .object({
    optionId: activityOptionIdSchema,
    label: z.string().trim().min(1).max(100)
  })
  .strict();

const choiceOptionsSchema = z
  .array(activityOptionSchema)
  .min(2)
  .max(8)
  .superRefine((options, ctx) => {
    const ids = new Set<string>();
    const labels = new Set<string>();

    options.forEach((option, index) => {
      const label = option.label.toLocaleLowerCase("ko-KR");
      if (ids.has(option.optionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "optionId"],
          message: "option IDs must be unique within a question"
        });
      }
      if (labels.has(label)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "label"],
          message: "option labels must be unique within a question"
        });
      }
      ids.add(option.optionId);
      labels.add(label);
    });
  });

export const ratingActivityQuestionSchema = z
  .object({
    questionId: activityQuestionIdSchema,
    type: z.literal("rating"),
    prompt: activityQuestionPromptSchema,
    required: z.boolean().default(false),
    leftLabel: ratingLabelSchema.default("매우 불만족"),
    rightLabel: ratingLabelSchema.default("매우 만족")
  })
  .strict();

export const singleChoiceActivityQuestionSchema = z
  .object({
    questionId: activityQuestionIdSchema,
    type: z.literal("single-choice"),
    prompt: activityQuestionPromptSchema,
    required: z.boolean().default(false),
    options: choiceOptionsSchema
  })
  .strict();

export const multipleChoiceActivityQuestionSchema = z
  .object({
    questionId: activityQuestionIdSchema,
    type: z.literal("multiple-choice"),
    prompt: activityQuestionPromptSchema,
    required: z.boolean().default(false),
    options: choiceOptionsSchema,
    maxSelections: z.number().int().min(1).max(8).optional()
  })
  .strict()
  .superRefine((question, ctx) => {
    if (
      question.maxSelections !== undefined &&
      question.maxSelections > question.options.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxSelections"],
        message: "maxSelections cannot exceed the option count"
      });
    }
  });

export const freeTextActivityQuestionSchema = z
  .object({
    questionId: activityQuestionIdSchema,
    type: z.literal("free-text"),
    prompt: activityQuestionPromptSchema,
    required: z.boolean().default(false)
  })
  .strict();

export const activityQuestionSchema = z.union([
  ratingActivityQuestionSchema,
  singleChoiceActivityQuestionSchema,
  multipleChoiceActivityQuestionSchema,
  freeTextActivityQuestionSchema
]);

export const activityDefinitionSchema = z
  .object({
    activityId: activityIdSchema,
    template: activityTemplateSchema,
    title: activityTitleSchema,
    description: activityDescriptionSchema.default(""),
    questions: z.array(activityQuestionSchema).min(1).max(5),
    allowDisplayName: z.boolean().default(false),
    hideResultsUntilReveal: z.boolean().default(true)
  })
  .strict()
  .superRefine((definition, ctx) => {
    const questionIds = new Set<string>();
    definition.questions.forEach((question, index) => {
      if (questionIds.has(question.questionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", index, "questionId"],
          message: "question IDs must be unique within an activity"
        });
      }
      questionIds.add(question.questionId);
    });

    if (
      definition.template === "pre-question" &&
      definition.questions.some((question) => question.type !== "free-text")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questions"],
        message: "pre-question requires one to five free-text questions"
      });
    }

    if (
      definition.template === "poll" &&
      (definition.questions.length !== 1 ||
        definition.questions[0]?.type !== "single-choice")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questions"],
        message: "poll requires exactly one single-choice question"
      });
    }
  });

export const activityResultLayoutSchema = z.enum([
  "summary",
  "chart",
  "approved-text"
]);

export const activityResultDefinitionSchema = z
  .object({
    sourceActivityId: activityIdSchema,
    display: z.literal("live"),
    layout: activityResultLayoutSchema
  })
  .strict();

export type ActivityTemplate = z.infer<typeof activityTemplateSchema>;
export type ActivityQuestionType = z.infer<typeof activityQuestionTypeSchema>;
export type ActivityOption = z.infer<typeof activityOptionSchema>;
export type RatingActivityQuestion = z.infer<
  typeof ratingActivityQuestionSchema
>;
export type SingleChoiceActivityQuestion = z.infer<
  typeof singleChoiceActivityQuestionSchema
>;
export type MultipleChoiceActivityQuestion = z.infer<
  typeof multipleChoiceActivityQuestionSchema
>;
export type FreeTextActivityQuestion = z.infer<
  typeof freeTextActivityQuestionSchema
>;
export type ActivityQuestion = z.infer<typeof activityQuestionSchema>;
export type ActivityDefinition = z.infer<typeof activityDefinitionSchema>;
export type ActivityResultLayout = z.infer<typeof activityResultLayoutSchema>;
export type ActivityResultDefinition = z.infer<
  typeof activityResultDefinitionSchema
>;
