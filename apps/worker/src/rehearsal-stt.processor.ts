import type { StoragePort } from "@orbit/storage";
import {
  type Deck,
  deckPatchSchema,
  deckSchema,
  rehearsalAudioProcessingResponseSchema,
  rehearsalEvaluationSnapshotSchema,
  rehearsalAnalyzeRequestSchema,
  legacyRehearsalSlideSpeakingRate,
  rehearsalSlideSpeakingRateSchema,
  rehearsalReportSchema,
  rehearsalRunMetaSchema,
  rehearsalSemanticCueOutcomeSchema,
  rehearsalSemanticEvaluationSchema,
  type Job,
  type RehearsalAudioProcessingResponse,
  type RehearsalEvaluationSnapshot,
  type RehearsalReport,
  type RehearsalReportSlideTiming,
  type RehearsalRunMeta,
  type RehearsalSemanticEvidenceSegment,
  type RehearsalSemanticCueOutcome,
  type SemanticFallbackReason,
} from "@orbit/shared";
import type { DataSource } from "typeorm";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { RehearsalTranscriptCache } from "./rehearsal-transcript-cache";
import { storeRehearsalTranscriptArtifacts } from "./rehearsal-transcript-artifacts";
import {
  derivePracticeGoalSet,
  loadPracticeGoalRankingContext,
  publishPracticeGoalSet,
} from "./practice-goal-derivation";

const rehearsalSttPayloadSchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  runId: z.string().min(1),
  deckId: z.string().min(1),
  audioFileId: z.string().min(1),
});

const audioAssetRowSchema = z.object({
  file_id: z.string().min(1),
  project_id: z.string().min(1),
  storage_key: z.string().min(1),
  mime_type: z.string().min(1),
  original_name: z.string().min(1),
  purpose: z.literal("rehearsal-audio"),
  status: z.literal("uploaded"),
});

const deckRowSchema = z.object({
  deck_json: z.record(z.unknown()),
  version: z.number().int().nonnegative(),
});

const deckPatchRowSchema = z.object({
  before_version: z.number().int().nonnegative(),
  after_version: z.number().int().nonnegative(),
  source: z.enum(["user", "ai", "import", "system"]).default("user"),
  operations: z.array(z.record(z.unknown())),
});

const rehearsalRunInputRowSchema = z.object({
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

const analyzeMissedKeywordSchema = z
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

const analyzeResponseSchema = z.object({
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

const analyzeSemanticResponseSchema = z
  .object({
    semanticEvaluation: rehearsalSemanticEvaluationSchema,
    semanticCueOutcomes: z.array(rehearsalSemanticCueOutcomeSchema),
  })
  .strict();

type RehearsalSttPayload = z.infer<typeof rehearsalSttPayloadSchema>;
type AudioAssetRow = z.infer<typeof audioAssetRowSchema>;
export type SemanticAnalysisResult = z.infer<
  typeof analyzeSemanticResponseSchema
>;

const transcriptBlockingReasons = new Set<SemanticFallbackReason>([
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

function buildSlideSpeakingRateBusinessEvent(
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
export async function processRehearsalSttJob(
  dataSource: DataSource,
  storage: Pick<
    StoragePort,
    "getSignedReadUrl" | "headObject" | "putObject" | "removeObject"
  >,
  pythonWorkerUrl: string,
  rawPayload: unknown,
  transcriptCache?: RehearsalTranscriptCache,
  onSemanticEvaluationEvent?: (
    event: RehearsalSemanticEvaluationBusinessEvent,
  ) => void,
  onSilenceAnalysisEvent?: (
    event: RehearsalSilenceAnalysisBusinessEvent,
  ) => void,
  onSlideSpeakingRateEvent?: (
    event: RehearsalSlideSpeakingRateBusinessEvent,
  ) => void,
  onTranscriptArtifactEvent?: (
    event: RehearsalTranscriptArtifactBusinessEvent,
  ) => void,
): Promise<Job> {
  const payloadResult = rehearsalSttPayloadSchema.safeParse(rawPayload);
  if (!payloadResult.success) {
    const jobId =
      rawPayload &&
      typeof rawPayload === "object" &&
      "jobId" in rawPayload &&
      typeof rawPayload.jobId === "string"
        ? rawPayload.jobId
        : "";

    if (!jobId) {
      throw new Error(payloadResult.error.message);
    }

    return failJobOnly(
      dataSource,
      jobId,
      0,
      "REHEARSAL_STT_PAYLOAD_INVALID",
      payloadResult.error.message,
    );
  }

  const payload = payloadResult.data;
  await updateJob(dataSource, payload.jobId, {
    status: "running",
    progress: 10,
    message: "입력 데이터 확인 중",
    result: null,
    error: null,
  });

  let runInput: z.infer<typeof rehearsalRunInputRowSchema>;
  try {
    runInput = await updateRun(dataSource, payload, {
      status: "processing",
      error: null,
      jobId: payload.jobId,
    });
  } catch (error) {
    return failJobOnly(
      dataSource,
      payload.jobId,
      10,
      "REHEARSAL_RUN_UNAVAILABLE",
      error instanceof Error ? error.message : "Rehearsal run unavailable.",
    );
  }

  let asset: AudioAssetRow;
  let deckContext: DeckAnalysisContext;
  let runMeta: RehearsalRunMeta;
  let storageUrl: string;
  try {
    asset = await loadAudioAsset(dataSource, payload);
    deckContext = runInput.evaluation_snapshot_json
      ? buildSnapshotAnalysisContext(
          runInput.evaluation_snapshot_json,
          runInput.semantic_evaluation_mode,
        )
      : await loadDeckAnalysisContext(
          dataSource,
          payload.projectId,
          payload.deckId,
          runInput.semantic_evaluation_mode,
        );
    runMeta = rehearsalRunMetaSchema.parse(runInput.meta_json ?? {});
    storageUrl = await storage.getSignedReadUrl(asset.storage_key);
  } catch (error) {
    return failJobAndRun(
      dataSource,
      payload,
      10,
      "REHEARSAL_STT_INPUT_UNAVAILABLE",
      error instanceof Error
        ? error.message
        : "Rehearsal STT input unavailable.",
    );
  }

  await progressJob(dataSource, payload.jobId, 30, "음성 변환 중");

  let audioProcessingResponse: RehearsalAudioProcessingResponse;
  try {
    const response = await fetch(
      workerUrl(pythonWorkerUrl, "/audio/transcribe"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: payload.runId,
          projectId: payload.projectId,
          pronunciationContext: deckContext.evaluationSnapshot
            ? buildTranscriptionPronunciationContext(
                deckContext.evaluationSnapshot,
              )
            : [],
          audio: {
            fileId: payload.audioFileId,
            storageUrl,
            mimeType: asset.mime_type,
          },
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );

    if (!response.ok) {
      return failAndScheduleRawAudioDeletion(
        dataSource,
        asset,
        payload,
        30,
        "PYTHON_WORKER_STT_FAILED",
        (await response.text()) || "Python worker STT failed.",
      );
    }

    audioProcessingResponse = rehearsalAudioProcessingResponseSchema.parse(
      await response.json(),
    );
    const silenceAnalysis = audioProcessingResponse.silenceAnalysis;
    onSilenceAnalysisEvent?.({
      event:
        silenceAnalysis.measurementState === "measured"
          ? "rehearsal.silence_analysis.completed"
          : "rehearsal.silence_analysis.unmeasured",
      projectId: payload.projectId,
      runId: payload.runId,
      jobId: payload.jobId,
      measurementState: silenceAnalysis.measurementState,
      longSilenceCount: silenceAnalysis.longSilenceCount,
      totalSilenceSeconds: silenceAnalysis.totalSilenceSeconds,
      silenceRatio: silenceAnalysis.silenceRatio,
      reasonCode: silenceAnalysis.reasonCode,
      segments: silenceAnalysis.segments,
    });
  } catch (error) {
    return failAndScheduleRawAudioDeletion(
      dataSource,
      asset,
      payload,
      30,
      "PYTHON_WORKER_STT_UNAVAILABLE",
      error instanceof Error ? error.message : "Python worker STT unavailable.",
    );
  }

  await progressJob(dataSource, payload.jobId, 65, "발화 지표 분석 중");

  emitTranscriptArtifactEvent(onTranscriptArtifactEvent, {
    event: "rehearsal.transcript_artifacts.started",
    projectId: payload.projectId,
    runId: payload.runId,
    jobId: payload.jobId,
    artifactCount: 2,
  });
  try {
    await storeRehearsalTranscriptArtifacts(dataSource, storage, {
      projectId: payload.projectId,
      runId: payload.runId,
      runCreatedAt: runInput.created_at,
      transcriptJsonFileId: runInput.transcript_json_file_id,
      transcriptTextFileId: runInput.transcript_text_file_id,
      transcriptJsonStatus: runInput.transcript_json_status,
      transcriptTextStatus: runInput.transcript_text_status,
      transcription: audioProcessingResponse,
    });
  } catch {
    emitTranscriptArtifactEvent(onTranscriptArtifactEvent, {
      event: "rehearsal.transcript_artifacts.failed",
      projectId: payload.projectId,
      runId: payload.runId,
      jobId: payload.jobId,
      artifactCount: 2,
      errorCode: "REHEARSAL_TRANSCRIPT_STORAGE_FAILED",
    });
    return failJobAndRun(
      dataSource,
      payload,
      65,
      "REHEARSAL_TRANSCRIPT_STORAGE_FAILED",
      "Rehearsal transcript artifact storage failed.",
    );
  }
  emitTranscriptArtifactEvent(onTranscriptArtifactEvent, {
    event: "rehearsal.transcript_artifacts.succeeded",
    projectId: payload.projectId,
    runId: payload.runId,
    jobId: payload.jobId,
    artifactCount: 2,
  });

  let analysis: z.infer<typeof analyzeResponseSchema>;
  try {
    analysis = await analyzeTranscript(
      pythonWorkerUrl,
      payload,
      deckContext,
      audioProcessingResponse,
      runMeta,
    );
    onSlideSpeakingRateEvent?.(
      buildSlideSpeakingRateBusinessEvent(payload, analysis.slideInsights),
    );
  } catch (error) {
    return failAndScheduleRawAudioDeletion(
      dataSource,
      asset,
      payload,
      65,
      "PYTHON_WORKER_ANALYZE_FAILED",
      error instanceof Error ? error.message : "Python worker analysis failed.",
    );
  }

  const semanticResult = await analyzeSemanticCuesForReport(
    pythonWorkerUrl,
    payload,
    deckContext,
    audioProcessingResponse,
    runMeta,
    onSemanticEvaluationEvent,
  );

  await progressJob(dataSource, payload.jobId, 85, "리포트 생성 중");

  let report: RehearsalReport;
  try {
    report = buildRehearsalReport(
      payload,
      audioProcessingResponse,
      analysis,
      new Date().toISOString(),
      deckContext,
      runMeta,
      semanticResult,
    );
  } catch (error) {
    return failAndScheduleRawAudioDeletion(
      dataSource,
      asset,
      payload,
      85,
      "REHEARSAL_REPORT_INVALID",
      error instanceof Error
        ? error.message
        : "Rehearsal report validation failed.",
    );
  }

  try {
    await transcriptCache?.setSemanticEvidence(payload.runId, {
      segments: buildSemanticSegments(audioProcessingResponse.segments),
    });
  } catch {
    // 의미 평가 근거 캐시 실패는 delivery 리포트 생성을 막지 않는다.
  }

  const completedRun = await updateRun(dataSource, payload, {
    status: "succeeded",
    error: null,
    rehearsalReport: report,
    transcriptRetained: report.transcriptRetained,
  });

  if (completedRun.evaluation_snapshot_json) {
    const rankingContext = await loadPracticeGoalRankingContext({
      executor: dataSource,
      projectId: payload.projectId,
      sourceFullRunId: payload.runId,
      snapshot: completedRun.evaluation_snapshot_json,
    });
    const goalSet = derivePracticeGoalSet({
      projectId: payload.projectId,
      sourceFullRunId: payload.runId,
      sourceAnalysisRevision: completedRun.analysis_revision,
      snapshot: completedRun.evaluation_snapshot_json,
      report,
      rankingContext,
    });
    if (goalSet) {
      await publishPracticeGoalSet(dataSource, goalSet, {
        evaluatedFullRunId: payload.runId,
        snapshot: completedRun.evaluation_snapshot_json,
        report,
      });
    }
  }

  try {
    await upsertRehearsalSummary(
      dataSource,
      pythonWorkerUrl,
      payload.projectId,
    );
  } catch {
    // summary 업데이트 실패는 리포트 저장을 막지 않는다.
  }

  const completedJob = await updateJob(dataSource, payload.jobId, {
    status: "succeeded",
    progress: 100,
    message: "리포트 생성 완료",
    result: buildReportGenerationRecord(
      payload,
      audioProcessingResponse,
      report,
      null,
    ),
    error: null,
  });

  // Temporary: retain successful rehearsal recordings for follow-up audio analysis.
  // await scheduleRawAudioDeletion(dataSource, asset);
  return completedJob;
}

export function buildTranscriptionPronunciationContext(
  snapshot: Pick<RehearsalEvaluationSnapshot, "pronunciationLexicon">,
  limit: number = 32,
) {
  const context: Array<{ source: string; aliases: string[] }> = [];
  const boundedLimit = Math.max(0, Math.min(limit, 32));

  for (const entry of snapshot.pronunciationLexicon?.entries ?? []) {
    if (context.length >= boundedLimit) {
      break;
    }
    if (entry.status !== "active") {
      continue;
    }
    const aliases = entry.aliases
      .filter((alias) => alias.enabled && alias.confidence >= 0.8)
      .slice(0, 2)
      .map((alias) => alias.text);
    if (aliases.length === 0) {
      continue;
    }
    context.push({ source: entry.sourceText, aliases });
  }

  return context;
}

function buildRehearsalReport(
  payload: RehearsalSttPayload,
  transcription: RehearsalAudioProcessingResponse,
  analysis: z.infer<typeof analyzeResponseSchema>,
  generatedAt: string,
  deckContext: DeckAnalysisContext,
  runMeta: RehearsalRunMeta,
  semanticResult: SemanticAnalysisResult,
): RehearsalReport {
  const requiredKeywordCount = deckContext.deckKeywords.filter(
    (keyword) => keyword.required,
  ).length;
  const hasTimestampedTranscriptSegments = transcription.segments.some(
    (segment) =>
      segment.startSeconds != null &&
      segment.endSeconds != null &&
      segment.endSeconds >= segment.startSeconds,
  );
  const canMeasureRequiredKeywords =
    requiredKeywordCount > 0 &&
    hasTimestampedTranscriptSegments &&
    buildAnalyzeSlideTimeline(deckContext, runMeta).length > 0;

  return rehearsalReportSchema.parse({
    reportId: `report_${payload.runId}`,
    runId: payload.runId,
    projectId: payload.projectId,
    deckId: payload.deckId,
    transcriptRetained: true,
    transcript: null,
    volumeAnalysis: transcription.volumeAnalysis,
    silenceAnalysis: transcription.silenceAnalysis,
    metrics: {
      durationSeconds: transcription.durationSeconds ?? 0,
      wordsPerMinute: analysis.wordsPerMinute,
      fillerWordCount: analysis.fillerWordCount,
      longSilenceCount: transcription.silenceAnalysis.longSilenceCount,
      keywordCoverage: analysis.keywordCoverage,
      measurements: buildReportMeasurements(
        transcription,
        requiredKeywordCount > 0,
      ),
      keywordCoverageMeasurement:
        requiredKeywordCount === 0
          ? { state: "unmeasured", reason: "no-keywords" }
          : canMeasureRequiredKeywords
            ? { state: "measured" }
            : {
                state: "unmeasured",
                reason: "transcript-incomplete",
              },
    },
    speedSamples: analysis.speedSamples,
    fillerWordDetails: analysis.fillerWordDetails,
    missedKeywords: buildReportMissedKeywords(analysis.missedKeywords),
    utteranceOutcomes: runMeta.utteranceOutcomes,
    semanticCueDecisions: runMeta.semanticCueDecisions,
    semanticEvaluation: semanticResult.semanticEvaluation,
    semanticCueOutcomes: semanticResult.semanticCueOutcomes,
    slideTimings: buildSlideTimings(deckContext, runMeta),
    slideInsights: analysis.slideInsights,
    qnaSummary: {
      questionCount: 0,
      questionSummary: "",
      unclearTopics: [],
    },
    aiSummary: analysis.aiSummary ?? null,
    coaching: analysis.coaching ?? null,
    generatedAt,
  });
}

function buildReportGenerationRecord(
  payload: RehearsalSttPayload,
  transcription: RehearsalAudioProcessingResponse,
  report: RehearsalReport,
  rawAudioDeletedAt: string | null,
) {
  return {
    runId: payload.runId,
    projectId: payload.projectId,
    deckId: payload.deckId,
    audioFileId: payload.audioFileId,
    transcriptRetained: report.transcriptRetained,
    language: transcription.language,
    provider: transcription.provider,
    model: transcription.model,
    durationSeconds: report.metrics.durationSeconds,
    segmentCount: transcription.segments.length,
    metrics: report.metrics,
    coaching: report.coaching,
    report,
    rawAudioDeletedAt,
  };
}

async function analyzeTranscript(
  pythonWorkerUrl: string,
  payload: RehearsalSttPayload,
  deckContext: DeckAnalysisContext,
  transcription: RehearsalAudioProcessingResponse,
  runMeta: RehearsalRunMeta,
) {
  const request = rehearsalAnalyzeRequestSchema.parse({
    runId: payload.runId,
    projectId: payload.projectId,
    deckId: payload.deckId,
    transcript: transcription.transcript,
    language: transcription.language,
    durationSeconds: transcription.durationSeconds ?? 0,
    segments: transcription.segments,
    deckKeywords: deckContext.deckKeywords
      .filter((keyword) => keyword.required)
      .map(
        ({ keywordId, slideId, text, synonyms, abbreviations, required }) => ({
          keywordId,
          slideId,
          text,
          synonyms,
          abbreviations,
          required,
        }),
      ),
    pronunciationContext: deckContext.evaluationSnapshot
      ? buildTranscriptionPronunciationContext(deckContext.evaluationSnapshot)
      : [],
    slideTimeline: buildAnalyzeSlideTimeline(deckContext, runMeta),
    silenceAnalysis: transcription.silenceAnalysis,
  });
  const response = await fetch(
    workerUrl(pythonWorkerUrl, "/rehearsal/analyze"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (!response.ok) {
    throw new Error(
      (await response.text()) || "Python worker analysis failed.",
    );
  }

  const analysis = analyzeResponseSchema.parse(await response.json());
  if (
    analysis.longSilenceCount !== transcription.silenceAnalysis.longSilenceCount
  ) {
    throw new Error(
      "Python worker long silence count does not match silence analysis.",
    );
  }
  return analysis;
}

function buildReportMeasurements(
  transcription: RehearsalAudioProcessingResponse,
  hasKeywords: boolean,
) {
  const measured = {
    measurementState: "measured" as const,
    metricDefinitionVersion: 1,
    reasonCode: null,
  };
  const silenceMeasured =
    transcription.silenceAnalysis.measurementState === "measured";
  return {
    duration:
      (transcription.durationSeconds ?? 0) > 0
        ? measured
        : {
            measurementState: "unmeasured" as const,
            metricDefinitionVersion: 1,
            reasonCode: "NO_DURATION_EVIDENCE" as const,
          },
    charactersPerMinute: {
      measurementState: "unmeasured" as const,
      metricDefinitionVersion: 1,
      reasonCode: "UNSUPPORTED_CPM_LANGUAGE" as const,
    },
    wordsPerMinute: measured,
    fillerWordCount: measured,
    longSilenceCount: silenceMeasured
      ? {
          ...measured,
          metricDefinitionVersion:
            transcription.silenceAnalysis.metricDefinitionVersion,
        }
      : {
          measurementState: "unmeasured" as const,
          metricDefinitionVersion:
            transcription.silenceAnalysis.metricDefinitionVersion,
          reasonCode: "AUDIO_ANALYSIS_UNAVAILABLE" as const,
        },
    keywordCoverage: hasKeywords
      ? measured
      : {
          measurementState: "unmeasured" as const,
          metricDefinitionVersion: 1,
          reasonCode: "NO_KEYWORDS" as const,
        },
  };
}

async function analyzeSemanticCuesForReport(
  pythonWorkerUrl: string,
  payload: RehearsalSttPayload,
  deckContext: DeckAnalysisContext,
  transcription: RehearsalAudioProcessingResponse,
  runMeta: RehearsalRunMeta,
  onEvent?: (event: RehearsalSemanticEvaluationBusinessEvent) => void,
): Promise<SemanticAnalysisResult> {
  const snapshot = deckContext.evaluationSnapshot;
  if (deckContext.semanticEvaluationMode === "delivery-only") {
    return unavailableSemanticResult("evaluation_snapshot_mismatch");
  }
  if (!snapshot) {
    return unavailableSemanticResult("evaluation_not_run");
  }

  const cueCount = snapshot.slides.reduce(
    (count, slide) => count + slide.semanticCues.length,
    0,
  );
  const baseEvent = {
    projectId: payload.projectId,
    deckId: snapshot.deckId,
    deckVersion: snapshot.deckVersion,
    runId: payload.runId,
    jobId: payload.jobId,
    cueCount,
    slideCount: snapshot.slides.length,
  };
  emitSemanticEvaluationEvent(onEvent, {
    event: "rehearsal.semantic_evaluation.started",
    ...baseEvent,
  });

  if (cueCount === 0) {
    const emptyResult: SemanticAnalysisResult = {
      semanticEvaluation: {
        state: "succeeded",
        measurementMode: "none",
        reasons: [],
        retryable: false,
      },
      semanticCueOutcomes: [],
    };
    emitSemanticEvaluationEvent(onEvent, {
      event: "rehearsal.semantic_evaluation.succeeded",
      ...baseEvent,
      latencyMs: 0,
      reasons: [],
    });
    return emptyResult;
  }

  const semanticRequest = buildSemanticAnalysisRequest(
    payload.runId,
    snapshot,
    buildSemanticSegments(transcription.segments),
    runMeta,
  );
  const startedAt = Date.now();
  try {
    const result = await requestSemanticAnalysis(
      pythonWorkerUrl,
      snapshot,
      semanticRequest,
    );
    const event =
      result.semanticEvaluation.state === "succeeded"
        ? "rehearsal.semantic_evaluation.succeeded"
        : "rehearsal.semantic_evaluation.partial";
    emitSemanticEvaluationEvent(onEvent, {
      event,
      ...baseEvent,
      latencyMs: Date.now() - startedAt,
      reasons: result.semanticEvaluation.reasons,
    });
    return result;
  } catch (error) {
    const reason = semanticEndpointFailureReason(error);
    const result = buildSemanticFailureResult(
      snapshot,
      semanticRequest,
      reason,
    );
    emitSemanticEvaluationEvent(onEvent, {
      event: "rehearsal.semantic_evaluation.partial",
      ...baseEvent,
      latencyMs: Date.now() - startedAt,
      reasons: result.semanticEvaluation.reasons,
    });
    return result;
  }
}

class SemanticEndpointError extends Error {
  constructor(readonly reason: SemanticFallbackReason) {
    super(reason);
  }
}

export function semanticEndpointFailureReason(
  error: unknown,
): SemanticFallbackReason {
  if (error instanceof SemanticEndpointError) {
    return error.reason;
  }
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "timeout";
  }
  return "server_evaluation_failed";
}

function unavailableSemanticResult(
  reason: "evaluation_not_run" | "evaluation_snapshot_mismatch",
): SemanticAnalysisResult {
  return {
    semanticEvaluation: {
      state: "unavailable",
      measurementMode: "none",
      reasons: [reason],
      retryable: false,
    },
    semanticCueOutcomes: [],
  };
}

export function buildSemanticAnalysisRequest(
  runId: string,
  snapshot: RehearsalEvaluationSnapshot,
  segments: RehearsalSemanticEvidenceSegment[],
  runMeta: RehearsalRunMeta,
) {
  return {
    runId,
    evaluationSnapshot: snapshot,
    segments,
    slideTimeline: buildSemanticSlideTimeline(snapshot, runMeta),
    provisionalDecisions: runMeta.semanticCueDecisions,
    capabilityEvents: runMeta.semanticCapabilityEvents,
  };
}

export async function requestSemanticAnalysis(
  pythonWorkerUrl: string,
  snapshot: RehearsalEvaluationSnapshot,
  request: ReturnType<typeof buildSemanticAnalysisRequest>,
): Promise<SemanticAnalysisResult> {
  const response = await fetch(
    workerUrl(pythonWorkerUrl, "/rehearsal/analyze-semantic-cues"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) {
    throw new SemanticEndpointError(
      response.status === 504 ? "timeout" : "server_evaluation_failed",
    );
  }

  const result = analyzeSemanticResponseSchema.parse(await response.json());
  validateSemanticOutcomeCoverage(snapshot, result.semanticCueOutcomes);
  return result;
}

function buildSemanticSegments(
  segments: RehearsalAudioProcessingResponse["segments"],
) {
  return segments.flatMap((segment) => {
    if (
      segment.startSeconds == null ||
      segment.endSeconds == null ||
      segment.endSeconds < segment.startSeconds ||
      !segment.text.trim()
    ) {
      return [];
    }
    return [
      {
        startMs: Math.round(segment.startSeconds * 1000),
        endMs: Math.round(segment.endSeconds * 1000),
        text: segment.text,
      },
    ];
  });
}

function buildSemanticSlideTimeline(
  snapshot: RehearsalEvaluationSnapshot,
  runMeta: RehearsalRunMeta,
) {
  const slideIds = new Set(snapshot.slides.map((slide) => slide.slideId));
  const entries = runMeta.slideTimeline.flatMap((entry) => {
    const enteredAt = Date.parse(entry.enteredAt);
    return slideIds.has(entry.slideId) && !Number.isNaN(enteredAt)
      ? [{ slideId: entry.slideId, enteredAt }]
      : [];
  });
  const firstEnteredAt = entries[0]?.enteredAt;
  if (firstEnteredAt === undefined) {
    return [];
  }

  return entries.map((entry, index) => {
    const nextEntry = entries[index + 1];
    const enteredAtMs = Math.max(0, entry.enteredAt - firstEnteredAt);
    return {
      slideId: entry.slideId,
      enteredAtMs,
      ...(nextEntry && nextEntry.enteredAt > entry.enteredAt
        ? { exitedAtMs: nextEntry.enteredAt - firstEnteredAt }
        : {}),
    };
  });
}

function validateSemanticOutcomeCoverage(
  snapshot: RehearsalEvaluationSnapshot,
  outcomes: RehearsalSemanticCueOutcome[],
) {
  const expected = new Map(
    snapshot.slides.flatMap((slide) =>
      slide.semanticCues.map(
        (cue) =>
          [
            `${slide.slideId}:${cue.cueId}`,
            {
              cue,
              reportLabel: normalizeSemanticReportLabel(
                cue.reportLabel ?? cue.presenterTag ?? cue.meaning,
              ),
            },
          ] as const,
      ),
    ),
  );
  const actual = new Map<string, RehearsalSemanticCueOutcome>();
  for (const outcome of outcomes) {
    const key = `${outcome.slideId}:${outcome.cueId}`;
    if (actual.has(key)) {
      throw new Error("Semantic evaluator returned duplicate outcomes.");
    }
    actual.set(key, outcome);
  }
  if (actual.size !== expected.size) {
    throw new Error(
      "Semantic evaluator returned an incomplete cue denominator.",
    );
  }
  for (const [key, expectedOutcome] of expected) {
    const outcome = actual.get(key);
    if (
      !outcome ||
      outcome.cueRevision !== expectedOutcome.cue.revision ||
      outcome.cueMeaningSnapshot !== expectedOutcome.cue.meaning ||
      outcome.reportLabelSnapshot !== expectedOutcome.reportLabel ||
      outcome.importance !== expectedOutcome.cue.importance
    ) {
      throw new Error("Semantic evaluator changed immutable cue identity.");
    }
  }
}

function normalizeSemanticReportLabel(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 80);
}

function buildSemanticFailureResult(
  snapshot: RehearsalEvaluationSnapshot,
  request: ReturnType<typeof buildSemanticAnalysisRequest>,
  providerReason: SemanticFallbackReason,
): SemanticAnalysisResult {
  const visitedSlides = new Set(
    request.slideTimeline.map((entry) => entry.slideId),
  );
  const outcomes = snapshot.slides.flatMap((slide) =>
    slide.semanticCues.map((cue): RehearsalSemanticCueOutcome => {
      const base = {
        slideId: slide.slideId,
        cueId: cue.cueId,
        cueRevision: cue.revision,
        cueMeaningSnapshot: cue.meaning,
        reportLabelSnapshot: normalizeSemanticReportLabel(
          cue.reportLabel ?? cue.presenterTag ?? cue.meaning,
        ),
        importance: cue.importance,
        coveredConcepts: [],
        missingConcepts: cue.requiredConcepts,
      };
      if (cue.reviewStatus === "excluded") {
        return {
          ...base,
          status: "excluded",
          measurementMode: "none",
          fallbackUsed: false,
        };
      }

      const reason =
        cue.freshness === "stale"
          ? "stale_cue"
          : !visitedSlides.has(slide.slideId)
            ? "slide_not_visited"
            : (transcriptCapabilityReason(slide.slideId, cue.cueId, request) ??
              (!hasSemanticTranscriptForSlide(slide.slideId, request)
                ? "no_transcript"
                : providerReason));
      const providerFallback = reason === providerReason;
      return {
        ...base,
        status: "unmeasured",
        measurementMode: "none",
        fallbackUsed: providerFallback,
        ...(providerFallback ? { fallbackReason: providerReason } : {}),
        unmeasuredReason: reason,
      };
    }),
  );
  const reasons = Array.from(
    new Set(
      outcomes.flatMap((outcome) =>
        outcome.status === "unmeasured" && outcome.unmeasuredReason
          ? [outcome.unmeasuredReason]
          : [],
      ),
    ),
  );
  const retryable = reasons.some((reason) => reason === providerReason);
  const hasUnmeasured = outcomes.some(
    (outcome) => outcome.status === "unmeasured",
  );
  return analyzeSemanticResponseSchema.parse({
    semanticEvaluation: {
      state: hasUnmeasured ? "unavailable" : "succeeded",
      measurementMode: "none",
      reasons,
      retryable,
    },
    semanticCueOutcomes: outcomes,
  });
}

function transcriptCapabilityReason(
  slideId: string,
  cueId: string,
  request: ReturnType<typeof buildSemanticAnalysisRequest>,
): SemanticFallbackReason | undefined {
  for (const event of [...request.capabilityEvents].reverse()) {
    if (
      (event.capability !== "stt" &&
        event.capability !== "transcript_evidence") ||
      event.toState === "available" ||
      event.reason === undefined ||
      !transcriptBlockingReasons.has(event.reason) ||
      (event.slideId !== undefined && event.slideId !== slideId) ||
      (event.cueIds.length > 0 && !event.cueIds.includes(cueId))
    ) {
      continue;
    }
    return event.reason;
  }
  return undefined;
}

function hasSemanticTranscriptForSlide(
  slideId: string,
  request: ReturnType<typeof buildSemanticAnalysisRequest>,
) {
  const timeline = request.slideTimeline;
  return request.segments.some((segment) => {
    const midpoint = (segment.startMs + segment.endMs) / 2;
    return timeline.some((entry, index) => {
      if (entry.slideId !== slideId || midpoint < entry.enteredAtMs) {
        return false;
      }
      const nextEntry = timeline[index + 1];
      const exitedAtMs =
        entry.exitedAtMs ?? nextEntry?.enteredAtMs ?? Number.POSITIVE_INFINITY;
      return midpoint < exitedAtMs;
    });
  });
}

function emitSemanticEvaluationEvent(
  callback:
    | ((event: RehearsalSemanticEvaluationBusinessEvent) => void)
    | undefined,
  event: RehearsalSemanticEvaluationBusinessEvent,
) {
  try {
    callback?.(event);
  } catch {
    // 업무 이벤트 로깅 실패는 리포트 생성을 막지 않는다.
  }
}

function emitTranscriptArtifactEvent(
  callback:
    | ((event: RehearsalTranscriptArtifactBusinessEvent) => void)
    | undefined,
  event: RehearsalTranscriptArtifactBusinessEvent,
) {
  try {
    callback?.(event);
  } catch {
    // Business event logging must not interrupt rehearsal processing.
  }
}

async function loadAudioAsset(
  dataSource: DataSource,
  payload: RehearsalSttPayload,
) {
  const rows = await dataSource.query(
    `
      SELECT file_id, project_id, storage_key, mime_type, original_name, purpose, status
      FROM project_assets
      WHERE file_id = $1 AND project_id = $2
    `,
    [payload.audioFileId, payload.projectId],
  );

  const row = readFirstQueryRow<unknown>(rows);
  if (!row) {
    throw new Error(`Rehearsal audio asset not found: ${payload.audioFileId}`);
  }

  return audioAssetRowSchema.parse(row);
}

async function loadDeckAnalysisContext(
  dataSource: DataSource,
  projectId: string,
  deckId: string,
  semanticEvaluationMode: "full" | "delivery-only",
) {
  const rows = await dataSource.query(
    `SELECT deck_json, version FROM decks WHERE project_id = $1 AND deck_id = $2`,
    [projectId, deckId],
  );

  const row = readFirstQueryRow<unknown>(rows);
  if (!row) {
    throw new Error(`Deck not found: ${deckId}`);
  }

  const checkpoint = deckRowSchema.parse(row);
  const checkpointDeck = deckSchema.parse(checkpoint.deck_json);
  const patchRows = await dataSource.query(
    `
      SELECT before_version, after_version, source, operations
      FROM deck_patches
      WHERE project_id = $1 AND deck_id = $2 AND after_version > $3
      ORDER BY after_version ASC, created_at ASC, change_id ASC
    `,
    [projectId, deckId, checkpoint.version],
  );

  let workingDeck = checkpointDeck;
  let expectedBeforeVersion = checkpointDeck.version;
  for (const rawPatchRow of patchRows) {
    const patchRow = deckPatchRowSchema.parse(rawPatchRow);

    if (patchRow.before_version !== expectedBeforeVersion) {
      throw new Error(
        `Stored patch chain does not start from the checkpoint version: expected=${expectedBeforeVersion}, actual=${patchRow.before_version}`,
      );
    }

    if (patchRow.after_version !== patchRow.before_version + 1) {
      throw new Error(
        `Stored patch history has a non-sequential version transition: before=${patchRow.before_version}, after=${patchRow.after_version}`,
      );
    }

    const patch = deckPatchSchema.parse({
      deckId: workingDeck.deckId,
      baseVersion: patchRow.before_version,
      source: patchRow.source,
      operations: patchRow.operations,
    });
    workingDeck = applyReportDeckPatch(
      workingDeck,
      patch,
      patchRow.after_version,
    );

    if (workingDeck.version !== patchRow.after_version) {
      throw new Error(
        `Stored patch history has an unexpected version transition: deck=${workingDeck.version}, patch=${patchRow.after_version}`,
      );
    }

    expectedBeforeVersion = patchRow.after_version;
  }

  return {
    slides: workingDeck.slides.map((slide) => ({
      slideId: slide.slideId,
      targetSeconds: getSlideTargetSeconds(workingDeck, slide),
    })),
    deckKeywords: workingDeck.slides.flatMap((slide) =>
      slide.keywords.map((keyword) => ({ ...keyword, slideId: slide.slideId })),
    ),
    evaluationSnapshot: null,
    semanticEvaluationMode,
  };
}

function buildSnapshotAnalysisContext(
  snapshot: z.infer<typeof rehearsalEvaluationSnapshotSchema>,
  semanticEvaluationMode: "full" | "delivery-only",
): DeckAnalysisContext {
  return {
    slides: snapshot.slides.map((slide) => ({
      slideId: slide.slideId,
      targetSeconds: slide.estimatedSeconds,
    })),
    deckKeywords: snapshot.slides.flatMap((slide) =>
      slide.keywords.map((keyword) => ({ ...keyword, slideId: slide.slideId })),
    ),
    evaluationSnapshot: snapshot,
    semanticEvaluationMode,
  };
}

function applyReportDeckPatch(
  deck: Deck,
  patch: ReturnType<typeof deckPatchSchema.parse>,
  afterVersion: number,
) {
  let nextDeck: Deck = {
    ...deck,
    version: afterVersion,
    slides: [...deck.slides],
  };

  for (const operation of patch.operations) {
    switch (operation.type) {
      case "update_deck": {
        nextDeck = {
          ...nextDeck,
          ...(operation.title !== undefined ? { title: operation.title } : {}),
          ...(operation.metadata
            ? {
                metadata: applyReportDeckMetadataPatch(
                  nextDeck.metadata,
                  operation.metadata,
                ),
              }
            : {}),
        };
        break;
      }
      case "add_slide":
        nextDeck = {
          ...nextDeck,
          slides: [...nextDeck.slides, operation.slide].sort(
            (a, b) => a.order - b.order,
          ),
        };
        break;
      case "delete_slide":
        nextDeck = {
          ...nextDeck,
          slides: nextDeck.slides.filter(
            (slide) => slide.slideId !== operation.slideId,
          ),
        };
        break;
      case "reorder_slides": {
        const orderBySlideId = new Map(
          operation.slideOrders.map((slideOrder) => [
            slideOrder.slideId,
            slideOrder.order,
          ]),
        );
        nextDeck = {
          ...nextDeck,
          slides: nextDeck.slides
            .map((slide) => ({
              ...slide,
              order: orderBySlideId.get(slide.slideId) ?? slide.order,
            }))
            .sort((a, b) => a.order - b.order),
        };
        break;
      }
      case "replace_keywords":
        nextDeck = {
          ...nextDeck,
          slides: nextDeck.slides.map((slide) =>
            slide.slideId === operation.slideId
              ? { ...slide, keywords: operation.keywords }
              : slide,
          ),
        };
        break;
      default:
        break;
    }
  }

  return deckSchema.parse(nextDeck);
}

function applyReportDeckMetadataPatch(
  metadata: Deck["metadata"],
  patch: { thumbnailSource?: Deck["metadata"]["thumbnailSource"] | null },
) {
  const nextMetadata = { ...metadata };

  if (patch.thumbnailSource === null) {
    delete nextMetadata.thumbnailSource;
  } else if (patch.thumbnailSource !== undefined) {
    nextMetadata.thumbnailSource = patch.thumbnailSource;
  }

  return nextMetadata;
}

function buildReportMissedKeywords(
  analysisKeywords: z.infer<typeof analyzeMissedKeywordSchema>[],
) {
  const byKey = new Map<string, z.infer<typeof analyzeMissedKeywordSchema>>();

  for (const keyword of analysisKeywords) {
    byKey.set(`${keyword.slideId}:${keyword.keywordId}`, keyword);
  }

  return Array.from(byKey.values());
}

function buildSlideTimings(
  deckContext: DeckAnalysisContext,
  runMeta: RehearsalRunMeta,
): RehearsalReportSlideTiming[] {
  const slideIds = new Set(deckContext.slides.map((slide) => slide.slideId));
  const timeline = runMeta.slideTimeline.filter((entry) =>
    slideIds.has(entry.slideId),
  );
  const timings: RehearsalReportSlideTiming[] = [];
  const firstEnteredAt = Date.parse(timeline[0]?.enteredAt ?? "");
  const recordingDurationSeconds = runMeta.recordingDurationSeconds;
  const recordingEndedAt =
    !Number.isNaN(firstEnteredAt) && recordingDurationSeconds !== null
      ? firstEnteredAt + recordingDurationSeconds * 1000
      : null;

  for (let index = 0; index < timeline.length; index += 1) {
    const entry = timeline[index];
    const nextEntry = timeline[index + 1];
    if (!entry) {
      continue;
    }

    const enteredAt = Date.parse(entry.enteredAt);
    const exitedAt = nextEntry
      ? Date.parse(nextEntry.enteredAt)
      : recordingEndedAt;
    if (
      Number.isNaN(enteredAt) ||
      exitedAt === null ||
      Number.isNaN(exitedAt) ||
      exitedAt <= enteredAt
    ) {
      continue;
    }

    if (nextEntry && entry.slideId === nextEntry.slideId) {
      continue;
    }

    const slide = deckContext.slides.find(
      (candidate) => candidate.slideId === entry.slideId,
    );
    if (!slide) {
      continue;
    }

    timings.push({
      slideId: entry.slideId,
      targetSeconds: slide.targetSeconds,
      actualSeconds: Math.round((exitedAt - enteredAt) / 1000),
    });
  }

  return timings;
}

function buildAnalyzeSlideTimeline(
  deckContext: DeckAnalysisContext,
  runMeta: RehearsalRunMeta,
) {
  const slideIds = new Set(deckContext.slides.map((slide) => slide.slideId));
  const timeline = runMeta.slideTimeline.filter((entry) =>
    slideIds.has(entry.slideId),
  );
  const firstValidEnteredAt = timeline
    .map((entry) => Date.parse(entry.enteredAt))
    .find((enteredAt) => !Number.isNaN(enteredAt));

  if (firstValidEnteredAt == null) {
    return [];
  }

  const entries: { slideId: string; enteredSecond: number }[] = [];
  let previousSlideId: string | null = null;
  let previousSecond = -1;

  for (const entry of timeline) {
    const enteredAt = Date.parse(entry.enteredAt);
    if (Number.isNaN(enteredAt)) {
      continue;
    }

    const enteredSecond = Math.max(
      0,
      Math.round(((enteredAt - firstValidEnteredAt) / 1000) * 100) / 100,
    );
    if (enteredSecond < previousSecond || entry.slideId === previousSlideId) {
      continue;
    }

    entries.push({ slideId: entry.slideId, enteredSecond });
    previousSlideId = entry.slideId;
    previousSecond = enteredSecond;
  }

  return entries;
}

function getSlideTargetSeconds(deck: Deck, slide: Deck["slides"][number]) {
  if (slide.estimatedSeconds) {
    return slide.estimatedSeconds;
  }

  return Math.max(
    1,
    Math.round((deck.targetDurationMinutes * 60) / deck.slides.length),
  );
}

async function failAndScheduleRawAudioDeletion(
  dataSource: DataSource,
  asset: AudioAssetRow,
  payload: RehearsalSttPayload,
  progress: number,
  code: string,
  message: string,
) {
  const failedJob = await failJobAndRun(
    dataSource,
    payload,
    progress,
    code,
    message,
  );
  await scheduleRawAudioDeletion(dataSource, asset);
  return failedJob;
}

async function scheduleRawAudioDeletion(
  dataSource: DataSource,
  asset: AudioAssetRow,
) {
  const now = new Date().toISOString();
  const storageKeyHash = createHash("sha256")
    .update(asset.storage_key)
    .digest("hex");
  await dataSource.query(
    `
      INSERT INTO storage_deletion_outbox (
        deletion_id, project_id, file_id, storage_key, storage_key_hash,
        purpose, status, attempt_count, next_attempt_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,'pending',0,$7,$7)
      ON CONFLICT (storage_key_hash) DO NOTHING
    `,
    [
      `deletion_${storageKeyHash.slice(0, 32)}`,
      asset.project_id,
      asset.file_id,
      asset.storage_key,
      storageKeyHash,
      asset.purpose,
      now,
    ],
  );
}

async function failJobAndRun(
  dataSource: DataSource,
  payload: RehearsalSttPayload,
  progress: number,
  code: string,
  message: string,
  options: { rawAudioDeletedAt?: string } = {},
): Promise<Job> {
  await updateRun(dataSource, payload, {
    status: "failed",
    error: { code, message },
    rawAudioDeletedAt: options.rawAudioDeletedAt,
  });
  return failJobOnly(dataSource, payload.jobId, progress, code, message);
}

async function failJobOnly(
  dataSource: DataSource,
  jobId: string,
  progress: number,
  code: string,
  message: string,
): Promise<Job> {
  return updateJob(dataSource, jobId, {
    status: "failed",
    progress,
    message: "Rehearsal STT failed.",
    result: null,
    error: { code, message },
  });
}

async function updateRun(
  dataSource: DataSource,
  payload: RehearsalSttPayload,
  patch: {
    status: "processing" | "succeeded" | "failed";
    error: { code: string; message: string } | null;
    jobId?: string;
    rawAudioDeletedAt?: string;
    rehearsalReport?: RehearsalReport;
    transcriptRetained?: boolean;
  },
): Promise<z.infer<typeof rehearsalRunInputRowSchema>> {
  const rows = await dataSource.query(
    `
      UPDATE rehearsal_runs
      SET status = $2,
          job_id = COALESCE($3, job_id),
          error = $4,
          raw_audio_deleted_at = COALESCE($5::timestamptz, raw_audio_deleted_at),
          report_json = COALESCE($6::jsonb, report_json),
          transcript_retained = COALESCE($7::boolean, transcript_retained),
          analysis_revision = CASE
            WHEN $6::jsonb IS NULL THEN analysis_revision
            ELSE analysis_revision + 1
          END,
          analysis_finalized_at = CASE
            WHEN $6::jsonb IS NULL THEN analysis_finalized_at
            WHEN $9::boolean THEN now()
            ELSE NULL
          END,
          updated_at = now()
      WHERE run_id = $1 AND project_id = $8
      RETURNING run_id, created_at, meta_json, evaluation_snapshot_json,
                semantic_evaluation_mode, analysis_revision,
                transcript_json_file_id, transcript_text_file_id,
                (SELECT status FROM project_assets
                 WHERE file_id = rehearsal_runs.transcript_json_file_id)
                  AS transcript_json_status,
                (SELECT status FROM project_assets
                 WHERE file_id = rehearsal_runs.transcript_text_file_id)
                  AS transcript_text_status
    `,
    [
      payload.runId,
      patch.status,
      patch.jobId ?? null,
      patch.error,
      patch.rawAudioDeletedAt ?? null,
      patch.rehearsalReport ? JSON.stringify(patch.rehearsalReport) : null,
      patch.transcriptRetained ?? null,
      payload.projectId,
      patch.rehearsalReport
        ? !patch.rehearsalReport.semanticEvaluation.retryable
        : false,
    ],
  );

  const row = readFirstQueryRow<unknown>(rows);
  if (!row) {
    throw new Error(`Rehearsal run not found: ${payload.runId}`);
  }

  return rehearsalRunInputRowSchema.parse(row);
}

async function progressJob(
  dataSource: DataSource,
  jobId: string,
  progress: number,
  message: string,
): Promise<void> {
  await updateJob(dataSource, jobId, {
    status: "running",
    progress,
    message,
    result: null,
    error: null,
  });
}

async function updateJob(
  dataSource: DataSource,
  jobId: string,
  patch: {
    status: "running" | "succeeded" | "failed";
    progress: number;
    message: string;
    result: Record<string, unknown> | null;
    error: { code: string; message: string } | null;
  },
): Promise<Job> {
  const rows = await dataSource.query(
    `
      UPDATE jobs
      SET status = $2,
          progress = $3,
          message = $4,
          result = $5,
          error = $6,
          updated_at = now()
      WHERE job_id = $1
      RETURNING *
    `,
    [
      jobId,
      patch.status,
      patch.progress,
      patch.message,
      patch.result,
      patch.error,
    ],
  );

  const row = readFirstQueryRow<JobRow>(rows);
  if (!row) {
    throw new Error(`Job not found: ${jobId}`);
  }

  return rowToJob(row);
}

type JobRow = {
  job_id?: string;
  jobId?: string;
  project_id?: string;
  projectId?: string;
  type: Job["type"];
  status: Job["status"];
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  created_at?: Date | string;
  createdAt?: Date | string;
  updated_at?: Date | string;
  updatedAt?: Date | string;
};

function rowToJob(row: JobRow): Job {
  return {
    jobId: readRequiredString(row.jobId ?? row.job_id, "jobId"),
    projectId: readRequiredString(row.projectId ?? row.project_id, "projectId"),
    type: row.type,
    status: row.status,
    progress: row.progress,
    message: row.message,
    result: row.result,
    error: row.error,
    createdAt: toIso(row.createdAt ?? row.created_at),
    updatedAt: toIso(row.updatedAt ?? row.updated_at),
  };
}

function readFirstQueryRow<T>(queryResult: unknown): T | null {
  if (!Array.isArray(queryResult)) {
    return null;
  }

  const first = queryResult[0];
  if (Array.isArray(first)) {
    return (first[0] as T | undefined) ?? null;
  }

  return (first as T | undefined) ?? null;
}

function readRequiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value) {
    throw new Error(`Missing ${field} in job row.`);
  }

  return value;
}

function toIso(value: Date | string | undefined): string {
  if (value === undefined) {
    throw new Error("Missing timestamp in job row.");
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp value: ${String(value)}`);
  }

  return date.toISOString();
}

type DeckKeywordPayload = {
  slideId: string;
  keywordId: string;
  text: string;
  synonyms: string[];
  abbreviations: string[];
  required: boolean;
};

type DeckAnalysisContext = {
  slides: { slideId: string; targetSeconds: number }[];
  deckKeywords: DeckKeywordPayload[];
  evaluationSnapshot: z.infer<typeof rehearsalEvaluationSnapshotSchema> | null;
  semanticEvaluationMode: "full" | "delivery-only";
};

function workerUrl(baseUrl: string, path: string): string {
  return new URL(
    path,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
}

type ReportJsonShape = {
  metrics?: { durationSeconds?: number };
  slideTimings?: { slideId: string; actualSeconds: number }[];
};

type SucceededRunRow = {
  run_id: string;
  created_at: Date | string;
  report_json: ReportJsonShape | null;
};

async function upsertRehearsalSummary(
  dataSource: DataSource,
  pythonWorkerUrl: string,
  projectId: string,
): Promise<void> {
  const rows: SucceededRunRow[] = await dataSource.query(
    `SELECT run_id, created_at, report_json
     FROM rehearsal_runs
     WHERE project_id = $1 AND status = 'succeeded'
     ORDER BY created_at ASC`,
    [projectId],
  );

  if (rows.length === 0) return;

  const runDurationSeries = rows.map((row) => ({
    runId: row.run_id,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    durationSeconds: row.report_json?.metrics?.durationSeconds ?? 0,
  }));

  if (rows.length < 2) return;

  let progressComment: string | null = null;
  try {
    const response = await fetch(
      workerUrl(pythonWorkerUrl, "/rehearsal/progress-comment"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, runSeries: runDurationSeries }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.ok) {
      const data = (await response.json()) as { comment?: string | null };
      progressComment = data.comment ?? null;
    }
  } catch {
    // 코멘트 생성 실패 시 무시
  }

  if (progressComment !== null) {
    await dataSource.query(
      `UPDATE projects SET progress_comment = $2 WHERE project_id = $1`,
      [projectId, progressComment],
    );
  }
}
