import { z } from "zod";

import { isoDateTimeSchema } from "../common/time.schema";
import { coachingIdSchema } from "./coaching-common.schema";
import {
  analysisCapabilitySchema,
  metricMeasurementSchema,
  rehearsalAnalyzeSttQualityGateSchema,
} from "./rehearsal-analyze.schema";

export const speechRateMeasurementSchema = z
  .object({
    metricDefinitionVersion: z.literal(1),
    measurementState: z.enum(["measured", "unmeasured"]),
    charactersPerMinute: z.number().finite().nonnegative().nullable(),
    wordsPerMinute: z.number().finite().nonnegative().nullable(),
    durationSeconds: z.number().finite().positive().nullable(),
    durationSource: z.enum(["full-recording", "segment-range", "unavailable"]),
    reasonCode: z
      .enum([
        "NO_DURATION_EVIDENCE",
        "TRANSCRIPT_INCOMPLETE",
        "TRANSCRIPTION_UNAVAILABLE",
        "LEGACY_REPORT",
      ])
      .nullable(),
  })
  .strict()
  .superRefine((measurement, context) => {
    const measured = measurement.measurementState === "measured";
    if (measured !== (measurement.charactersPerMinute !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "measured speech rate requires characters per minute.",
        path: ["charactersPerMinute"],
      });
    }
    if (measured !== (measurement.durationSeconds !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "measured speech rate requires positive duration evidence.",
        path: ["durationSeconds"],
      });
    }
    if (measured === (measurement.durationSource === "unavailable")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "speech rate duration source must match measurement state.",
        path: ["durationSource"],
      });
    }
    if (measured === (measurement.reasonCode !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only unmeasured speech rate requires a reason.",
        path: ["reasonCode"],
      });
    }
  });

export const sttQualityGateSchema = z
  .object({
    provider: z.string().trim().min(1).max(80),
    language: z.string().trim().min(2).max(35),
    policyVersion: z.number().int().positive(),
    state: z.enum(["accepted", "rejected", "unavailable"]),
    confidenceCapability: z.enum(["provided", "not-provided"]),
    confidence: z.number().finite().min(0).max(1).nullable(),
    threshold: z.number().finite().min(0).max(1).nullable(),
    reasonCode: z.enum([
      "PASSED",
      "CONFIDENCE_NOT_PROVIDED",
      "LOW_TRANSCRIPTION_CONFIDENCE",
      "TRANSCRIPTION_UNAVAILABLE",
      "UNSUPPORTED_LANGUAGE",
    ]),
  })
  .strict()
  .superRefine((gate, context) => {
    const providesConfidence = gate.confidenceCapability === "provided";
    const hasConfidence = gate.confidence !== null;
    const hasThreshold = gate.threshold !== null;
    const isUnavailable = gate.state === "unavailable";
    if (
      (!isUnavailable &&
        providesConfidence &&
        (!hasConfidence || !hasThreshold)) ||
      ((!providesConfidence || isUnavailable) &&
        (hasConfidence || hasThreshold))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "confidence and threshold must only be present for an available provider result.",
        path: ["confidence"],
      });
    }
    const validStateReason =
      (gate.state === "accepted" &&
        ((providesConfidence && gate.reasonCode === "PASSED") ||
          (!providesConfidence &&
            gate.reasonCode === "CONFIDENCE_NOT_PROVIDED"))) ||
      (gate.state === "rejected" &&
        providesConfidence &&
        gate.reasonCode === "LOW_TRANSCRIPTION_CONFIDENCE") ||
      (gate.state === "unavailable" &&
        (gate.reasonCode === "TRANSCRIPTION_UNAVAILABLE" ||
          gate.reasonCode === "UNSUPPORTED_LANGUAGE"));
    if (!validStateReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "STT quality gate state and reason must agree.",
        path: ["reasonCode"],
      });
    }
    if (
      !isUnavailable &&
      providesConfidence &&
      gate.confidence !== null &&
      gate.threshold !== null
    ) {
      const passesThreshold = gate.confidence >= gate.threshold;
      if ((gate.state === "accepted") !== passesThreshold) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "STT quality gate state must match the confidence threshold.",
          path: ["state"],
        });
      }
    }
  });

const legacyReportSttQualityGateSchema = z
  .object({
    version: z.literal(1),
    state: z.literal("unavailable"),
    reasonCode: z.literal("LEGACY_QUALITY_GATE_UNKNOWN"),
    confidence: z.null(),
    threshold: z.null(),
    policyId: z.null(),
  })
  .strict();

export const rehearsalReportSttQualityGateSchema = z.union([
  rehearsalAnalyzeSttQualityGateSchema,
  legacyReportSttQualityGateSchema,
]);

export const rehearsalReportMeasurementsSchema = z
  .object({
    duration: metricMeasurementSchema,
    charactersPerMinute: metricMeasurementSchema,
    wordsPerMinute: metricMeasurementSchema,
    fillerWordCount: metricMeasurementSchema,
    longSilenceCount: metricMeasurementSchema,
    keywordCoverage: metricMeasurementSchema,
  })
  .strict()
  .superRefine((measurements, context) => {
    const canonicalVersions = [
      ["duration", 1],
      ["charactersPerMinute", 1],
      ["wordsPerMinute", 1],
      ["fillerWordCount", 1],
      ["keywordCoverage", 1],
    ] as const;

    canonicalVersions.forEach(([metric, version]) => {
      if (measurements[metric].metricDefinitionVersion !== version) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "report measurement must use its canonical metric version.",
          path: [metric, "metricDefinitionVersion"],
        });
      }
    });

    if (
      ![1, 2].includes(
        measurements.longSilenceCount.metricDefinitionVersion,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "long silence measurement must use a supported metric version.",
        path: ["longSilenceCount", "metricDefinitionVersion"],
      });
    }
  });

export const rehearsalReportAnalysisCapabilitiesSchema = z
  .object({
    recordingDuration: analysisCapabilitySchema,
    providerDuration: analysisCapabilitySchema,
    segmentTimestamps: analysisCapabilitySchema,
    sttConfidence: analysisCapabilitySchema,
    sentenceBoundaries: analysisCapabilitySchema,
  })
  .strict();

export const evidenceClipRefSchema = z
  .object({
    clipId: coachingIdSchema,
    observationId: coachingIdSchema,
  })
  .strict();

export const evidenceClipSchema = z
  .object({
    clipId: coachingIdSchema,
    projectId: coachingIdSchema,
    runId: coachingIdSchema,
    observationId: coachingIdSchema,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive().max(12_000),
    accessPolicy: z.literal("owner-only"),
    retentionPolicyVersion: z.literal(1),
    retentionDays: z.literal(7),
    state: z.enum(["available", "failed", "expired", "deleted"]),
    expiresAt: isoDateTimeSchema.nullable(),
    deletedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((clip, context) => {
    if (
      clip.endMs < clip.startMs ||
      clip.durationMs !== clip.endMs - clip.startMs
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "evidence clip duration must match its time range.",
        path: ["durationMs"],
      });
    }
    if (
      (clip.state === "available" || clip.state === "expired") &&
      clip.expiresAt === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "available and expired evidence clips require an expiry.",
        path: ["expiresAt"],
      });
    }
    if ((clip.state === "deleted") !== (clip.deletedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only deleted evidence clips require a deletion timestamp.",
        path: ["deletedAt"],
      });
    }
    if (
      clip.expiresAt !== null &&
      Date.parse(clip.expiresAt) - Date.parse(clip.createdAt) !==
        clip.retentionDays * 24 * 60 * 60 * 1_000
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "P0 evidence clips use the fixed seven-day retention policy.",
        path: ["expiresAt"],
      });
    }
  });

export const evidenceClipPlaybackResponseSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("available"),
        clipId: coachingIdSchema,
        signedUrl: z.string().url(),
        expiresAt: isoDateTimeSchema,
      })
      .strict(),
    z
      .object({
        state: z.enum(["failed", "expired", "deleted", "not-found"]),
        clipId: coachingIdSchema,
      })
      .strict(),
  ],
);

export type SpeechRateMeasurement = z.infer<typeof speechRateMeasurementSchema>;
export type SttQualityGate = z.infer<typeof sttQualityGateSchema>;
export type RehearsalReportSttQualityGate = z.infer<
  typeof rehearsalReportSttQualityGateSchema
>;
export type RehearsalReportMeasurements = z.infer<
  typeof rehearsalReportMeasurementsSchema
>;
export type RehearsalReportAnalysisCapabilities = z.infer<
  typeof rehearsalReportAnalysisCapabilitiesSchema
>;
export type EvidenceClip = z.infer<typeof evidenceClipSchema>;
export type EvidenceClipPlaybackResponse = z.infer<
  typeof evidenceClipPlaybackResponseSchema
>;
