import {
  legacyRehearsalSlideSpeakingRate,
  rehearsalSlideSpeakingRateSchema,
} from "@orbit/shared/coaching";
import {
  rehearsalEvaluationSnapshotSchema,
  rehearsalSemanticCueOutcomeSchema,
  rehearsalSemanticEvaluationSchema,
  slideTranscriptSnapshotsSchema,
  type SemanticFallbackReason,
} from "@orbit/shared/rehearsals";
import { z } from "zod";

export const rehearsalSttPayloadSchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  runId: z.string().min(1),
  deckId: z.string().min(1),
  audioFileId: z.string().min(1),
  liveTranscript: z.string().max(200_000).nullable().default(null),
  slideTranscriptSnapshots: slideTranscriptSnapshotsSchema.default([]),
});

export const audioAssetRowSchema = z.object({
  file_id: z.string().min(1),
  project_id: z.string().min(1),
  storage_key: z.string().min(1),
  mime_type: z.string().min(1),
  original_name: z.string().min(1),
  purpose: z.literal("rehearsal-audio"),
  status: z.literal("uploaded"),
});

export const deckRowSchema = z.object({
  deck_json: z.record(z.unknown()),
  version: z.number().int().nonnegative(),
});

export const deckPatchRowSchema = z.object({
  before_version: z.number().int().nonnegative(),
  after_version: z.number().int().nonnegative(),
  source: z.enum(["user", "ai", "import", "system"]).default("user"),
  operations: z.array(z.record(z.unknown())),
});

export const rehearsalRunInputRowSchema = z.object({
  run_id: z.string().min(1),
  created_at: z.union([z.date(), z.string().min(1)]),
  transcript_json_file_id: z.string().min(1).nullable(),
  transcript_text_file_id: z.string().min(1).nullable(),
  transcript_json_status: z.string().nullable(),
  transcript_text_status: z.string().nullable(),
  meta_json: z.record(z.unknown()).nullable().optional(),
  evaluation_snapshot_json: rehearsalEvaluationSnapshotSchema
    .nullable()
    .optional(),
  semantic_evaluation_mode: z.enum(["full", "delivery-only"]).default("full"),
  analysis_revision: z.number().int().nonnegative().default(0),
});

const analyzeSpeedSampleSchema = z
  .object({
    startSecond: z.number().nonnegative(),
    endSecond: z.number().nonnegative(),
    wordsPerMinute: z.number().nonnegative(),
  })
  .strict();

const analyzeFillerWordDetailSchema = z
  .object({
    word: z.string().trim().min(1),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const analyzeMissedKeywordSchema = z
  .object({
    slideId: z.string().min(1),
    keywordId: z.string().min(1),
    text: z.string().trim().min(1),
  })
  .strict();

const analyzeSlideInsightSchema = z
  .object({
    slideId: z.string().min(1),
    fillerWordCount: z.number().int().nonnegative(),
    fillerWordDetails: z.array(analyzeFillerWordDetailSchema).default([]),
    longSilenceCount: z.number().int().nonnegative().nullable(),
    speakingRate: rehearsalSlideSpeakingRateSchema.default(
      legacyRehearsalSlideSpeakingRate,
    ),
  })
  .strict();

const analyzeAiSummarySchema = z
  .object({
    headline: z.string().trim().min(1),
    paragraphs: z.array(z.string().trim().min(1)).min(1).max(3),
  })
  .strict();

export const analyzeResponseSchema = z.object({
  runId: z.string().min(1),
  wordsPerMinute: z.number().nonnegative(),
  fillerWordCount: z.number().int().nonnegative(),
  longSilenceCount: z.number().int().nonnegative().nullable(),
  keywordCoverage: z.number().min(0).max(1),
  speedSamples: z.array(analyzeSpeedSampleSchema).default([]),
  fillerWordDetails: z.array(analyzeFillerWordDetailSchema).default([]),
  missedKeywords: z.array(analyzeMissedKeywordSchema).default([]),
  slideInsights: z.array(analyzeSlideInsightSchema).default([]),
  aiSummary: analyzeAiSummarySchema.optional(),
  coaching: z.record(z.unknown()).optional(),
});

export const analyzeSemanticResponseSchema = z
  .object({
    semanticEvaluation: rehearsalSemanticEvaluationSchema,
    semanticCueOutcomes: z.array(rehearsalSemanticCueOutcomeSchema),
  })
  .strict();

export type RehearsalSttPayload = z.infer<typeof rehearsalSttPayloadSchema>;
export type AudioAssetRow = z.infer<typeof audioAssetRowSchema>;
export type SemanticAnalysisResult = z.infer<
  typeof analyzeSemanticResponseSchema
>;

export const transcriptBlockingReasons = new Set<SemanticFallbackReason>([
  "user_disabled",
  "permission_denied",
  "stt_unavailable",
  "transcript_incomplete",
  "no_transcript",
  "queue_dropped",
]);

export type RehearsalSemanticEvaluationBusinessEvent = {
  event:
    | "rehearsal.semantic_evaluation.started"
    | "rehearsal.semantic_evaluation.partial"
    | "rehearsal.semantic_evaluation.succeeded";
  projectId: string;
  deckId: string;
  deckVersion: number;
  runId: string;
  jobId: string;
  cueCount: number;
  slideCount: number;
  latencyMs?: number;
  reasons?: SemanticFallbackReason[];
};

export type RehearsalSilenceAnalysisBusinessEvent = {
  event:
    | "rehearsal.silence_analysis.completed"
    | "rehearsal.silence_analysis.unmeasured";
  projectId: string;
  runId: string;
  jobId: string;
  measurementState: "measured" | "unmeasured";
  longSilenceCount: number | null;
  totalSilenceSeconds: number | null;
  silenceRatio: number | null;
  reasonCode: string | null;
  segments: Array<{
    category: "brief" | "long";
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
  }>;
};

export type RehearsalSlideSpeakingRateBusinessEvent = {
  event:
    | "rehearsal.slide_speaking_rate.completed"
    | "rehearsal.slide_speaking_rate.unmeasured";
  projectId: string;
  runId: string;
  jobId: string;
  measuredSlideCount: number;
  slowerSlideCount: number;
  similarSlideCount: number;
  fasterSlideCount: number;
  unmeasuredSlideCount: number;
};

export function buildSlideSpeakingRateBusinessEvent(
  payload: RehearsalSttPayload,
  slideInsights: z.infer<typeof analyzeResponseSchema>["slideInsights"],
): RehearsalSlideSpeakingRateBusinessEvent {
  const counts = {
    measuredSlideCount: 0,
    slowerSlideCount: 0,
    similarSlideCount: 0,
    fasterSlideCount: 0,
    unmeasuredSlideCount: 0,
  };
  slideInsights.forEach(({ speakingRate }) => {
    if (speakingRate.measurementState === "unmeasured") {
      counts.unmeasuredSlideCount += 1;
      return;
    }

    counts.measuredSlideCount += 1;
    if (speakingRate.paceCategory === "slower") counts.slowerSlideCount += 1;
    if (speakingRate.paceCategory === "similar") counts.similarSlideCount += 1;
    if (speakingRate.paceCategory === "faster") counts.fasterSlideCount += 1;
  });

  return {
    event:
      counts.measuredSlideCount > 0
        ? "rehearsal.slide_speaking_rate.completed"
        : "rehearsal.slide_speaking_rate.unmeasured",
    projectId: payload.projectId,
    runId: payload.runId,
    jobId: payload.jobId,
    ...counts,
  };
}

export type RehearsalTranscriptArtifactBusinessEvent = {
  event:
    | "rehearsal.transcript_artifacts.started"
    | "rehearsal.transcript_artifacts.succeeded"
    | "rehearsal.transcript_artifacts.failed";
  projectId: string;
  runId: string;
  jobId: string;
  artifactCount: 2;
  errorCode?: "REHEARSAL_TRANSCRIPT_STORAGE_FAILED";
};
