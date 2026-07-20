import { z } from "zod";

import { isoDateTimeSchema } from "../common/time.schema";
import {
  allowedRehearsalAudioMimeTypes,
  assetUploadUrlResponseSchema,
} from "../files/file.schema";
import { jobSchema } from "../jobs/job.schema";
import {
  deckKeywordIdSchema,
  deckSemanticCueIdSchema,
  deckSlideIdSchema,
} from "../deck/id.schema";
import { keywordSchema } from "../deck/deck.schema";
import {
  semanticCueImportanceSchema,
  semanticCueSchema,
} from "../deck/semantic-cue.schema";
import {
  briefRefSchema,
  coachingIdSchema,
  evaluatorLensRefSchema,
} from "../coaching/coaching-common.schema";
import {
  legacyRehearsalSlideSpeakingRate,
  rehearsalSlideSpeakingRateSchema,
} from "../coaching/rehearsal-analyze.schema";
import {
  criterionResultSchema,
  measurementStateSchema,
  reportObservationSchema,
} from "../coaching/evaluation-criterion.schema";
import { rehearsalEvaluationPlanSchema } from "../coaching/evaluator-lens.schema";
import { practiceVerificationSummarySchema } from "../coaching/focused-practice.schema";
import { coachingActionSchema } from "../coaching/practice-goal.schema";
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

export const createRehearsalRunRequestSchema = z
  .object({
    deckId: z.string().min(1),
    expectedDeckVersion: z.number().int().positive().optional(),
    briefRef: briefRefSchema.optional(),
    evaluatorLensRef: evaluatorLensRefSchema.optional(),
    sourceGoalSetId: z.string().trim().min(1).max(128).nullable().optional(),
    slideSnapshots: z
      .array(
        z
          .object({
            slideId: deckSlideIdSchema,
            fileId: z.string().trim().min(1),
          })
          .strict(),
      )
      .max(200)
      .optional(),
    semanticEvaluationMode:
      rehearsalSemanticEvaluationModeSchema.default("full"),
  })
  .strict()
  .superRefine((request, context) => {
    const seenSlideIds = new Set<string>();
    request.slideSnapshots?.forEach((snapshot, index) => {
      if (seenSlideIds.has(snapshot.slideId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "slideSnapshots must contain at most one asset per slide.",
          path: ["slideSnapshots", index, "slideId"],
        });
      }
      seenSlideIds.add(snapshot.slideId);
    });

    const adaptiveFields = [
      request.briefRef,
      request.evaluatorLensRef,
      request.sourceGoalSetId,
    ];
    const suppliedCount = adaptiveFields.filter(
      (value) => value !== undefined,
    ).length;
    if (
      suppliedCount > 0 &&
      (suppliedCount < adaptiveFields.length ||
        request.expectedDeckVersion === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "adaptive rehearsal evaluation context must be supplied as a complete set.",
        path: ["briefRef"],
      });
    }
  });

export const createRehearsalRunResponseSchema = z.object({
  run: rehearsalRunSchema,
});

export const createRehearsalAudioUploadUrlRequestSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.enum(allowedRehearsalAudioMimeTypes),
  size: z.number().int().positive(),
});

export const createRehearsalAudioUploadUrlResponseSchema = z.object({
  run: rehearsalRunSchema,
  upload: assetUploadUrlResponseSchema,
});

export const rehearsalRecordingDurationSecondsSchema = z
  .number()
  .finite()
  .positive()
  .nullable()
  .default(null);

export const completeRehearsalAudioUploadUrlRequestSchema = z.object({
  fileId: z.string().min(1),
  recordingDurationSeconds: rehearsalRecordingDurationSecondsSchema,
  liveTranscript: z.string().max(200_000).nullable().default(null),
});

export const rehearsalAudioSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "sha256은 64자리 16진수 문자열이어야 합니다.");

export const beginRehearsalAudioUploadRequestSchema = z
  .object({
    codec: z.literal("flac"),
    sampleRate: z.literal(16000),
    channels: z.literal(1),
    chunkDurationMs: z.literal(30000),
  })
  .strict();

export const uploadRehearsalAudioChunkParamsSchema = z
  .object({
    runId: z.string().min(1),
    index: z.coerce.number().int().nonnegative(),
  })
  .strict();

export const completeRehearsalAudioUploadRequestSchema =
  completeRehearsalAudioUploadUrlRequestSchema;

export const completeRehearsalAudioChunkUploadRequestSchema = z
  .object({
    chunkCount: z.number().int().positive(),
    totalDurationMs: z.number().int().positive(),
    totalSizeBytes: z.number().int().positive(),
    sha256: rehearsalAudioSha256Schema,
    recordingDurationSeconds: rehearsalRecordingDurationSecondsSchema,
  })
  .strict();

export const completeRehearsalAudioUploadResponseSchema = z.object({
  run: rehearsalRunSchema,
  job: jobSchema,
});

export const createRehearsalAudioClipRequestSchema = z
  .object({
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().positive(),
  })
  .strict()
  .superRefine((request, context) => {
    const durationSeconds = request.endSeconds - request.startSeconds;
    if (durationSeconds <= 0 || durationSeconds > 60) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "audio clip duration must be greater than zero and at most 60 seconds.",
        path: ["endSeconds"],
      });
    }
  });
export const rehearsalAudioPlaybackUrlResponseSchema = z
  .object({
    playbackUrl: z.string().url(),
    expiresAt: isoDateTimeSchema,
    retentionExpiresAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((response, context) => {
    if (
      Date.parse(response.expiresAt) > Date.parse(response.retentionExpiresAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "playback URL cannot outlive audio retention.",
        path: ["expiresAt"],
      });
    }
  });

export const rehearsalRunMetaSchema = z
  .object({
    recordingDurationSeconds: rehearsalRecordingDurationSecondsSchema,
    slideTimeline: z
      .array(
        z
          .object({
            slideId: deckSlideIdSchema,
            enteredAt: isoDateTimeSchema,
          })
          .strict(),
      )
      .default([]),
    missedKeywords: z
      .array(
        z
          .object({
            slideId: deckSlideIdSchema,
            keywordId: deckKeywordIdSchema,
          })
          .strict(),
      )
      .default([]),
    adviceEvents: z
      .array(
        z
          .object({
            type: z.string().trim().min(1),
            at: isoDateTimeSchema,
          })
          .strict(),
      )
      .default([]),
    utteranceOutcomes: z.array(rehearsalUtteranceOutcomeSchema).default([]),
    semanticCueDecisions: z
      .array(rehearsalSemanticCueDecisionSchema)
      .default([]),
    semanticCapabilityEvents: z
      .array(semanticCapabilityEventSchema)
      .max(100)
      .default([]),
  })
  // Run meta stores bounded report facts only. It may include approved ad-lib
  // snippets, but must not accept full transcript, speaker notes, or raw audio.
  .strict();

export const updateRehearsalRunMetaRequestSchema = rehearsalRunMetaSchema;

export const updateRehearsalRunMetaResponseSchema = z.object({
  run: rehearsalRunSchema,
});

export const getRehearsalRunResponseSchema = z.object({
  run: rehearsalRunSchema,
});

export const cancelRehearsalRunResponseSchema = z.object({
  run: rehearsalRunSchema,
});

export const retryRehearsalSemanticEvaluationResponseSchema = z.object({
  job: jobSchema,
});

export const getRehearsalReportResponseSchema = z.object({
  run: rehearsalRunSchema,
  report: rehearsalReportSchema.nullable(),
  audioPlaybackAvailable: z.boolean().optional(),
});

export const rehearsalComparisonIssueSchema = z
  .object({
    category: z.enum(["semantic-cue", "timing", "delivery"]),
    slideId: deckSlideIdSchema,
    cueId: deckSemanticCueIdSchema.optional(),
    cueRevision: z.number().int().positive().optional(),
    label: z.string().trim().min(1).max(120),
    severity: z.enum(["high", "medium", "low"]),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();

export const rehearsalRunComparisonSchema = z
  .object({
    currentRunId: z.string().min(1),
    previousRunId: z.string().min(1).nullable(),
    silenceComparison: z
      .object({
        state: z.enum(["comparable", "unavailable"]),
        metricDefinitionVersion: z.number().int().positive().nullable(),
        currentLongSilenceCount: z.number().int().nonnegative().nullable(),
        previousLongSilenceCount: z.number().int().nonnegative().nullable(),
        longSilenceCountDelta: z.number().int().nullable(),
        currentTotalSilenceSeconds: z
          .number()
          .finite()
          .nonnegative()
          .nullable(),
        previousTotalSilenceSeconds: z
          .number()
          .finite()
          .nonnegative()
          .nullable(),
        totalSilenceSecondsDelta: z.number().finite().nullable(),
        reasonCode: z
          .enum([
            "FIRST_RUN",
            "CURRENT_UNMEASURED",
            "PREVIOUS_UNMEASURED",
            "VERSION_MISMATCH",
            "LEGACY_COMPARISON",
          ])
          .nullable(),
      })
      .strict()
      .superRefine((comparison, context) => {
        const values = [
          comparison.metricDefinitionVersion,
          comparison.currentLongSilenceCount,
          comparison.previousLongSilenceCount,
          comparison.longSilenceCountDelta,
          comparison.currentTotalSilenceSeconds,
          comparison.previousTotalSilenceSeconds,
          comparison.totalSilenceSecondsDelta,
        ];
        if (
          comparison.state === "comparable" &&
          (comparison.reasonCode !== null ||
            values.some((value) => value === null))
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "comparable silence results require both measurements.",
            path: ["state"],
          });
        }
        if (
          comparison.state === "unavailable" &&
          comparison.reasonCode === null
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "unavailable silence comparison requires a reason.",
            path: ["reasonCode"],
          });
        }
      })
      .default({
        state: "unavailable",
        metricDefinitionVersion: null,
        currentLongSilenceCount: null,
        previousLongSilenceCount: null,
        longSilenceCountDelta: null,
        currentTotalSilenceSeconds: null,
        previousTotalSilenceSeconds: null,
        totalSilenceSecondsDelta: null,
        reasonCode: "LEGACY_COMPARISON",
      }),
    improved: z.array(rehearsalComparisonIssueSchema).max(500),
    repeated: z.array(rehearsalComparisonIssueSchema).max(500),
    newIssues: z.array(rehearsalComparisonIssueSchema).max(500),
    incomparable: z.array(rehearsalComparisonIssueSchema).max(500),
    briefing: z.array(rehearsalComparisonIssueSchema).max(3),
  })
  .strict();

export const getRehearsalRunComparisonResponseSchema =
  rehearsalRunComparisonSchema;

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
export type CreateRehearsalRunRequest = z.infer<
  typeof createRehearsalRunRequestSchema
>;
export type CreateRehearsalRunResponse = z.infer<
  typeof createRehearsalRunResponseSchema
>;
export type CreateRehearsalAudioUploadUrlRequest = z.infer<
  typeof createRehearsalAudioUploadUrlRequestSchema
>;
export type CreateRehearsalAudioUploadUrlResponse = z.infer<
  typeof createRehearsalAudioUploadUrlResponseSchema
>;
export type CompleteRehearsalAudioUploadUrlRequest = z.infer<
  typeof completeRehearsalAudioUploadUrlRequestSchema
>;
export type CompleteRehearsalAudioUploadRequest = z.infer<
  typeof completeRehearsalAudioUploadRequestSchema
>;
export type CompleteRehearsalAudioChunkUploadRequest = z.infer<
  typeof completeRehearsalAudioChunkUploadRequestSchema
>;
export type CompleteRehearsalAudioUploadResponse = z.infer<
  typeof completeRehearsalAudioUploadResponseSchema
>;
export type CreateRehearsalAudioClipRequest = z.infer<
  typeof createRehearsalAudioClipRequestSchema
>;
export type RehearsalAudioPlaybackUrlResponse = z.infer<
  typeof rehearsalAudioPlaybackUrlResponseSchema
>;
export type BeginRehearsalAudioUploadRequest = z.infer<
  typeof beginRehearsalAudioUploadRequestSchema
>;
export type UploadRehearsalAudioChunkParams = z.infer<
  typeof uploadRehearsalAudioChunkParamsSchema
>;
export type RehearsalRunMeta = z.infer<typeof rehearsalRunMetaSchema>;
export type RehearsalUtteranceOutcome = z.infer<
  typeof rehearsalUtteranceOutcomeSchema
>;
export type RehearsalUtteranceOutcomeKind = z.infer<
  typeof rehearsalUtteranceOutcomeKindSchema
>;
export type UpdateRehearsalRunMetaRequest = z.infer<
  typeof updateRehearsalRunMetaRequestSchema
>;
export type UpdateRehearsalRunMetaResponse = z.infer<
  typeof updateRehearsalRunMetaResponseSchema
>;
export type GetRehearsalReportResponse = z.infer<
  typeof getRehearsalReportResponseSchema
>;
export type RetryRehearsalSemanticEvaluationResponse = z.infer<
  typeof retryRehearsalSemanticEvaluationResponseSchema
>;
export type RehearsalComparisonIssue = z.infer<
  typeof rehearsalComparisonIssueSchema
>;
export type RehearsalRunComparison = z.infer<
  typeof rehearsalRunComparisonSchema
>;
export type GetRehearsalRunComparisonResponse = z.infer<
  typeof getRehearsalRunComparisonResponseSchema
>;
export type CoachingReadiness = z.infer<typeof coachingReadinessSchema>;
export type ReportTimelineEvent = z.infer<typeof reportTimelineEventSchema>;
export type QnaAssessment = z.infer<typeof qnaAssessmentSchema>;
export type NextPracticePlan = z.infer<typeof nextPracticePlanSchema>;
export type TrendSeries = z.infer<typeof trendSeriesSchema>;
export type CoachingReportView = z.infer<typeof coachingReportViewSchema>;

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
