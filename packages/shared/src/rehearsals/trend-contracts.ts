import { z } from "zod";

import { coachingIdSchema } from "../coaching/coaching-common.schema";
import {
  criterionResultSchema,
  measurementStateSchema,
  reportObservationSchema,
} from "../coaching/evaluation-criterion.schema";
import { practiceVerificationSummarySchema } from "../coaching/focused-practice.schema";
import { coachingActionSchema } from "../coaching/practice-goal.schema";
import { isoDateTimeSchema } from "../common/time.schema";

export const trendMetricSchema = z.enum([
  "filler-word-count",
  "duration-seconds",
  "characters-per-minute",
  "words-per-minute",
  "timing-balance",
  "semantic-coverage",
  "volume-consistency",
  "pronunciation-confidence",
]);

export const trendSeriesPointSchema = z
  .object({
    runId: coachingIdSchema,
    createdAt: isoDateTimeSchema,
    measurementState: measurementStateSchema,
    comparability: z.enum(["comparable", "incomparable"]),
    value: z.number().finite().nonnegative().nullable(),
    reasonCode: z
      .enum([
        "NO_MEASUREMENT",
        "DECK_CHANGED",
        "BRIEF_CHANGED",
        "CRITERION_CHANGED",
        "SCOPE_CHANGED",
        "METRIC_DEFINITION_CHANGED",
        "LENS_CHANGED",
        "TARGET_CHANGED",
      ])
      .nullable(),
  })
  .strict()
  .superRefine((point, context) => {
    const isMeasured = point.measurementState === "measured";
    if (isMeasured !== (point.value !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "measured trend points require a value and unmeasured points must omit it.",
        path: ["value"],
      });
    }

    const requiresReason =
      point.measurementState === "unmeasured" ||
      point.comparability === "incomparable";
    if (requiresReason !== (point.reasonCode !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "unmeasured or incomparable trend points require a reason code.",
        path: ["reasonCode"],
      });
    }
  });

export const trendTargetRangeSchema = z
  .object({
    minimum: z.number().finite().nonnegative(),
    maximum: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((range) => range.maximum >= range.minimum, {
    message: "trend target range maximum must not be less than its minimum.",
    path: ["maximum"],
  });

export const trendSeriesSchema = z
  .object({
    seriesId: coachingIdSchema,
    projectId: coachingIdSchema,
    metric: trendMetricSchema,
    metricDefinitionVersion: z.number().int().positive(),
    unit: z.enum([
      "count",
      "seconds",
      "characters-per-minute",
      "words-per-minute",
      "ratio",
    ]),
    direction: z.enum([
      "lower-is-better",
      "higher-is-better",
      "target-range",
      "neutral",
    ]),
    targetRange: trendTargetRangeSchema.nullable(),
    points: z.array(trendSeriesPointSchema).max(5),
    calculatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((series, context) => {
    const runIds = series.points.map((point) => point.runId);
    if (new Set(runIds).size !== runIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "trend series run IDs must be unique.",
        path: ["points"],
      });
    }

    const expectedPresentation = {
      "filler-word-count": {
        unit: "count",
        direction: "lower-is-better",
        hasRange: false,
      },
      "duration-seconds": {
        unit: "seconds",
        direction: "target-range",
        hasRange: true,
      },
      "characters-per-minute": {
        unit: "characters-per-minute",
        direction: "neutral",
        hasRange: false,
      },
      "words-per-minute": {
        unit: "words-per-minute",
        direction: "target-range",
        hasRange: true,
      },
      "timing-balance": {
        unit: "ratio",
        direction: "higher-is-better",
        hasRange: false,
      },
      "semantic-coverage": {
        unit: "ratio",
        direction: "higher-is-better",
        hasRange: false,
      },
      "volume-consistency": {
        unit: "ratio",
        direction: "higher-is-better",
        hasRange: false,
      },
      "pronunciation-confidence": {
        unit: "ratio",
        direction: "higher-is-better",
        hasRange: false,
      },
    } as const;
    const expected = expectedPresentation[series.metric];
    if (
      series.unit !== expected.unit ||
      series.direction !== expected.direction
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "trend metric must use its canonical unit and direction.",
        path: ["metric"],
      });
    }
    if ((series.targetRange !== null) !== expected.hasRange) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "target-range metrics require a target range and other metrics must omit it.",
        path: ["targetRange"],
      });
    }
  });

export const coachingReadinessSchema = z.enum([
  "ready",
  "needs-practice",
  "unmeasured",
]);

export const reportTimelineEventSchema = z
  .object({
    eventId: coachingIdSchema,
    observationId: coachingIdSchema,
    category: z.enum(["structure", "semantic", "timing", "delivery"]),
    slideId: coachingIdSchema.nullable(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    severity: z.enum(["high", "medium", "low"]),
  })
  .strict()
  .refine((event) => event.endMs >= event.startMs, {
    message: "timeline event must not end before it starts.",
    path: ["endMs"],
  });

export const qnaAssessmentSchema = z
  .object({
    qnaSessionId: coachingIdSchema,
    projectId: coachingIdSchema,
    sourceFullRunId: coachingIdSchema,
    criterionResults: z.array(criterionResultSchema).max(24),
    assessedAt: isoDateTimeSchema,
  })
  .strict();

export const nextPracticePlanSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            order: z.union([
              z.literal(1),
              z.literal(2),
              z.literal(3),
              z.literal(4),
            ]),
            action: coachingActionSchema,
          })
          .strict(),
      )
      .max(4),
  })
  .strict()
  .superRefine((plan, context) => {
    plan.steps.forEach((step, index) => {
      if (step.order !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "next-practice plan steps must be ordered contiguously from one.",
          path: ["steps", index, "order"],
        });
      }
    });
  });

export const coachingReportViewSchema = z
  .object({
    reportId: coachingIdSchema,
    runId: coachingIdSchema,
    projectId: coachingIdSchema,
    viewState: z.enum(["ready", "partial"]),
    readiness: coachingReadinessSchema,
    criterionResults: z.array(criterionResultSchema).max(100),
    observations: z.array(reportObservationSchema).max(500),
    topActions: z.array(coachingActionSchema).max(3),
    practiceVerification: practiceVerificationSummarySchema.nullable(),
    trendSeries: z.array(trendSeriesSchema).max(8),
    timelineEvents: z.array(reportTimelineEventSchema).max(500),
    qnaAssessment: qnaAssessmentSchema.nullable(),
    nextPracticePlan: nextPracticePlanSchema,
    generatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((view, context) => {
    const observationIds = view.observations.map((item) => item.observationId);
    const observationIdSet = new Set(observationIds);
    if (observationIdSet.size !== observationIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "coaching report observation IDs must be unique.",
        path: ["observations"],
      });
    }

    const validateResultObservation = (
      result: z.infer<typeof criterionResultSchema>,
      path: Array<string | number>,
    ) => {
      if (!result.observationId) return;
      const observation = view.observations.find(
        (item) => item.observationId === result.observationId,
      );
      if (!observation) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "criterion result observation must exist in the report view.",
          path: [...path, "observationId"],
        });
        return;
      }
      const sameCriterion =
        observation.criterionRef.criterionId ===
          result.criterionRef.criterionId &&
        observation.criterionRef.revision === result.criterionRef.revision;
      const sameScope =
        JSON.stringify(observation.scope) === JSON.stringify(result.scope);
      if (!sameCriterion || !sameScope) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "criterion result observation must use the same criterion and scope.",
          path: [...path, "observationId"],
        });
      }
    };

    view.criterionResults.forEach((result, index) => {
      validateResultObservation(result, ["criterionResults", index]);
    });

    const validateAction = (
      action: z.infer<typeof coachingActionSchema>,
      path: Array<string | number>,
      requireEvidence: boolean,
    ) => {
      if (action.target.projectId !== view.projectId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "coaching action must belong to the report project.",
          path: [...path, "target", "projectId"],
        });
      }
      if (requireEvidence && action.observationIds.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Top coaching actions require at least one observation.",
          path: [...path, "observationIds"],
        });
      }
      action.observationIds.forEach((observationId, observationIndex) => {
        const observation = view.observations.find(
          (item) => item.observationId === observationId,
        );
        const matchesCriterion =
          observation?.criterionRef.criterionId ===
            action.criterionRef.criterionId &&
          observation?.criterionRef.revision === action.criterionRef.revision;
        if (!observation || !matchesCriterion) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "coaching action observations must exist and use the action criterion.",
            path: [...path, "observationIds", observationIndex],
          });
        }
      });
    };

    view.topActions.forEach((action, index) => {
      validateAction(action, ["topActions", index], true);
    });

    view.trendSeries.forEach((series, index) => {
      if (series.projectId !== view.projectId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "trend series must belong to the report project.",
          path: ["trendSeries", index, "projectId"],
        });
      }
    });

    view.timelineEvents.forEach((event, index) => {
      if (!observationIdSet.has(event.observationId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "timeline events must reference an observation in the report view.",
          path: ["timelineEvents", index, "observationId"],
        });
      }
    });

    view.nextPracticePlan.steps.forEach((step, index) => {
      validateAction(
        step.action,
        ["nextPracticePlan", "steps", index, "action"],
        false,
      );
    });

    if (view.qnaAssessment) {
      if (
        view.qnaAssessment.projectId !== view.projectId ||
        view.qnaAssessment.sourceFullRunId !== view.runId
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Q&A assessment must belong to the report project and source run.",
          path: ["qnaAssessment"],
        });
      }
      view.qnaAssessment.criterionResults.forEach((result, index) => {
        validateResultObservation(result, [
          "qnaAssessment",
          "criterionResults",
          index,
        ]);
      });
    }

    if (
      view.practiceVerification &&
      (view.practiceVerification.projectId !== view.projectId ||
        view.practiceVerification.evaluatedFullRunId !== view.runId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "practice verification must belong to the report project and run.",
        path: ["practiceVerification"],
      });
    }
  });

export type CoachingReadiness = z.infer<typeof coachingReadinessSchema>;
export type ReportTimelineEvent = z.infer<typeof reportTimelineEventSchema>;
export type QnaAssessment = z.infer<typeof qnaAssessmentSchema>;
export type NextPracticePlan = z.infer<typeof nextPracticePlanSchema>;
export type TrendSeries = z.infer<typeof trendSeriesSchema>;
export type CoachingReportView = z.infer<typeof coachingReportViewSchema>;
