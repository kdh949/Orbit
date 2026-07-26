import { z } from "zod";

import {
  briefRefSchema,
  evaluatorLensRefSchema,
} from "../coaching/coaching-common.schema";
import { isoDateTimeSchema } from "../common/time.schema";
import {
  deckKeywordIdSchema,
  deckSemanticCueIdSchema,
  deckSlideIdSchema,
} from "../deck/id.schema";
import {
  allowedRehearsalAudioMimeTypes,
  assetUploadUrlResponseSchema,
} from "../files/file.schema";
import { jobSchema } from "../jobs/job.schema";
import { slideTranscriptSnapshotsSchema } from "./slide-transcript-snapshot.schema";
import {
  rehearsalReportSchema,
  rehearsalRunSchema,
  rehearsalSemanticCueDecisionSchema,
  rehearsalSemanticEvaluationModeSchema,
  rehearsalUtteranceOutcomeSchema,
  semanticCapabilityEventSchema,
} from "./rehearsal-core-contracts";

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
  slideTranscriptSnapshots: slideTranscriptSnapshotsSchema.default([]),
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
  transcriptDownloadAvailable: z.boolean().optional(),
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
