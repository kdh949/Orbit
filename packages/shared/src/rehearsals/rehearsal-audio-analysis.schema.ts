import { z } from "zod";

export const rehearsalVolumeAnalysisReasonCodeSchema = z.enum([
  "AUDIO_DECODE_FAILED",
  "NO_AUDIO_STREAM",
  "EMPTY_AUDIO",
  "INSUFFICIENT_ACTIVE_AUDIO",
  "ANALYSIS_FAILED",
  "LEGACY_REPORT",
]);

export const rehearsalVolumeIssueSegmentSchema = z
  .object({
    kind: z.enum(["quiet", "loud"]),
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().nonnegative(),
    durationSeconds: z.number().finite().positive(),
    meanDeviationDb: z.number().finite(),
  })
  .strict()
  .superRefine((segment, context) => {
    const expectedDuration = segment.endSeconds - segment.startSeconds;
    if (
      expectedDuration <= 0 ||
      Math.abs(segment.durationSeconds - expectedDuration) > 0.002
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "volume issue duration must match its time range.",
        path: ["durationSeconds"],
      });
    }
  });

export const rehearsalVolumeAnalysisSchema = z
  .object({
    metricDefinitionVersion: z.union([z.literal(1), z.literal(2)]),
    measurementState: z.enum(["measured", "unmeasured"]),
    reasonCode: rehearsalVolumeAnalysisReasonCodeSchema.nullable(),
    averageDbfs: z.number().finite().nullable(),
    baselineDbfs: z.number().finite().nullable(),
    variationDb: z.number().finite().nonnegative().nullable(),
    activeRatio: z.number().finite().min(0).max(1).nullable(),
    issueSegments: z.array(rehearsalVolumeIssueSegmentSchema).max(100),
  })
  .strict()
  .superRefine((analysis, context) => {
    if (analysis.metricDefinitionVersion === 2) {
      if (analysis.issueSegments.length > 5) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "volume metric version 2 allows at most five representative segments.",
          path: ["issueSegments"],
        });
      }
      analysis.issueSegments.forEach((segment, index) => {
        if (segment.durationSeconds < 2) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "volume metric version 2 requires segments of at least two seconds.",
            path: ["issueSegments", index, "durationSeconds"],
          });
        }
      });
    }
    const metricValues = [
      analysis.averageDbfs,
      analysis.baselineDbfs,
      analysis.variationDb,
      analysis.activeRatio,
    ];
    if (
      analysis.measurementState === "measured" &&
      (analysis.reasonCode !== null ||
        metricValues.some((value) => value === null))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "measured volume analysis requires all metric values.",
        path: ["measurementState"],
      });
    }
    if (
      analysis.measurementState === "unmeasured" &&
      (analysis.reasonCode === null ||
        metricValues.some((value) => value !== null) ||
        analysis.issueSegments.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unmeasured volume analysis requires a reason only.",
        path: ["measurementState"],
      });
    }
  });

export const legacyRehearsalVolumeAnalysis = {
  metricDefinitionVersion: 1 as const,
  measurementState: "unmeasured" as const,
  reasonCode: "LEGACY_REPORT" as const,
  averageDbfs: null,
  baselineDbfs: null,
  variationDb: null,
  activeRatio: null,
  issueSegments: [],
};

export const rehearsalSilenceAnalysisReasonCodeSchema = z.enum([
  "AUDIO_DECODE_FAILED",
  "NO_AUDIO_STREAM",
  "EMPTY_AUDIO",
  "INSUFFICIENT_SPEECH",
  "VAD_INITIALIZATION_FAILED",
  "ANALYSIS_FAILED",
  "LEGACY_REPORT",
]);

export const rehearsalSilenceSegmentSchema = z
  .object({
    category: z.enum(["brief", "long"]),
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().nonnegative(),
    durationSeconds: z.number().finite().min(0.25),
  })
  .strict()
  .superRefine((segment, context) => {
    const expectedDuration = segment.endSeconds - segment.startSeconds;
    if (
      expectedDuration <= 0 ||
      Math.abs(segment.durationSeconds - expectedDuration) > 0.002
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "silence duration must match its time range.",
        path: ["durationSeconds"],
      });
    }
  });

export const rehearsalSilenceAnalysisSchema = z
  .object({
    metricDefinitionVersion: z.union([z.literal(1), z.literal(2)]),
    measurementState: z.enum(["measured", "unmeasured"]),
    reasonCode: rehearsalSilenceAnalysisReasonCodeSchema.nullable(),
    detector: z.literal("silero-vad"),
    detectorVersion: z.string().min(1),
    speechThreshold: z.literal(0.5),
    minimumSilenceMs: z.literal(250),
    longSilenceMs: z.union([z.literal(1000), z.literal(5000)]),
    analysisWindowStartSeconds: z.number().finite().nonnegative().nullable(),
    analysisWindowEndSeconds: z.number().finite().nonnegative().nullable(),
    totalSilenceSeconds: z.number().finite().nonnegative().nullable(),
    silenceRatio: z.number().finite().min(0).max(1).nullable(),
    longSilenceCount: z.number().int().nonnegative().nullable(),
    detectedSegmentCount: z.number().int().nonnegative().nullable(),
    segmentsTruncated: z.boolean(),
    segments: z.array(rehearsalSilenceSegmentSchema).max(1000),
  })
  .strict()
  .superRefine((analysis, context) => {
    const expectedLongSilenceMs =
      analysis.metricDefinitionVersion === 1 ? 1000 : 5000;
    if (analysis.longSilenceMs !== expectedLongSilenceMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "silence threshold must match its metric definition version.",
        path: ["longSilenceMs"],
      });
    }
    const longSilenceSeconds = analysis.longSilenceMs / 1000;
    analysis.segments.forEach((segment, index) => {
      if (
        segment.durationSeconds >= longSilenceSeconds !==
        (segment.category === "long")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "silence category must match its duration.",
          path: ["segments", index, "category"],
        });
      }
    });
    const metricValues = [
      analysis.analysisWindowStartSeconds,
      analysis.analysisWindowEndSeconds,
      analysis.totalSilenceSeconds,
      analysis.silenceRatio,
      analysis.longSilenceCount,
      analysis.detectedSegmentCount,
    ];
    if (analysis.measurementState === "measured") {
      if (
        analysis.reasonCode !== null ||
        metricValues.some((value) => value === null)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "measured silence analysis requires all metric values.",
          path: ["measurementState"],
        });
        return;
      }
      if (
        analysis.analysisWindowEndSeconds! <=
        analysis.analysisWindowStartSeconds!
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "silence analysis window must be positive.",
          path: ["analysisWindowEndSeconds"],
        });
      }
      if (analysis.detectedSegmentCount! < analysis.segments.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "detected segment count cannot be smaller than output.",
          path: ["detectedSegmentCount"],
        });
      }
      if (
        analysis.segmentsTruncated !==
        analysis.detectedSegmentCount! > analysis.segments.length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "silence truncation flag must match segment counts.",
          path: ["segmentsTruncated"],
        });
      }
      const returnedLongCount = analysis.segments.filter(
        (segment) => segment.category === "long",
      ).length;
      if (
        !analysis.segmentsTruncated &&
        analysis.longSilenceCount !== returnedLongCount
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "long silence count must match segments.",
          path: ["longSilenceCount"],
        });
      }
      let previousStart = -Infinity;
      analysis.segments.forEach((segment, index) => {
        if (
          segment.startSeconds < analysis.analysisWindowStartSeconds! ||
          segment.endSeconds > analysis.analysisWindowEndSeconds!
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "silence segments must stay inside the analysis window.",
            path: ["segments", index],
          });
        }
        if (segment.startSeconds < previousStart) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "silence segments must be ordered by start time.",
            path: ["segments", index, "startSeconds"],
          });
        }
        previousStart = segment.startSeconds;
      });
      if (!analysis.segmentsTruncated) {
        const returnedTotal = analysis.segments.reduce(
          (total, segment) => total + segment.durationSeconds,
          0,
        );
        if (Math.abs(analysis.totalSilenceSeconds! - returnedTotal) > 0.002) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "total silence must match returned segments.",
            path: ["totalSilenceSeconds"],
          });
        }
      }
      const windowSeconds =
        analysis.analysisWindowEndSeconds! -
        analysis.analysisWindowStartSeconds!;
      const expectedRatio = analysis.totalSilenceSeconds! / windowSeconds;
      if (Math.abs(analysis.silenceRatio! - expectedRatio) > 0.0001) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "silence ratio must match total silence and analysis window.",
          path: ["silenceRatio"],
        });
      }
      return;
    }
    if (
      analysis.reasonCode === null ||
      metricValues.some((value) => value !== null) ||
      analysis.segments.length > 0 ||
      analysis.segmentsTruncated
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unmeasured silence analysis requires a reason only.",
        path: ["measurementState"],
      });
    }
  });

export const legacyRehearsalSilenceAnalysis = {
  metricDefinitionVersion: 1 as const,
  measurementState: "unmeasured" as const,
  reasonCode: "LEGACY_REPORT" as const,
  detector: "silero-vad" as const,
  detectorVersion: "unavailable",
  speechThreshold: 0.5 as const,
  minimumSilenceMs: 250 as const,
  longSilenceMs: 1000 as const,
  analysisWindowStartSeconds: null,
  analysisWindowEndSeconds: null,
  totalSilenceSeconds: null,
  silenceRatio: null,
  longSilenceCount: null,
  detectedSegmentCount: null,
  segmentsTruncated: false,
  segments: [],
};

export const audioTranscribeSegmentSchema = z
  .object({
    text: z.string(),
    startSeconds: z.number().finite().nonnegative().nullable().optional(),
    endSeconds: z.number().finite().nonnegative().nullable().optional(),
  })
  .strict();

export const audioTranscribeResponseSchema = z
  .object({
    runId: z.string().min(1),
    projectId: z.string().min(1),
    fileId: z.string().min(1),
    transcript: z.string(),
    language: z.string(),
    provider: z.string(),
    model: z.string(),
    durationSeconds: z.number().finite().nonnegative().nullable().optional(),
    segments: z.array(audioTranscribeSegmentSchema),
  })
  .strict();

export const rehearsalAudioProcessingResponseSchema =
  audioTranscribeResponseSchema.extend({
    volumeAnalysis: rehearsalVolumeAnalysisSchema,
    silenceAnalysis: rehearsalSilenceAnalysisSchema,
  });

export type RehearsalVolumeAnalysis = z.infer<
  typeof rehearsalVolumeAnalysisSchema
>;
export type RehearsalVolumeIssueSegment = z.infer<
  typeof rehearsalVolumeIssueSegmentSchema
>;
export type RehearsalSilenceAnalysis = z.infer<
  typeof rehearsalSilenceAnalysisSchema
>;
export type RehearsalSilenceSegment = z.infer<
  typeof rehearsalSilenceSegmentSchema
>;
export type AudioTranscribeResponse = z.infer<
  typeof audioTranscribeResponseSchema
>;
export type RehearsalAudioProcessingResponse = z.infer<
  typeof rehearsalAudioProcessingResponseSchema
>;
