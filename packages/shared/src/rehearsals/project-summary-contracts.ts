import { z } from "zod";

import { isoDateTimeSchema } from "../common/time.schema";
import { deckSlideIdSchema } from "../deck/id.schema";

export const runDurationPointSchema = z.object({
  runId: z.string().min(1),
  createdAt: isoDateTimeSchema,
  durationSeconds: z.number().nonnegative(),
});

export const slideAvgTimingSchema = z.object({
  slideId: deckSlideIdSchema,
  avgSeconds: z.number().nonnegative(),
  sampleCount: z.number().int().nonnegative(),
});

export const rehearsalProjectMetricReasonCodeSchema = z.enum([
  "REPORT_UNAVAILABLE",
  "DURATION_UNMEASURED",
  "SILENCE_UNMEASURED",
  "SEMANTIC_EVALUATION_UNAVAILABLE",
  "NO_MEASURABLE_CORE_CUES",
  "KEYWORD_COVERAGE_UNMEASURED",
  "NO_MEASURABLE_KEYWORDS",
  "SLIDE_TIMINGS_UNAVAILABLE",
]);

const rehearsalProjectMeasuredStateSchema = z.object({
  measurementState: z.literal("measured"),
  reasonCode: z.null(),
});

const rehearsalProjectUnmeasuredStateSchema = z.object({
  measurementState: z.literal("unmeasured"),
  reasonCode: rehearsalProjectMetricReasonCodeSchema,
});

export const rehearsalProjectDurationMetricSchema = z.discriminatedUnion(
  "measurementState",
  [
    rehearsalProjectMeasuredStateSchema.extend({
      actualSeconds: z.number().nonnegative(),
      targetSeconds: z.number().nonnegative().nullable(),
    }),
    rehearsalProjectUnmeasuredStateSchema.extend({
      actualSeconds: z.null(),
      targetSeconds: z.number().nonnegative().nullable(),
    }),
  ],
);

export const rehearsalProjectLongSilenceMetricSchema = z.discriminatedUnion(
  "measurementState",
  [
    rehearsalProjectMeasuredStateSchema.extend({
      count: z.number().int().nonnegative(),
      metricDefinitionVersion: z.number().int().positive(),
    }),
    rehearsalProjectUnmeasuredStateSchema.extend({
      count: z.null(),
      metricDefinitionVersion: z.number().int().positive().nullable(),
    }),
  ],
);

export const rehearsalProjectCoreMessageCoverageSchema = z.discriminatedUnion(
  "measurementState",
  [
    rehearsalProjectMeasuredStateSchema.extend({
      coveredCount: z.number().int().nonnegative(),
      partialCount: z.number().int().nonnegative(),
      missedCount: z.number().int().nonnegative(),
      measurableCount: z.number().int().positive(),
      rate: z.number().min(0).max(1),
    }),
    rehearsalProjectUnmeasuredStateSchema.extend({
      coveredCount: z.literal(0),
      partialCount: z.literal(0),
      missedCount: z.literal(0),
      measurableCount: z.literal(0),
      rate: z.null(),
    }),
  ],
);

export const rehearsalProjectKeywordCoverageSchema = z.discriminatedUnion(
  "measurementState",
  [
    rehearsalProjectMeasuredStateSchema.extend({
      matchedCount: z.number().int().nonnegative(),
      missedCount: z.number().int().nonnegative(),
      measurableCount: z.number().int().positive(),
      rate: z.number().min(0).max(1),
    }),
    rehearsalProjectUnmeasuredStateSchema.extend({
      matchedCount: z.literal(0),
      missedCount: z.literal(0),
      measurableCount: z.literal(0),
      rate: z.null(),
    }),
  ],
);

export const rehearsalProjectTimingOverrunSchema = z.discriminatedUnion(
  "measurementState",
  [
    rehearsalProjectMeasuredStateSchema.extend({
      overrunCount: z.number().int().nonnegative(),
      measurableCount: z.number().int().positive(),
      rate: z.number().min(0).max(1),
    }),
    rehearsalProjectUnmeasuredStateSchema.extend({
      overrunCount: z.literal(0),
      measurableCount: z.literal(0),
      rate: z.null(),
    }),
  ],
);

export const rehearsalProjectRunMetricPointSchema = z.object({
  runId: z.string().min(1),
  createdAt: isoDateTimeSchema,
  duration: rehearsalProjectDurationMetricSchema,
  longSilence: rehearsalProjectLongSilenceMetricSchema,
  coreMessageCoverage: rehearsalProjectCoreMessageCoverageSchema,
  keywordCoverage: rehearsalProjectKeywordCoverageSchema,
  timingOverrun: rehearsalProjectTimingOverrunSchema,
});

export const rehearsalProjectSlidePerformanceSummarySchema = z.object({
  slideId: deckSlideIdSchema,
  order: z.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  thumbnailUrl: z.string(),
  avgActualSeconds: z.number().nonnegative().nullable(),
  targetSeconds: z.number().nonnegative().nullable(),
  sampleCount: z.number().int().nonnegative(),
  timingOverrun: rehearsalProjectTimingOverrunSchema,
  coreMessageCoverage: rehearsalProjectCoreMessageCoverageSchema,
  keywordCoverage: rehearsalProjectKeywordCoverageSchema,
  repeatedMissedKeywordCount: z.number().int().nonnegative().default(0),
});

export const rehearsalProjectSummarySchema = z.object({
  projectId: z.string().min(1),
  runCount: z.number().int().nonnegative(),
  runDurationSeries: z.array(runDurationPointSchema).default([]),
  slideAvgTimings: z.array(slideAvgTimingSchema).default([]),
  runMetricSeries: z.array(rehearsalProjectRunMetricPointSchema).default([]),
  slidePerformanceSummaries: z
    .array(rehearsalProjectSlidePerformanceSummarySchema)
    .default([]),
  progressComment: z.string().nullable(),
});

export const getRehearsalProjectSummaryResponseSchema = z.object({
  summary: rehearsalProjectSummarySchema.nullable(),
});

export type RunDurationPoint = z.infer<typeof runDurationPointSchema>;
export type SlideAvgTiming = z.infer<typeof slideAvgTimingSchema>;
export type RehearsalProjectMetricReasonCode = z.infer<
  typeof rehearsalProjectMetricReasonCodeSchema
>;
export type RehearsalProjectDurationMetric = z.infer<
  typeof rehearsalProjectDurationMetricSchema
>;
export type RehearsalProjectLongSilenceMetric = z.infer<
  typeof rehearsalProjectLongSilenceMetricSchema
>;
export type RehearsalProjectCoreMessageCoverage = z.infer<
  typeof rehearsalProjectCoreMessageCoverageSchema
>;
export type RehearsalProjectKeywordCoverage = z.infer<
  typeof rehearsalProjectKeywordCoverageSchema
>;
export type RehearsalProjectTimingOverrun = z.infer<
  typeof rehearsalProjectTimingOverrunSchema
>;
export type RehearsalProjectRunMetricPoint = z.infer<
  typeof rehearsalProjectRunMetricPointSchema
>;
export type RehearsalProjectSlidePerformanceSummary = z.infer<
  typeof rehearsalProjectSlidePerformanceSummarySchema
>;
export type RehearsalProjectSummary = z.infer<
  typeof rehearsalProjectSummarySchema
>;
export type GetRehearsalProjectSummaryResponse = z.infer<
  typeof getRehearsalProjectSummaryResponseSchema
>;
