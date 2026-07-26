import { z } from "zod";

import { isoDateTimeSchema } from "../common/time.schema";
import { keywordSchema } from "../deck/deck.schema";
import {
  deckKeywordIdSchema,
  deckSemanticCueIdSchema,
  deckSlideIdSchema,
} from "../deck/id.schema";
import {
  semanticCueImportanceSchema,
  semanticCueSchema,
} from "../deck/semantic-cue.schema";
import {
  legacyRehearsalSlideSpeakingRate,
  rehearsalSlideSpeakingRateSchema,
} from "../coaching/rehearsal-analyze.schema";
import { rehearsalEvaluationPlanSchema } from "../coaching/evaluator-lens.schema";
import { rehearsalFocusProfileSnapshotSchema } from "../coaching/rehearsal-focus-profile.schema";
import {
  rehearsalReportAnalysisCapabilitiesSchema,
  rehearsalReportMeasurementsSchema,
  rehearsalReportSttQualityGateSchema,
  speechRateMeasurementSchema,
} from "../coaching/speech-evidence.schema";
import {
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
  rehearsalSilenceAnalysisSchema,
  rehearsalVolumeAnalysisSchema,
} from "./rehearsal-audio-analysis.schema";
import { pronunciationLexiconSnapshotSchema } from "../pronunciation/pronunciation.schema";

export const rehearsalRunStatusSchema = z.enum([
  "created",
  "uploading",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
]);

export const rehearsalSemanticEvaluationModeSchema = z.enum([
  "full",
  "delivery-only",
]);

export const rehearsalEvaluationSnapshotKeywordSchema = keywordSchema
  .pick({
    keywordId: true,
    text: true,
    synonyms: true,
    abbreviations: true,
    required: true,
  })
  .strict();

export const rehearsalEvaluationSnapshotSlideSchema = z
  .object({
    slideId: deckSlideIdSchema,
    order: z.number().int().positive(),
    title: z.string().trim().min(1).max(240),
    estimatedSeconds: z.number().int().positive(),
    thumbnailUrl: z.string().default(""),
    keywords: z.array(rehearsalEvaluationSnapshotKeywordSchema),
    semanticCues: z.array(semanticCueSchema),
  })
  .strict()
  .superRefine((slide, context) => {
    slide.semanticCues.forEach((cue, cueIndex) => {
      if (cue.slideId !== slide.slideId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "snapshot semantic cue must reference its containing slide.",
          path: ["semanticCues", cueIndex, "slideId"],
        });
      }

      if (cue.reviewStatus !== "approved" && cue.reviewStatus !== "excluded") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "snapshot semantic cue must be approved or excluded.",
          path: ["semanticCues", cueIndex, "reviewStatus"],
        });
      }
    });
  });

export const rehearsalEvaluationSnapshotSchema = z
  .object({
    deckId: z.string().trim().min(1),
    deckVersion: z.number().int().positive(),
    deckContentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .nullable()
      .default(null),
    evaluationPlan: rehearsalEvaluationPlanSchema.nullable().default(null),
    focusProfileSnapshot: rehearsalFocusProfileSnapshotSchema
      .nullable()
      .default(null),
    pronunciationLexicon: pronunciationLexiconSnapshotSchema.optional(),
    capturedAt: isoDateTimeSchema,
    slides: z.array(rehearsalEvaluationSnapshotSlideSchema),
  })
  .strict();

export const rehearsalRunErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const rehearsalRunSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  deckId: z.string().min(1),
  audioFileId: z.string().min(1).nullable(),
  jobId: z.string().min(1).nullable(),
  status: rehearsalRunStatusSchema,
  deckVersion: z.number().int().positive().nullable().default(null),
  evaluationSnapshot: rehearsalEvaluationSnapshotSchema
    .nullable()
    .default(null),
  semanticEvaluationMode: rehearsalSemanticEvaluationModeSchema.default("full"),
  analysisRevision: z.number().int().nonnegative().default(0),
  analysisFinalizedAt: isoDateTimeSchema.nullable().default(null),
  error: rehearsalRunErrorSchema.nullable(),
  rawAudioDeletedAt: isoDateTimeSchema.nullable(),
  rawAudioDeleteDeadlineAt: isoDateTimeSchema.nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

const legacyReportMeasurements = {
  duration: {
    measurementState: "unmeasured" as const,
    metricDefinitionVersion: 1,
    reasonCode: "LEGACY_MEASUREMENT_STATE_UNKNOWN" as const,
  },
  charactersPerMinute: {
    measurementState: "unmeasured" as const,
    metricDefinitionVersion: 1,
    reasonCode: "LEGACY_MEASUREMENT_STATE_UNKNOWN" as const,
  },
  wordsPerMinute: {
    measurementState: "unmeasured" as const,
    metricDefinitionVersion: 1,
    reasonCode: "LEGACY_MEASUREMENT_STATE_UNKNOWN" as const,
  },
  fillerWordCount: {
    measurementState: "unmeasured" as const,
    metricDefinitionVersion: 1,
    reasonCode: "LEGACY_MEASUREMENT_STATE_UNKNOWN" as const,
  },
  longSilenceCount: {
    measurementState: "unmeasured" as const,
    metricDefinitionVersion: 1,
    reasonCode: "LEGACY_MEASUREMENT_STATE_UNKNOWN" as const,
  },
  keywordCoverage: {
    measurementState: "unmeasured" as const,
    metricDefinitionVersion: 1,
    reasonCode: "LEGACY_MEASUREMENT_STATE_UNKNOWN" as const,
  },
};

const legacyReportSttQualityGate = {
  version: 1 as const,
  state: "unavailable" as const,
  reasonCode: "LEGACY_QUALITY_GATE_UNKNOWN" as const,
  confidence: null,
  threshold: null,
  policyId: null,
};

const legacyReportAnalysisCapabilities = {
  recordingDuration: { state: "unavailable" as const, source: "none" as const },
  providerDuration: { state: "unavailable" as const, source: "none" as const },
  segmentTimestamps: { state: "unavailable" as const, source: "none" as const },
  sttConfidence: { state: "unavailable" as const, source: "none" as const },
  sentenceBoundaries: {
    state: "unavailable" as const,
    source: "none" as const,
  },
};

export const legacyRehearsalReportMetricsDefaults = {
  charactersPerMinute: null,
  longSilenceCount: null,
  measurements: legacyReportMeasurements,
  sttQualityGate: legacyReportSttQualityGate,
  analysisCapabilities: legacyReportAnalysisCapabilities,
};

export const rehearsalReportMetricsSchema = z
  .object({
    durationSeconds: z.number().nonnegative(),
    charactersPerMinute: z
      .number()
      .finite()
      .nonnegative()
      .nullable()
      .default(null),
    wordsPerMinute: z.number().nonnegative(),
    speechRate: speechRateMeasurementSchema.optional(),
    fillerWordCount: z.number().int().nonnegative(),
    longSilenceCount: z.number().int().nonnegative().nullable().default(null),
    keywordCoverage: z.number().min(0).max(1),
    measurements: rehearsalReportMeasurementsSchema.default(
      legacyRehearsalReportMetricsDefaults.measurements,
    ),
    sttQualityGate: rehearsalReportSttQualityGateSchema.default(
      legacyRehearsalReportMetricsDefaults.sttQualityGate,
    ),
    analysisCapabilities: rehearsalReportAnalysisCapabilitiesSchema.default(
      legacyRehearsalReportMetricsDefaults.analysisCapabilities,
    ),
    keywordCoverageMeasurement: z
      .object({
        state: z.enum(["measured", "unmeasured"]),
        reason: z
          .enum([
            "no-keywords",
            "stt-unavailable",
            "transcript-incomplete",
            "low-transcription-confidence",
          ])
          .optional(),
      })
      .strict()
      .default({ state: "measured" }),
  })
  .strict()
  .superRefine((metrics, context) => {
    const cpmMeasured =
      metrics.measurements.charactersPerMinute.measurementState === "measured";
    if (cpmMeasured !== (metrics.charactersPerMinute !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "characters per minute must match its measurement state.",
        path: ["charactersPerMinute"],
      });
    }
    const silenceMeasured =
      metrics.measurements.longSilenceCount.measurementState === "measured";
    if (silenceMeasured !== (metrics.longSilenceCount !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "long silence count must match its measurement state.",
        path: ["longSilenceCount"],
      });
    }
  });

export const rehearsalReportSpeedSampleSchema = z
  .object({
    startSecond: z.number().nonnegative(),
    endSecond: z.number().nonnegative(),
    wordsPerMinute: z.number().nonnegative(),
  })
  .strict();

export const rehearsalReportFillerWordDetailSchema = z
  .object({
    word: z.string().trim().min(1),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const rehearsalReportMissedKeywordSchema = z
  .object({
    slideId: deckSlideIdSchema,
    keywordId: deckKeywordIdSchema,
    text: z.string().trim().min(1),
  })
  .strict();

export const rehearsalReportSlideTimingSchema = z
  .object({
    slideId: deckSlideIdSchema,
    targetSeconds: z.number().nonnegative(),
    actualSeconds: z.number().nonnegative(),
  })
  .strict();

export const rehearsalReportSlideInsightSchema = z
  .object({
    slideId: deckSlideIdSchema,
    fillerWordCount: z.number().int().nonnegative().nullable(),
    fillerWordDetails: z
      .array(rehearsalReportFillerWordDetailSchema)
      .optional(),
    longSilenceCount: z.number().int().nonnegative().nullable(),
    speakingRate: rehearsalSlideSpeakingRateSchema.default(
      legacyRehearsalSlideSpeakingRate,
    ),
  })
  .strict();

export const rehearsalReportQnaTopicSchema = z
  .object({
    topic: z.string().trim().min(1),
    slideId: deckSlideIdSchema.optional(),
  })
  .strict();

export const rehearsalReportQnaSummarySchema = z
  .object({
    questionCount: z.number().int().nonnegative(),
    questionSummary: z.string().default(""),
    unclearTopics: z.array(rehearsalReportQnaTopicSchema).default([]),
  })
  .strict();

export const rehearsalReportAiSummarySchema = z
  .object({
    headline: z.string().trim().min(1),
    paragraphs: z.array(z.string().trim().min(1)).min(1).max(3),
  })
  .strict();

export const rehearsalReportCoachingSchema = z.object({
  status: z.literal("succeeded"),
  summary: z.string().default(""),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  nextPracticeFocus: z.string().default(""),
  message: z.string().default(""),
});

export const rehearsalUtteranceOutcomeKindSchema = z.enum([
  "covered",
  "paraphrased",
  "ad-lib",
  "missed",
]);

export const rehearsalUtteranceOutcomeSchema = z
  .object({
    slideId: deckSlideIdSchema,
    kind: rehearsalUtteranceOutcomeKindSchema,
    sentenceId: z.string().trim().min(1).optional(),
    text: z.string().trim().min(1).max(600).optional(),
    similarity: z.number().min(-1).max(1).optional(),
    lexicalOverlap: z.number().min(0).max(1).optional(),
    at: isoDateTimeSchema.optional(),
  })
  .strict();

export const semanticCueDecisionLabelSchema = z.enum([
  "covered",
  "partial",
  "not_covered",
  "contradicted",
]);

export const semanticCueNliProviderSchema = z.enum([
  "browser-transformersjs",
  "browser-onnx",
  "mock",
]);

export const semanticCapabilitySchema = z.enum([
  "stt",
  "semantic_runtime",
  "embedding",
  "nli",
  "server_evaluation",
  "cue_freshness",
  "transcript_evidence",
]);

export const semanticCapabilityStateSchema = z.enum([
  "available",
  "degraded",
  "unavailable",
]);

export const semanticMeasurementModeSchema = z.enum(["full", "basic", "none"]);

export const semanticFallbackReasonSchema = z.enum([
  "user_disabled",
  "permission_denied",
  "stt_unavailable",
  "network_error",
  "provider_unavailable",
  "model_not_ready",
  "model_load_failed",
  "timeout",
  "runtime_error",
  "server_evaluation_failed",
  "stale_cue",
  "transcript_incomplete",
  "no_transcript",
  "insufficient_evidence",
  "slide_not_visited",
  "evaluation_not_run",
  "evaluation_snapshot_mismatch",
  "queue_dropped",
  "needs_confirmation",
]);

export const semanticCueMatchedBySchema = z.enum([
  "lexical",
  "alias",
  "embedding",
  "nli",
]);

const dedupedSemanticCueIdsSchema = z
  .array(deckSemanticCueIdSchema)
  .transform((cueIds) => [...new Set(cueIds)])
  .pipe(z.array(deckSemanticCueIdSchema).max(50));

export const semanticCapabilityEventSchema = z
  .object({
    eventId: z.string().trim().min(1).max(160),
    capability: semanticCapabilitySchema,
    fromState: semanticCapabilityStateSchema.nullable(),
    toState: semanticCapabilityStateSchema,
    reason: semanticFallbackReasonSchema.optional(),
    measurementMode: semanticMeasurementModeSchema,
    retryable: z.boolean(),
    slideId: deckSlideIdSchema.optional(),
    cueIds: dedupedSemanticCueIdsSchema,
    provider: z.string().trim().min(1).max(160).optional(),
    latencyMs: z.number().finite().nonnegative().optional(),
    at: isoDateTimeSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.toState !== "available" && event.reason === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "degraded or unavailable capability events require a reason.",
        path: ["reason"],
      });
    }

    if (event.toState === "available" && event.fromState === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "available recovery capability events require fromState.",
        path: ["fromState"],
      });
    }
  });

export const rehearsalSemanticCueDecisionSchema = z
  .object({
    slideId: deckSlideIdSchema,
    cueId: deckSemanticCueIdSchema,
    label: semanticCueDecisionLabelSchema,
    finalScore: z.number().finite().min(0).max(1),
    embeddingScore: z.number().finite().min(-1).max(1).optional(),
    lexicalScore: z.number().finite().min(0).max(1).optional(),
    conceptCoverage: z.number().finite().min(0).max(1).optional(),
    entailmentScore: z.number().finite().min(0).max(1).optional(),
    neutralScore: z.number().finite().min(0).max(1).optional(),
    contradictionScore: z.number().finite().min(0).max(1).optional(),
    premise: z.string().trim().min(1).max(600).optional(),
    hypothesis: z.string().trim().min(1).max(300).optional(),
    matchedBy: semanticCueMatchedBySchema.default("nli"),
    measurementMode: semanticMeasurementModeSchema.default("full"),
    fallbackUsed: z.boolean().default(false),
    fallbackReason: semanticFallbackReasonSchema.optional(),
    provider: semanticCueNliProviderSchema.optional(),
    modelId: z.string().trim().min(1).max(160).optional(),
    reasonCodes: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    at: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.fallbackUsed && decision.fallbackReason === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fallbackUsed decisions require fallbackReason.",
        path: ["fallbackReason"],
      });
    }
  });

export const rehearsalSemanticCueOutcomeStatusSchema = z.enum([
  "covered",
  "partial",
  "missed",
  "unmeasured",
  "excluded",
]);

export const rehearsalSemanticCueOutcomeMatchedBySchema = z.enum([
  "lexical",
  "alias",
  "embedding",
  "nli",
  "post_run_semantic",
]);

const normalizedEvidenceExcerptSchema = z
  .string()
  .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(300));

export const rehearsalSemanticCueOutcomeSchema = z
  .object({
    slideId: deckSlideIdSchema,
    cueId: deckSemanticCueIdSchema,
    cueRevision: z.number().int().positive(),
    cueMeaningSnapshot: z.string().trim().min(1).max(240),
    reportLabelSnapshot: z.string().trim().min(1).max(80),
    importance: semanticCueImportanceSchema,
    status: rehearsalSemanticCueOutcomeStatusSchema,
    confidence: z.number().finite().min(0).max(1).optional(),
    matchedBy: rehearsalSemanticCueOutcomeMatchedBySchema.optional(),
    measurementMode: semanticMeasurementModeSchema,
    fallbackUsed: z.boolean(),
    fallbackReason: semanticFallbackReasonSchema.optional(),
    unmeasuredReason: semanticFallbackReasonSchema.optional(),
    evidence: z
      .object({
        excerpt: normalizedEvidenceExcerptSchema,
        startMs: z.number().finite().nonnegative(),
        endMs: z.number().finite().nonnegative(),
      })
      .strict()
      .optional(),
    coveredConcepts: z.array(z.string().trim().min(1).max(120)).max(24),
    missingConcepts: z.array(z.string().trim().min(1).max(120)).max(24),
    feedback: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .superRefine((outcome, context) => {
    if (
      outcome.status === "unmeasured" &&
      (outcome.measurementMode !== "none" ||
        outcome.unmeasuredReason === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unmeasured outcomes require mode none and unmeasuredReason.",
        path: ["unmeasuredReason"],
      });
    }

    if (
      outcome.status === "excluded" &&
      (outcome.measurementMode !== "none" || outcome.evidence !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "excluded outcomes require mode none and cannot include evidence.",
        path: ["status"],
      });
    }

    if (outcome.status === "missed" && outcome.measurementMode !== "full") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "missed outcomes require full measurement mode.",
        path: ["measurementMode"],
      });
    }

    if (outcome.fallbackUsed && outcome.fallbackReason === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fallbackUsed outcomes require fallbackReason.",
        path: ["fallbackReason"],
      });
    }

    if (
      outcome.measurementMode === "basic" &&
      outcome.status !== "covered" &&
      outcome.status !== "partial"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "basic measurement mode only supports covered or partial outcomes.",
        path: ["status"],
      });
    }
  });

export const rehearsalSemanticEvaluationSchema = z
  .object({
    state: z.enum(["succeeded", "partial", "unavailable"]),
    measurementMode: semanticMeasurementModeSchema,
    reasons: z.array(semanticFallbackReasonSchema).max(20),
    retryable: z.boolean(),
  })
  .strict();

const rehearsalReportObjectSchema = z
  .object({
    reportId: z.string().min(1),
    runId: z.string().min(1),
    projectId: z.string().min(1),
    deckId: z.string().min(1),
    transcriptRetained: z.boolean(),
    transcript: z.string().nullable(),
    volumeAnalysis: rehearsalVolumeAnalysisSchema.default(
      legacyRehearsalVolumeAnalysis,
    ),
    silenceAnalysis: rehearsalSilenceAnalysisSchema.default(
      legacyRehearsalSilenceAnalysis,
    ),
    metrics: rehearsalReportMetricsSchema,
    speedSamples: z.array(rehearsalReportSpeedSampleSchema).default([]),
    fillerWordDetails: z
      .array(rehearsalReportFillerWordDetailSchema)
      .default([]),
    missedKeywords: z.array(rehearsalReportMissedKeywordSchema).default([]),
    utteranceOutcomes: z.array(rehearsalUtteranceOutcomeSchema).default([]),
    semanticCueDecisions: z
      .array(rehearsalSemanticCueDecisionSchema)
      .default([]),
    semanticEvaluation: rehearsalSemanticEvaluationSchema.default({
      state: "unavailable",
      measurementMode: "none",
      reasons: ["evaluation_not_run"],
      retryable: false,
    }),
    semanticCueOutcomes: z.array(rehearsalSemanticCueOutcomeSchema).default([]),
    slideTimings: z.array(rehearsalReportSlideTimingSchema).default([]),
    slideInsights: z.array(rehearsalReportSlideInsightSchema).default([]),
    qnaSummary: rehearsalReportQnaSummarySchema.default({
      questionCount: 0,
      questionSummary: "",
      unclearTopics: [],
    }),
    aiSummary: rehearsalReportAiSummarySchema.nullable().optional(),
    coaching: rehearsalReportCoachingSchema.nullable(),
    generatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((report, context) => {
    if (!report.transcriptRetained && report.transcript !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "transcript must be null when transcriptRetained is false.",
        path: ["transcript"],
      });
    }

    const silenceMeasured =
      report.silenceAnalysis.measurementState === "measured";
    if (
      report.metrics.measurements.longSilenceCount.metricDefinitionVersion !==
      report.silenceAnalysis.metricDefinitionVersion
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "long silence measurement version must match silence analysis.",
        path: [
          "metrics",
          "measurements",
          "longSilenceCount",
          "metricDefinitionVersion",
        ],
      });
    }
    if (
      silenceMeasured !==
      (report.metrics.measurements.longSilenceCount.measurementState ===
        "measured")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "silence analysis and long silence measurement state must match.",
        path: ["metrics", "measurements", "longSilenceCount"],
      });
    }
    if (
      silenceMeasured &&
      report.metrics.longSilenceCount !==
        report.silenceAnalysis.longSilenceCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "long silence count must match silence analysis.",
        path: ["metrics", "longSilenceCount"],
      });
    }
    if (
      !silenceMeasured &&
      report.slideInsights.some((insight) => insight.longSilenceCount !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "unmeasured silence analysis requires unmeasured slide silence counts.",
        path: ["slideInsights"],
      });
    }

    if (report.metrics.sttQualityGate.state === "failed") {
      const dependentMetrics = [
        "charactersPerMinute",
        "wordsPerMinute",
        "fillerWordCount",
        "keywordCoverage",
      ] as const;
      dependentMetrics.forEach((metric) => {
        const measurement = report.metrics.measurements[metric];
        if (
          measurement.measurementState !== "unmeasured" ||
          measurement.reasonCode !== "LOW_TRANSCRIPTION_CONFIDENCE"
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "failed STT quality gate requires unmeasured dependent metrics.",
            path: ["metrics", "measurements", metric],
          });
        }
      });

      if (
        report.metrics.keywordCoverageMeasurement.state !== "unmeasured" ||
        report.metrics.keywordCoverageMeasurement.reason !==
          "low-transcription-confidence"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "failed STT quality gate requires unmeasured keyword coverage.",
          path: ["metrics", "keywordCoverageMeasurement"],
        });
      }

      const dependentDetails = [
        ["speedSamples", report.speedSamples],
        ["fillerWordDetails", report.fillerWordDetails],
        ["missedKeywords", report.missedKeywords],
      ] as const;
      dependentDetails.forEach(([field, details]) => {
        if (details.length > 0) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "failed STT quality gate requires empty dependent evidence.",
            path: [field],
          });
        }
      });
      if (
        report.slideInsights.some((insight) => insight.fillerWordCount !== null)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "failed STT quality gate requires unmeasured slide fillers.",
          path: ["slideInsights"],
        });
      }
    }
  });

export const rehearsalReportSchema = z.preprocess(
  normalizeLegacyRehearsalReport,
  rehearsalReportObjectSchema,
);

function normalizeLegacyRehearsalReport(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const report = { ...(value as Record<string, unknown>) };
  delete report.pauseDetails;
  delete report.pauseV2Details;
  report.silenceAnalysis ??= legacyRehearsalSilenceAnalysis;

  if (report.metrics && typeof report.metrics === "object") {
    const metrics = { ...(report.metrics as Record<string, unknown>) };
    delete metrics.pauseCount;
    metrics.longSilenceCount ??= null;
    if (metrics.measurements && typeof metrics.measurements === "object") {
      const measurements = {
        ...(metrics.measurements as Record<string, unknown>),
      };
      delete measurements.pauseV1;
      delete measurements.pauseV2;
      measurements.longSilenceCount ??=
        legacyReportMeasurements.longSilenceCount;
      metrics.measurements = measurements;
    }
    if (
      metrics.analysisCapabilities &&
      typeof metrics.analysisCapabilities === "object"
    ) {
      const capabilities = {
        ...(metrics.analysisCapabilities as Record<string, unknown>),
      };
      delete capabilities.pauseIntentClassification;
      metrics.analysisCapabilities = capabilities;
    }
    report.metrics = metrics;
  }

  if (Array.isArray(report.slideInsights)) {
    report.slideInsights = report.slideInsights.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
      const insight = { ...(value as Record<string, unknown>) };
      delete insight.pauseCount;
      insight.longSilenceCount ??= null;
      insight.speakingRate ??= legacyRehearsalSlideSpeakingRate;
      return insight;
    });
  }

  return report;
}

export type RehearsalRunStatus = z.infer<typeof rehearsalRunStatusSchema>;
export type RehearsalSemanticEvaluationMode = z.infer<
  typeof rehearsalSemanticEvaluationModeSchema
>;
export type RehearsalEvaluationSnapshot = z.infer<
  typeof rehearsalEvaluationSnapshotSchema
>;
export type RehearsalRunError = z.infer<typeof rehearsalRunErrorSchema>;
export type RehearsalRun = z.infer<typeof rehearsalRunSchema>;
export type RehearsalReportMetrics = z.infer<
  typeof rehearsalReportMetricsSchema
>;
export type RehearsalReportAiSummary = z.infer<
  typeof rehearsalReportAiSummarySchema
>;
export type RehearsalReportCoaching = z.infer<
  typeof rehearsalReportCoachingSchema
>;
export type RehearsalReportSlideTiming = z.infer<
  typeof rehearsalReportSlideTimingSchema
>;
export type RehearsalReportQnaSummary = z.infer<
  typeof rehearsalReportQnaSummarySchema
>;
export type RehearsalReport = z.infer<typeof rehearsalReportSchema>;
export type RehearsalSemanticCueDecision = z.infer<
  typeof rehearsalSemanticCueDecisionSchema
>;
export type SemanticCapability = z.infer<typeof semanticCapabilitySchema>;
export type SemanticCapabilityState = z.infer<
  typeof semanticCapabilityStateSchema
>;
export type SemanticMeasurementMode = z.infer<
  typeof semanticMeasurementModeSchema
>;
export type SemanticFallbackReason = z.infer<
  typeof semanticFallbackReasonSchema
>;
export type SemanticCapabilityEvent = z.infer<
  typeof semanticCapabilityEventSchema
>;
export type RehearsalSemanticCueOutcome = z.infer<
  typeof rehearsalSemanticCueOutcomeSchema
>;
export type RehearsalSemanticEvaluation = z.infer<
  typeof rehearsalSemanticEvaluationSchema
>;
export type RehearsalUtteranceOutcome = z.infer<
  typeof rehearsalUtteranceOutcomeSchema
>;
export type RehearsalUtteranceOutcomeKind = z.infer<
  typeof rehearsalUtteranceOutcomeKindSchema
>;
