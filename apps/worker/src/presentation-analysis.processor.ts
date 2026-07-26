import type { StoragePort } from "@orbit/storage";
import { jobSchema, type Job } from "@orbit/shared/jobs";
import {
  presentationAnalysisJobPayloadSchema,
  presentationVoiceReportSchema,
  type PresentationVoiceReport,
} from "@orbit/shared/presentation";
import {
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
  legacyRehearsalReportMetricsDefaults,
  rehearsalReportSchema,
  type RehearsalReport,
  type SlideTranscriptSnapshot,
} from "@orbit/shared/rehearsals";
import {
  analyzeKoreanFillers,
  slidePracticeServerAudioResponseSchema,
  type SlidePracticeServerAudioResponse,
} from "@orbit/shared/slide-practice";
import { createHash } from "node:crypto";
import type { DataSource } from "typeorm";
import { z } from "zod";

const presentationAnalysisInputSchema = z.object({
  run_id: z.string().min(1),
  project_id: z.string().min(1),
  session_id: z.string().min(1),
  deck_id: z.string().min(1),
  deck_snapshot_json: z
    .object({
      slides: z.array(
        z
          .object({
            estimatedSeconds: z.number().int().positive().optional(),
            keywords: z
              .array(
                z
                  .object({
                    keywordId: z.string().min(1).optional(),
                    required: z.boolean().default(false),
                    text: z.string().trim().min(1),
                  })
                  .passthrough(),
              )
              .default([]),
            slideId: z.string().min(1).optional(),
            speakerNotes: z.string().default(""),
            title: z.string().trim().min(1).optional(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
  status: z.enum([
    "created",
    "uploading",
    "processing",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  audio_file_id: z.string().min(1),
  storage_key: z.string().min(1),
  mime_type: z.string().min(1),
  asset_status: z.literal("uploaded"),
  purpose: z.literal("presentation-audio"),
});

type PresentationAnalysisInput = z.infer<
  typeof presentationAnalysisInputSchema
>;

export async function processPresentationAnalysisJob(
  dataSource: DataSource,
  storage: Pick<StoragePort, "getSignedReadUrl" | "removeObject">,
  pythonWorkerUrl: string,
  rawPayload: unknown,
): Promise<Job> {
  const payload = presentationAnalysisJobPayloadSchema.parse(rawPayload);
  const input = presentationAnalysisInputSchema.parse(
    firstQueryRow(
      await dataSource.query(
        `SELECT runs.run_id, runs.project_id, runs.session_id, runs.deck_id,
                runs.deck_snapshot_json, runs.status, runs.audio_file_id,
                assets.storage_key, assets.mime_type,
                assets.status AS asset_status, assets.purpose
         FROM presentation_runs runs
         JOIN project_assets assets
           ON assets.project_id = runs.project_id
          AND assets.file_id = runs.audio_file_id
         WHERE runs.run_id = $1
           AND runs.project_id = $2
           AND runs.session_id = $3
           AND runs.deck_id = $4
           AND runs.audio_file_id = $5`,
        [
          payload.runId,
          payload.projectId,
          payload.sessionId,
          payload.deckId,
          payload.audioFileId,
        ],
      ),
    ),
  );

  if (input.status !== "processing") {
    return currentJob(dataSource, payload.jobId);
  }

  await updateJob(
    dataSource,
    payload.jobId,
    "running",
    10,
    "실전 발표 음성 분석 준비 중",
    null,
    null,
  );

  try {
    const storageUrl = await storage.getSignedReadUrl(input.storage_key);
    const response = await fetch(
      new URL("/slide-practice/analyze-audio", pythonWorkerUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: payload.runId,
          projectId: payload.projectId,
          audio: {
            fileId: payload.audioFileId,
            storageUrl,
            mimeType: input.mime_type,
          },
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) {
      throw new PresentationAnalysisError(
        "PRESENTATION_TRANSCRIPTION_FAILED",
        (await response.text()) || "Presentation transcription failed.",
      );
    }

    const evidence = slidePracticeServerAudioResponseSchema.parse(
      await response.json(),
    );
    await updateJob(
      dataSource,
      payload.jobId,
      "running",
      75,
      "실전 발표 음성 지표 정리 중",
      null,
      null,
    );

    const voiceReport = buildPresentationVoiceReport(
      evidence,
      input.deck_snapshot_json.slides.map((slide) => slide.speakerNotes),
      payload.liveTranscript,
    );
    const detailedReport = buildPresentationDetailedReport(
      evidence,
      input.deck_snapshot_json,
      {
        deckId: payload.deckId,
        projectId: payload.projectId,
        runId: payload.runId,
      },
      new Date().toISOString(),
      {
        liveTranscript: payload.liveTranscript,
        slideTranscriptSnapshots: payload.slideTranscriptSnapshots,
      },
    );
    await dataSource.query(
      `UPDATE presentation_runs
       SET status = 'succeeded', voice_report_json = $2::jsonb,
           detailed_report_json = $5::jsonb, error = NULL,
           updated_at = now()
       WHERE run_id = $1 AND project_id = $3 AND session_id = $4
         AND status = 'processing'`,
      [
        payload.runId,
        JSON.stringify(voiceReport),
        payload.projectId,
        payload.sessionId,
        JSON.stringify(detailedReport),
      ],
    );
    await deletePresentationAudio(dataSource, storage, input);

    return updateJob(
      dataSource,
      payload.jobId,
      "succeeded",
      100,
      "실전 발표 분석 완료",
      {
        detailedReport,
        runId: payload.runId,
        sessionId: payload.sessionId,
        voiceReport,
      },
      null,
    );
  } catch (error) {
    const failure = presentationAnalysisFailure(error);
    await dataSource.query(
      `UPDATE presentation_runs
       SET status = 'failed', error = $2::jsonb, updated_at = now()
       WHERE run_id = $1 AND project_id = $3 AND session_id = $4
         AND status = 'processing'`,
      [
        payload.runId,
        JSON.stringify(failure),
        payload.projectId,
        payload.sessionId,
      ],
    );
    return updateJob(
      dataSource,
      payload.jobId,
      "failed",
      100,
      "실전 발표 분석 실패",
      null,
      failure,
    );
  }
}

export function buildPresentationDetailedReport(
  evidence: SlidePracticeServerAudioResponse,
  deck: PresentationAnalysisInput["deck_snapshot_json"],
  identity: { deckId: string; projectId: string; runId: string },
  generatedAt = new Date().toISOString(),
  liveEvidence: {
    liveTranscript?: string | null;
    slideTranscriptSnapshots?: SlideTranscriptSnapshot[];
  } = {},
): RehearsalReport {
  const reportTranscript =
    liveEvidence.liveTranscript?.trim() || evidence.transcript;
  const voiceReport = buildPresentationVoiceReport(
    evidence,
    deck.slides.map((slide) => slide.speakerNotes),
    reportTranscript,
  );
  const durationSeconds = voiceReport.durationSeconds;
  const characterCount = reportTranscript.replace(/\s/g, "").length;
  const charactersPerMinute =
    durationSeconds > 0 ? characterCount / (durationSeconds / 60) : 0;
  const fillers = analyzeKoreanFillers(reportTranscript);
  const volumeAnalysis = buildPresentationVolumeAnalysis(
    evidence,
    durationSeconds,
  );
  const silenceAnalysis = buildPresentationSilenceAnalysis(
    evidence,
    durationSeconds,
  );
  const requiredKeywords = deck.slides.flatMap((slide) =>
    slide.keywords.filter((keyword) => keyword.required),
  );
  const matchedKeywordCount = requiredKeywords.filter((keyword) =>
    normalizeText(reportTranscript).includes(normalizeText(keyword.text)),
  ).length;
  const keywordCoverage =
    requiredKeywords.length > 0
      ? matchedKeywordCount / requiredKeywords.length
      : 0;
  const totalTargetSeconds = deck.slides.reduce(
    (sum, slide) => sum + (slide.estimatedSeconds ?? 60),
    0,
  );

  return rehearsalReportSchema.parse({
    reportId: `presentation_report_${identity.runId}`,
    runId: identity.runId,
    projectId: identity.projectId,
    deckId: identity.deckId,
    transcriptRetained: true,
    transcript: reportTranscript,
    volumeAnalysis,
    silenceAnalysis,
    metrics: {
      durationSeconds,
      charactersPerMinute,
      wordsPerMinute: voiceReport.wordsPerMinute,
      fillerWordCount: fillers.totalCount,
      longSilenceCount: silenceAnalysis.longSilenceCount,
      keywordCoverage,
      measurements: {
        ...legacyRehearsalReportMetricsDefaults.measurements,
        duration: measuredMetric(),
        charactersPerMinute: measuredMetric(),
        wordsPerMinute: measuredMetric(),
        fillerWordCount: measuredMetric(),
        longSilenceCount:
          silenceAnalysis.measurementState === "measured"
            ? measuredMetric(2)
            : {
                ...legacyRehearsalReportMetricsDefaults.measurements
                  .longSilenceCount,
                metricDefinitionVersion: 1,
              },
      },
      keywordCoverageMeasurement:
        requiredKeywords.length > 0
          ? { state: "measured" }
          : { state: "unmeasured", reason: "no-keywords" },
    },
    speedSamples: evidence.speedSamples.map((sample) => ({
      startSecond: sample.startMs / 1_000,
      endSecond: sample.endMs / 1_000,
      wordsPerMinute: voiceReport.wordsPerMinute,
    })),
    fillerWordDetails: fillers.details,
    missedKeywords: deck.slides.flatMap((slide, slideIndex) =>
      slide.keywords
        .filter((keyword) => keyword.required)
        .filter(
          (keyword) =>
            !normalizeText(reportTranscript).includes(
              normalizeText(keyword.text),
            ),
        )
        .map((keyword, keywordIndex) => ({
          slideId: slide.slideId ?? `slide_${slideIndex + 1}`,
          keywordId:
            keyword.keywordId ??
            `keyword_${slideIndex + 1}_${keywordIndex + 1}`,
          text: keyword.text,
        })),
    ),
    slideTimings: deck.slides.map((slide, index) => {
      const targetSeconds = slide.estimatedSeconds ?? 60;
      return {
        slideId: slide.slideId ?? `slide_${index + 1}`,
        targetSeconds,
        actualSeconds:
          totalTargetSeconds > 0
            ? (durationSeconds * targetSeconds) / totalTargetSeconds
            : 0,
      };
    }),
    slideInsights: buildPresentationSlideInsights(
      deck.slides,
      liveEvidence.slideTranscriptSnapshots ?? [],
    ),
    aiSummary: {
      headline: "실전 발표 분석이 완료되었습니다.",
      paragraphs: [voiceReport.scriptFeedback],
    },
    coaching: {
      status: "succeeded",
      summary: voiceReport.scriptFeedback,
      strengths: [],
      improvements: buildPresentationImprovements(voiceReport),
      nextPracticeFocus: voiceReport.scriptFeedback,
      message: "실전 발표 음성과 대본을 함께 분석했습니다.",
    },
    generatedAt,
  });
}

function buildPresentationSlideInsights(
  slides: PresentationAnalysisInput["deck_snapshot_json"]["slides"],
  snapshots: SlideTranscriptSnapshot[],
) {
  const fillerDetailsBySlide = new Map<string, Map<string, number>>();
  let previousTranscript = "";
  for (const snapshot of snapshots) {
    const segmentTranscript = snapshot.transcript.startsWith(previousTranscript)
      ? snapshot.transcript.slice(previousTranscript.length)
      : snapshot.transcript;
    previousTranscript = snapshot.transcript;
    const counts =
      fillerDetailsBySlide.get(snapshot.slideId) ?? new Map<string, number>();
    for (const detail of analyzeKoreanFillers(segmentTranscript).details) {
      counts.set(detail.word, (counts.get(detail.word) ?? 0) + detail.count);
    }
    fillerDetailsBySlide.set(snapshot.slideId, counts);
  }

  return slides.map((slide, index) => {
    const slideId = slide.slideId ?? `slide_${index + 1}`;
    const fillerWordDetails = [
      ...(fillerDetailsBySlide.get(slideId) ?? new Map()),
    ].map(([word, count]) => ({ word, count }));
    return {
      slideId,
      fillerWordCount:
        snapshots.length > 0
          ? fillerWordDetails.reduce((total, detail) => total + detail.count, 0)
          : null,
      fillerWordDetails,
      longSilenceCount: null,
    };
  });
}

function measuredMetric(metricDefinitionVersion = 1) {
  return {
    measurementState: "measured" as const,
    metricDefinitionVersion,
    reasonCode: null,
  };
}

function buildPresentationVolumeAnalysis(
  evidence: SlidePracticeServerAudioResponse,
  durationSeconds: number,
) {
  if (durationSeconds <= 0 || evidence.voice.loudnessDb === null) {
    return legacyRehearsalVolumeAnalysis;
  }

  return {
    metricDefinitionVersion: 2 as const,
    measurementState: "measured" as const,
    reasonCode: null,
    averageDbfs: evidence.voice.loudnessDb,
    baselineDbfs: evidence.voice.loudnessDb,
    variationDb: Math.max(0, evidence.voice.loudnessMadDb ?? 0),
    activeRatio: clamp(
      evidence.voice.activeSpeechMs / (durationSeconds * 1_000),
      0,
      1,
    ),
    issueSegments: [],
  };
}

function buildPresentationSilenceAnalysis(
  evidence: SlidePracticeServerAudioResponse,
  durationSeconds: number,
) {
  if (durationSeconds <= 0) return legacyRehearsalSilenceAnalysis;

  const segments = evidence.pauseSegments
    .map((segment) => {
      const startSeconds = clamp(segment.startMs / 1_000, 0, durationSeconds);
      const endSeconds = clamp(segment.endMs / 1_000, 0, durationSeconds);
      const segmentDurationSeconds = endSeconds - startSeconds;
      return {
        category:
          segmentDurationSeconds >= 5 ? ("long" as const) : ("brief" as const),
        startSeconds,
        endSeconds,
        durationSeconds: segmentDurationSeconds,
      };
    })
    .filter((segment) => segment.durationSeconds >= 0.25)
    .sort((left, right) => left.startSeconds - right.startSeconds);
  const totalSilenceSeconds = segments.reduce(
    (sum, segment) => sum + segment.durationSeconds,
    0,
  );

  return {
    metricDefinitionVersion: 2 as const,
    measurementState: "measured" as const,
    reasonCode: null,
    detector: "silero-vad" as const,
    detectorVersion: "presentation-audio-evidence-v1",
    speechThreshold: 0.5 as const,
    minimumSilenceMs: 250 as const,
    longSilenceMs: 5_000 as const,
    analysisWindowStartSeconds: 0,
    analysisWindowEndSeconds: durationSeconds,
    totalSilenceSeconds,
    silenceRatio: clamp(totalSilenceSeconds / durationSeconds, 0, 1),
    longSilenceCount: segments.filter((segment) => segment.category === "long")
      .length,
    detectedSegmentCount: segments.length,
    segmentsTruncated: false,
    segments,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function buildPresentationImprovements(report: PresentationVoiceReport) {
  const improvements: string[] = [];
  if (report.longSilenceCount > 0) {
    improvements.push(
      "5초 이상 멈춘 구간을 줄이고 문장 사이 호흡을 일정하게 유지해 보세요.",
    );
  }
  if (report.fillerWordCount > 0) {
    improvements.push("습관어 대신 짧게 호흡한 뒤 다음 문장을 이어가 보세요.");
  }
  if (improvements.length === 0) {
    improvements.push(
      "현재 말하기 흐름을 유지하면서 핵심 메시지를 더 분명하게 강조해 보세요.",
    );
  }
  return improvements;
}

export function buildPresentationVoiceReport(
  evidence: SlidePracticeServerAudioResponse,
  speakerNotes: string[],
  transcriptOverride?: string | null,
): PresentationVoiceReport {
  const transcript = transcriptOverride?.trim() || evidence.transcript;
  const durationMs = Math.max(
    evidence.voice.activeSpeechMs,
    ...evidence.loudnessSamples.map((sample) => sample.endMs),
    ...evidence.transcriptSegments.map((segment) => segment.endMs),
    ...evidence.pauseSegments.map((segment) => segment.endMs),
  );
  const durationSeconds = durationMs / 1_000;
  const spokenWordCount = countSpokenWords(transcript);
  const fillers = analyzeKoreanFillers(transcript);

  return presentationVoiceReportSchema.parse({
    durationSeconds,
    wordsPerMinute:
      durationSeconds > 0 ? spokenWordCount / (durationSeconds / 60) : 0,
    averageVolumeDbfs: evidence.voice.loudnessDb,
    fillerWordCount: fillers.totalCount,
    longSilenceCount: evidence.pauseSegments.filter(
      (segment) => segment.durationMs >= 5_000,
    ).length,
    averagePitchHz: evidence.voice.pitchMedianHz,
    scriptFeedback: buildScriptFeedback(transcript, speakerNotes),
  });
}

function buildScriptFeedback(transcript: string, speakerNotes: string[]) {
  const normalizedTranscript = normalizeText(transcript);
  const normalizedNotes = normalizeText(speakerNotes.join(" "));
  if (!normalizedNotes) {
    return "저장된 대본이 없어 음성 지표만 분석했습니다.";
  }
  if (!normalizedTranscript) {
    return "전사 결과가 없어 대본 연결 피드백을 만들지 못했습니다.";
  }

  const noteTerms = Array.from(
    new Set(normalizedNotes.split(" ").filter((term) => term.length >= 2)),
  );
  const matchedTerms = noteTerms.filter((term) =>
    normalizedTranscript.includes(term),
  );
  const coverage =
    noteTerms.length > 0 ? matchedTerms.length / noteTerms.length : 0;
  if (coverage >= 0.65) return "대본의 핵심 흐름을 대부분 따라 발표했습니다.";
  if (coverage >= 0.35)
    return "대본의 주요 흐름은 전달했지만 일부 내용을 보완할 수 있습니다.";
  return "대본과 다른 표현이 많았습니다. 핵심 메시지가 빠지지 않았는지 확인해 주세요.";
}

function countSpokenWords(transcript: string) {
  return normalizeText(transcript).split(" ").filter(Boolean).length;
}

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function deletePresentationAudio(
  dataSource: DataSource,
  storage: Pick<StoragePort, "removeObject">,
  input: PresentationAnalysisInput,
) {
  try {
    await storage.removeObject(input.storage_key);
    const deletedAt = new Date().toISOString();
    await dataSource.query(
      `UPDATE project_assets SET status = 'deleted', deleted_at = $3
       WHERE project_id = $1 AND file_id = $2`,
      [input.project_id, input.audio_file_id, deletedAt],
    );
    await dataSource.query(
      `UPDATE presentation_runs
       SET raw_audio_deleted_at = $2, updated_at = now()
       WHERE run_id = $1`,
      [input.run_id, deletedAt],
    );
  } catch {
    await schedulePresentationAudioDeletion(dataSource, input);
  }
}

async function schedulePresentationAudioDeletion(
  dataSource: DataSource,
  input: PresentationAnalysisInput,
) {
  const now = new Date().toISOString();
  const storageKeyHash = createHash("sha256")
    .update(input.storage_key)
    .digest("hex");
  await dataSource.query(
    `INSERT INTO storage_deletion_outbox (
       deletion_id, project_id, file_id, storage_key, storage_key_hash,
       purpose, status, attempt_count, next_attempt_at, created_at
     ) VALUES ($1,$2,$3,$4,$5,'presentation-audio','pending',0,$6,$6)
     ON CONFLICT (storage_key_hash) DO NOTHING`,
    [
      `deletion_${storageKeyHash.slice(0, 32)}`,
      input.project_id,
      input.audio_file_id,
      input.storage_key,
      storageKeyHash,
      now,
    ],
  );
}

class PresentationAnalysisError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function presentationAnalysisFailure(error: unknown) {
  if (error instanceof PresentationAnalysisError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof z.ZodError) {
    return {
      code: "PRESENTATION_AUDIO_ANALYSIS_INVALID",
      message: error.message,
    };
  }
  return {
    code: "PRESENTATION_AUDIO_ANALYSIS_FAILED",
    message:
      error instanceof Error ? error.message : "Presentation analysis failed.",
  };
}

function updateJob(
  dataSource: DataSource,
  jobId: string,
  status: "running" | "succeeded" | "failed",
  progress: number,
  message: string,
  result: Record<string, unknown> | null,
  error: { code: string; message: string } | null,
) {
  return dataSource
    .query(
      `UPDATE jobs SET status=$2, progress=$3, message=$4, result=$5, error=$6,
       updated_at=now() WHERE job_id=$1 RETURNING *`,
      [jobId, status, progress, message, result, error],
    )
    .then((rows) => jobRow(firstQueryRow(rows)));
}

function currentJob(dataSource: DataSource, jobId: string) {
  return dataSource
    .query(`SELECT * FROM jobs WHERE job_id=$1`, [jobId])
    .then((rows) => jobRow(firstQueryRow(rows)));
}

function jobRow(row: Record<string, unknown>): Job {
  return jobSchema.parse({
    jobId: row.job_id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    message: row.message,
    result: row.result,
    error: row.error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function toIso(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}

function firstQueryRow<T = Record<string, unknown>>(value: unknown): T {
  const first = Array.isArray(value) ? value[0] : undefined;
  return (Array.isArray(first) ? first[0] : first) as T;
}
