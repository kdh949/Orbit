import { z } from "zod";

import {
  legacyRehearsalSilenceAnalysis,
  rehearsalSilenceAnalysisSchema,
} from "../rehearsals/rehearsal-audio-analysis.schema";
import { coachingIdSchema } from "./coaching-common.schema";

const boundedTextSchema = z.string().trim().min(1).max(128);
const positiveFiniteNumberSchema = z.number().finite().positive();
const nullablePositiveFiniteNumberSchema =
  positiveFiniteNumberSchema.nullable();

export const rehearsalPronunciationContextTermSchema = z
  .object({
    source: z.string().trim().min(1).max(64),
    aliases: z.array(z.string().trim().min(1).max(64)).min(1).max(4),
  })
  .strict();

export const rehearsalSlideSpeakingRateReasonCodeSchema = z.enum([
  "UNSUPPORTED_LANGUAGE",
  "SEGMENT_TIMESTAMPS_UNAVAILABLE",
  "INSUFFICIENT_SLIDE_SPEECH",
  "BASELINE_UNAVAILABLE",
  "LEGACY_REPORT",
]);

const rehearsalSlideSpeakingRateEvidenceSchema = {
  metricDefinitionVersion: z.literal(1),
  activeSpeechSeconds: z.number().finite().nonnegative(),
  characterCount: z.number().int().nonnegative(),
};

export const rehearsalSlideSpeakingRateSchema = z.discriminatedUnion(
  "measurementState",
  [
    z
      .object({
        ...rehearsalSlideSpeakingRateEvidenceSchema,
        measurementState: z.literal("measured"),
        reasonCode: z.null(),
        charactersPerSecond: z.number().finite().positive(),
        baselineCharactersPerSecond: z.number().finite().positive(),
        relativeRateRatio: z.number().finite().positive(),
        paceCategory: z.enum(["slower", "similar", "faster"]),
      })
      .strict(),
    z
      .object({
        ...rehearsalSlideSpeakingRateEvidenceSchema,
        measurementState: z.literal("unmeasured"),
        reasonCode: rehearsalSlideSpeakingRateReasonCodeSchema,
        charactersPerSecond: z.null(),
        baselineCharactersPerSecond: z.null(),
        relativeRateRatio: z.null(),
        paceCategory: z.null(),
      })
      .strict(),
  ],
);

export const legacyRehearsalSlideSpeakingRate = {
  metricDefinitionVersion: 1 as const,
  measurementState: "unmeasured" as const,
  reasonCode: "LEGACY_REPORT" as const,
  charactersPerSecond: null,
  baselineCharactersPerSecond: null,
  relativeRateRatio: null,
  paceCategory: null,
  activeSpeechSeconds: 0,
  characterCount: 0,
};

export const approvedSttNormalizationProfileIds: readonly string[] = [];

export const normalizedSttConfidenceSchema = z
  .object({
    value: z.number().finite().min(0).max(1),
    source: z.enum([
      "provider-overall",
      "provider-segment-aggregate",
      "provider-word-aggregate",
    ]),
    normalizationProfileId: boundedTextSchema,
  })
  .strict()
  .superRefine((confidence, context) => {
    if (
      !approvedSttNormalizationProfileIds.includes(
        confidence.normalizationProfileId,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "normalization profile is not approved.",
        path: ["normalizationProfileId"],
      });
    }
  });

export const rehearsalAnalyzeTranscriptSegmentV2Schema = z
  .object({
    text: z.string().trim().min(1),
    startSeconds: z.number().finite().nonnegative().nullable(),
    endSeconds: z.number().finite().nonnegative().nullable(),
    confidence: normalizedSttConfidenceSchema.nullable(),
  })
  .strict()
  .superRefine((segment, context) => {
    const hasStart = segment.startSeconds !== null;
    const hasEnd = segment.endSeconds !== null;
    if (hasStart !== hasEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "segment timestamps must both be present or both be null.",
        path: hasStart ? ["endSeconds"] : ["startSeconds"],
      });
      return;
    }
    if (
      segment.startSeconds !== null &&
      segment.endSeconds !== null &&
      segment.endSeconds < segment.startSeconds
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "segment end must not precede its start.",
        path: ["endSeconds"],
      });
    }
  });

export const rehearsalAnalyzeDeckKeywordV2Schema = z
  .object({
    keywordId: coachingIdSchema,
    slideId: coachingIdSchema,
    text: z.string().trim().min(1),
    synonyms: z.array(z.string().trim().min(1)),
    abbreviations: z.array(z.string().trim().min(1)),
  })
  .strict();

export const rehearsalAnalyzeSlideTimelineEntryV2Schema = z
  .object({
    slideId: coachingIdSchema,
    enteredSecond: z.number().finite().nonnegative(),
  })
  .strict();

export const rehearsalAnalyzeRequestV2Schema = z
  .object({
    contractVersion: z.literal(2),
    runId: coachingIdSchema,
    projectId: coachingIdSchema,
    deckId: coachingIdSchema,
    transcript: z.string(),
    language: boundedTextSchema,
    provider: boundedTextSchema,
    model: boundedTextSchema,
    sttConfidence: normalizedSttConfidenceSchema.nullable(),
    recordingDurationSeconds: nullablePositiveFiniteNumberSchema,
    providerDurationSeconds: nullablePositiveFiniteNumberSchema,
    segments: z.array(rehearsalAnalyzeTranscriptSegmentV2Schema),
    deckKeywords: z.array(rehearsalAnalyzeDeckKeywordV2Schema),
    pronunciationContext: z
      .array(rehearsalPronunciationContextTermSchema)
      .max(32)
      .default([]),
    slideTimeline: z.array(rehearsalAnalyzeSlideTimelineEntryV2Schema),
    silenceAnalysis: rehearsalSilenceAnalysisSchema,
  })
  .strict()
  .superRefine((request, context) => {
    let previousSegmentStart = -Infinity;
    request.segments.forEach((segment, index) => {
      if (segment.startSeconds === null) {
        return;
      }
      if (segment.startSeconds < previousSegmentStart) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "timed segments must be ordered by start time.",
          path: ["segments", index, "startSeconds"],
        });
      }
      previousSegmentStart = segment.startSeconds;
    });

    let previousEnteredSecond = -Infinity;
    request.slideTimeline.forEach((entry, index) => {
      if (entry.enteredSecond < previousEnteredSecond) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "slide timeline entries must be ordered by entry time.",
          path: ["slideTimeline", index, "enteredSecond"],
        });
      }
      if (
        index > 0 &&
        request.slideTimeline[index - 1]?.slideId === entry.slideId
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "consecutive duplicate slide entries must be normalized.",
          path: ["slideTimeline", index, "slideId"],
        });
      }
      previousEnteredSecond = entry.enteredSecond;
    });
  });

export const speechMeasurementReasonCodeSchema = z.enum([
  "NO_DURATION_EVIDENCE",
  "EMPTY_TRANSCRIPT",
  "UNSUPPORTED_CPM_LANGUAGE",
  "LOW_TRANSCRIPTION_CONFIDENCE",
  "NO_KEYWORDS",
  "SEGMENT_TIMESTAMPS_UNAVAILABLE",
  "AUDIO_ANALYSIS_UNAVAILABLE",
  "LEGACY_MEASUREMENT_STATE_UNKNOWN",
]);

export const metricMeasurementSchema = z
  .object({
    measurementState: z.enum(["measured", "unmeasured"]),
    metricDefinitionVersion: z.number().int().positive(),
    reasonCode: speechMeasurementReasonCodeSchema.nullable(),
  })
  .strict()
  .superRefine((measurement, context) => {
    if (
      (measurement.measurementState === "measured") !==
      (measurement.reasonCode === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only unmeasured metrics require a reason code.",
        path: ["reasonCode"],
      });
    }
  });

const qualityGateWithPolicyBase = {
  version: z.literal(1),
  confidence: z.number().finite().min(0).max(1),
  threshold: z.number().finite().min(0).max(1),
  policyId: coachingIdSchema,
};

export const rehearsalAnalyzeSttQualityGateSchema = z
  .discriminatedUnion("state", [
    z
      .object({
        ...qualityGateWithPolicyBase,
        state: z.literal("passed"),
        reasonCode: z.literal("CONFIDENCE_ACCEPTED"),
      })
      .strict(),
    z
      .object({
        ...qualityGateWithPolicyBase,
        state: z.literal("failed"),
        reasonCode: z.literal("LOW_TRANSCRIPTION_CONFIDENCE"),
      })
      .strict(),
    z
      .object({
        version: z.literal(1),
        state: z.literal("unavailable"),
        reasonCode: z.enum([
          "CONFIDENCE_NOT_PROVIDED",
          "QUALITY_POLICY_NOT_CONFIGURED",
        ]),
        confidence: z.number().finite().min(0).max(1).nullable(),
        threshold: z.null(),
        policyId: z.null(),
      })
      .strict(),
  ])
  .superRefine((gate, context) => {
    if (gate.state === "passed" && gate.confidence < gate.threshold) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "passed quality gate confidence must meet its threshold.",
        path: ["confidence"],
      });
    }
    if (gate.state === "failed" && gate.confidence >= gate.threshold) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "failed quality gate confidence must be below its threshold.",
        path: ["confidence"],
      });
    }
    if (
      gate.state === "unavailable" &&
      gate.reasonCode === "CONFIDENCE_NOT_PROVIDED" &&
      gate.confidence !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "confidence must be null when it was not provided.",
        path: ["confidence"],
      });
    }
  });

export const analysisCapabilitySchema = z
  .object({
    state: z.enum(["available", "unavailable"]),
    source: z.enum([
      "recording",
      "provider",
      "segment",
      "slide-timeline",
      "none",
    ]),
  })
  .strict()
  .superRefine((capability, context) => {
    if ((capability.state === "available") === (capability.source === "none")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "capability state and source must agree.",
        path: ["source"],
      });
    }
  });

export const fillerOccurrenceSchema = z
  .object({
    segmentIndex: z.number().int().nonnegative(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    precision: z.enum(["word", "segment"]),
    slideId: coachingIdSchema.nullable(),
  })
  .strict()
  .superRefine((occurrence, context) => {
    if (occurrence.endMs < occurrence.startMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "filler occurrence end must not precede its start.",
        path: ["endMs"],
      });
    }
  });

export const fillerWordDetailV2Schema = z
  .object({
    word: z.string().trim().min(1),
    count: z.number().int().nonnegative(),
    occurrences: z.array(fillerOccurrenceSchema),
  })
  .strict();

const metricMeasurementsSchema = z
  .object({
    duration: metricMeasurementSchema,
    charactersPerMinute: metricMeasurementSchema,
    wordsPerMinute: metricMeasurementSchema,
    fillerWordCount: metricMeasurementSchema,
    longSilenceCount: metricMeasurementSchema,
    keywordCoverage: metricMeasurementSchema,
  })
  .strict();

const analysisCapabilitiesSchema = z
  .object({
    recordingDuration: analysisCapabilitySchema,
    providerDuration: analysisCapabilitySchema,
    segmentTimestamps: analysisCapabilitySchema,
    sttConfidence: analysisCapabilitySchema,
    sentenceBoundaries: analysisCapabilitySchema,
  })
  .strict();

const speedSampleSchema = z
  .object({
    startSecond: z.number().finite().nonnegative(),
    endSecond: z.number().finite().nonnegative(),
    wordsPerMinute: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((sample, context) => {
    if (sample.endSecond < sample.startSecond) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "speed sample end must not precede its start.",
        path: ["endSecond"],
      });
    }
  });

const missedKeywordSchema = z
  .object({
    slideId: coachingIdSchema,
    keywordId: coachingIdSchema,
    text: z.string().trim().min(1),
  })
  .strict();

const slideInsightSchema = z
  .object({
    slideId: coachingIdSchema,
    fillerWordCount: z.number().int().nonnegative().nullable(),
    longSilenceCount: z.number().int().nonnegative().nullable(),
    speakingRate: rehearsalSlideSpeakingRateSchema.default(
      legacyRehearsalSlideSpeakingRate,
    ),
  })
  .strict();

const aiSummarySchema = z
  .object({
    headline: z.string(),
    paragraphs: z.array(z.string()),
  })
  .strict();

const coachingSchema = z
  .object({
    status: z.literal("succeeded"),
    summary: z.string(),
    strengths: z.array(z.string()),
    improvements: z.array(z.string()),
    nextPracticeFocus: z.string(),
    message: z.string(),
  })
  .strict();

function addMeasurementValueIssue(
  context: z.RefinementCtx,
  measurement: z.infer<typeof metricMeasurementSchema>,
  value: number | null,
  path: string,
) {
  if ((measurement.measurementState === "measured") !== (value !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "metric value must match its measurement state.",
      path: [path],
    });
  }
}

function isTimeOrdered(values: Array<{ start: number; end: number }>): boolean {
  return values.every((value, index) => {
    if (index === 0) {
      return true;
    }
    const previous = values[index - 1];
    return (
      previous !== undefined &&
      (value.start > previous.start ||
        (value.start === previous.start && value.end >= previous.end))
    );
  });
}

export const rehearsalAnalyzeResponseV2Schema = z
  .object({
    contractVersion: z.literal(2),
    runId: coachingIdSchema,
    durationSeconds: nullablePositiveFiniteNumberSchema,
    durationSource: z
      .enum(["recording", "provider", "segment-window"])
      .nullable(),
    charactersPerMinute: z.number().finite().nonnegative().nullable(),
    wordsPerMinute: z.number().finite().nonnegative().nullable(),
    fillerWordCount: z.number().int().nonnegative().nullable(),
    longSilenceCount: z.number().int().nonnegative().nullable(),
    sttQualityGate: rehearsalAnalyzeSttQualityGateSchema,
    measurements: metricMeasurementsSchema,
    capabilities: analysisCapabilitiesSchema,
    speedSamples: z.array(speedSampleSchema),
    fillerWordDetails: z.array(fillerWordDetailV2Schema),
    keywordCoverage: z.number().finite().min(0).max(1).nullable(),
    missedKeywords: z.array(missedKeywordSchema),
    slideInsights: z.array(slideInsightSchema),
    aiSummary: aiSummarySchema.optional(),
    coaching: coachingSchema.optional(),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      (response.durationSeconds === null) !==
      (response.durationSource === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "duration value and source must both be present or both be null.",
        path: ["durationSource"],
      });
    }

    addMeasurementValueIssue(
      context,
      response.measurements.duration,
      response.durationSeconds,
      "durationSeconds",
    );
    addMeasurementValueIssue(
      context,
      response.measurements.charactersPerMinute,
      response.charactersPerMinute,
      "charactersPerMinute",
    );
    addMeasurementValueIssue(
      context,
      response.measurements.wordsPerMinute,
      response.wordsPerMinute,
      "wordsPerMinute",
    );
    addMeasurementValueIssue(
      context,
      response.measurements.fillerWordCount,
      response.fillerWordCount,
      "fillerWordCount",
    );
    addMeasurementValueIssue(
      context,
      response.measurements.longSilenceCount,
      response.longSilenceCount,
      "longSilenceCount",
    );
    addMeasurementValueIssue(
      context,
      response.measurements.keywordCoverage,
      response.keywordCoverage,
      "keywordCoverage",
    );

    if (response.measurements.duration.metricDefinitionVersion !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duration uses metric definition version 1.",
        path: ["measurements", "duration", "metricDefinitionVersion"],
      });
    }
    for (const name of [
      "charactersPerMinute",
      "wordsPerMinute",
      "fillerWordCount",
      "longSilenceCount",
      "keywordCoverage",
    ] as const) {
      if (response.measurements[name].metricDefinitionVersion !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} uses metric definition version 1.`,
          path: ["measurements", name, "metricDefinitionVersion"],
        });
      }
    }
    const fillerCount = response.fillerWordDetails.reduce(
      (total, detail) => total + detail.count,
      0,
    );
    if (
      response.fillerWordCount !== null &&
      response.fillerWordCount !== fillerCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "filler count must equal the detail count sum.",
        path: ["fillerWordCount"],
      });
    }
    if (
      !isTimeOrdered(
        response.speedSamples.map((sample) => ({
          start: sample.startSecond,
          end: sample.endSecond,
        })),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "speed samples must be ordered by time.",
        path: ["speedSamples"],
      });
    }

    response.fillerWordDetails.forEach((detail, index) => {
      const previous = response.fillerWordDetails[index - 1];
      if (
        previous !== undefined &&
        (detail.count > previous.count ||
          (detail.count === previous.count &&
            detail.word.localeCompare(previous.word) < 0))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "filler details must be ordered by count and word.",
          path: ["fillerWordDetails", index],
        });
      }
      if (
        !isTimeOrdered(
          detail.occurrences.map((occurrence) => ({
            start: occurrence.startMs,
            end: occurrence.endMs,
          })),
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "filler occurrences must be ordered by time.",
          path: ["fillerWordDetails", index, "occurrences"],
        });
      }
    });

    const unmeasuredDetails = [
      [response.measurements.wordsPerMinute, response.speedSamples],
      [response.measurements.fillerWordCount, response.fillerWordDetails],
      [response.measurements.keywordCoverage, response.missedKeywords],
    ] as const;
    unmeasuredDetails.forEach(([measurement, details], index) => {
      if (measurement.measurementState === "unmeasured" && details.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "unmeasured metrics must not include derived details.",
          path: [
            ["speedSamples", "fillerWordDetails", "missedKeywords"][index] ??
              "measurements",
          ],
        });
      }
    });

    if (
      response.measurements.fillerWordCount.measurementState === "unmeasured" &&
      response.slideInsights.some((insight) => insight.fillerWordCount !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "slide filler insights require a measured filler word count.",
        path: ["slideInsights"],
      });
    }

    if (response.sttQualityGate.state === "failed") {
      for (const name of [
        "charactersPerMinute",
        "wordsPerMinute",
        "fillerWordCount",
        "keywordCoverage",
      ] as const) {
        const measurement = response.measurements[name];
        if (
          measurement.measurementState !== "unmeasured" ||
          measurement.reasonCode !== "LOW_TRANSCRIPTION_CONFIDENCE"
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "failed quality gate must block STT-dependent metrics.",
            path: ["measurements", name],
          });
        }
      }
      if (
        response.speedSamples.length > 0 ||
        response.fillerWordDetails.length > 0 ||
        response.missedKeywords.length > 0 ||
        response.slideInsights.some(
          (insight) => insight.fillerWordCount !== null,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "failed quality gate must not return STT-dependent details.",
          path: ["sttQualityGate"],
        });
      }
    }
  });

// Temporary deployment compatibility surface. New writers use v2 only.
export const rehearsalAnalyzeTranscriptSegmentV1Schema = z
  .object({
    text: z.string(),
    startSeconds: z.number().finite().nonnegative().nullable().optional(),
    endSeconds: z.number().finite().nonnegative().nullable().optional(),
  })
  .strict();

export const rehearsalAnalyzeDeckKeywordV1Schema = z
  .object({
    keywordId: coachingIdSchema,
    slideId: coachingIdSchema,
    text: z.string().trim().min(1),
    synonyms: z.array(z.string()),
    abbreviations: z.array(z.string()),
    required: z.boolean(),
  })
  .strict();

export const rehearsalAnalyzeSlideTimelineEntryV1Schema = z
  .object({
    slideId: coachingIdSchema,
    enteredSecond: z.number().finite().nonnegative(),
  })
  .strict();

export const rehearsalAnalyzeTranscriptSegmentSchema =
  rehearsalAnalyzeTranscriptSegmentV1Schema;
export const rehearsalAnalyzeDeckKeywordSchema =
  rehearsalAnalyzeDeckKeywordV1Schema;
export const rehearsalAnalyzeSlideTimelineEntrySchema =
  rehearsalAnalyzeSlideTimelineEntryV1Schema;

export const rehearsalAnalyzeRequestV1Schema = z
  .object({
    runId: coachingIdSchema,
    projectId: coachingIdSchema,
    deckId: coachingIdSchema,
    transcript: z.string(),
    language: boundedTextSchema.default("und"),
    durationSeconds: z.number().finite().nonnegative(),
    segments: z.array(rehearsalAnalyzeTranscriptSegmentV1Schema),
    deckKeywords: z.array(rehearsalAnalyzeDeckKeywordV1Schema),
    pronunciationContext: z
      .array(rehearsalPronunciationContextTermSchema)
      .max(32)
      .default([]),
    slideTimeline: z.array(rehearsalAnalyzeSlideTimelineEntryV1Schema),
    silenceAnalysis: rehearsalSilenceAnalysisSchema.default(
      legacyRehearsalSilenceAnalysis,
    ),
  })
  .strict();

export const rehearsalAnalyzeRequestSchema = z.union([
  rehearsalAnalyzeRequestV2Schema,
  rehearsalAnalyzeRequestV1Schema,
]);

export type NormalizedSttConfidence = z.infer<
  typeof normalizedSttConfidenceSchema
>;
export type RehearsalAnalyzeRequestV2 = z.infer<
  typeof rehearsalAnalyzeRequestV2Schema
>;
export type RehearsalAnalyzeResponseV2 = z.infer<
  typeof rehearsalAnalyzeResponseV2Schema
>;
export type RehearsalAnalyzeRequestV1 = z.infer<
  typeof rehearsalAnalyzeRequestV1Schema
>;
export type RehearsalAnalyzeRequest = z.infer<
  typeof rehearsalAnalyzeRequestSchema
>;
