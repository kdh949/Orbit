import type { StoragePort } from "@orbit/storage";
import {
  slidePracticeAnalysisJobPayloadSchema,
  slidePracticeAnalysisJobResultSchema,
} from "@orbit/shared/coaching";
import { deckPatchSchema, deckSchema } from "@orbit/shared/deck";
import { jobSchema, type Job } from "@orbit/shared/jobs";
import {
  analyzeKoreanFillers,
  buildSlidePracticeCoachingEvidence,
  classifyVoiceStyle,
  countSpokenSyllables,
  createUnmeasuredVoiceStyleResult,
  findSlidePracticeCoachingIssues,
  slidePracticeCoachingSelectionContentSchema,
  slidePracticeContentHashVersion,
  slidePracticeContentHashSchema,
  slidePracticeReportSchema,
  slidePracticeServerAudioResponseSchema,
  voiceBaselineMetricsSchema,
  type SlidePracticeCoaching,
  type SlidePracticeCoachingEvidenceCandidate,
  type SlidePracticeCoachingIssueCode,
  type SlidePracticeReport,
} from "@orbit/shared/slide-practice";
import { applyDeckPatch } from "@orbit/editor-core/patches";
import { createHash, randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { z } from "zod";

const reportRetentionMs = 90 * 24 * 60 * 60 * 1_000;

const inputRowSchema = z.object({
  analysis_id: z.string(),
  project_id: z.string(),
  created_by: z.string(),
  client_request_id: z.string(),
  practice_session_id: z.string(),
  deck_id: z.string(),
  deck_version: z.number().int().positive(),
  slide_id: z.string(),
  slide_order: z.number().int().nonnegative(),
  content_hash_version: z.literal("slide-text-v1").nullable(),
  slide_content_hash: slidePracticeContentHashSchema.nullable(),
  started_at: z.union([z.date(), z.string()]),
  duration_ms: z.number().int().positive(),
  device_id_hash: z.string().nullable(),
  status: z.enum(["queued", "processing", "succeeded", "failed", "cancelled"]),
  audio_file_id: z.string(),
  storage_key: z.string(),
  mime_type: z.string(),
  asset_status: z.literal("uploaded"),
  purpose: z.literal("slide-practice-audio"),
});

const deckCheckpointRowSchema = z.object({
  deck_json: z.unknown(),
  version: z.coerce.number().int().nonnegative(),
  patch_rows: z.unknown(),
});

const deckPatchRowSchema = z.object({
  before_version: z.coerce.number().int().nonnegative(),
  after_version: z.coerce.number().int().nonnegative(),
  source: z.enum(["user", "ai", "import", "system"]),
  operations: z.unknown(),
  created_at: z.union([z.date(), z.string().min(1)]),
});

export async function processSlidePracticeAnalysisJob(
  dataSource: DataSource,
  storage: Pick<StoragePort, "getSignedReadUrl" | "removeObject">,
  pythonWorkerUrl: string,
  rawPayload: unknown,
  onEvent?: (event: SlidePracticeAnalysisBusinessEvent) => void,
): Promise<Job> {
  const payload = slidePracticeAnalysisJobPayloadSchema.parse(rawPayload);
  const rows = await dataSource.query(
    `SELECT analyses.*, assets.storage_key, assets.mime_type,
      assets.status AS asset_status, assets.purpose
     FROM slide_practice_audio_analyses analyses
     JOIN project_assets assets
       ON assets.project_id = analyses.project_id
      AND assets.file_id = analyses.audio_file_id
     WHERE analyses.analysis_id = $1 AND analyses.project_id = $2`,
    [payload.analysisId, payload.projectId],
  );
  const row = inputRowSchema.parse(firstQueryRow(rows));
  if (row.status !== "queued") return currentJob(dataSource, payload.jobId);

  await updateJob(dataSource, payload.jobId, "running", 10, "슬라이드 연습 분석 준비 중", null, null);
  await dataSource.query(
    `UPDATE slide_practice_audio_analyses
     SET status = 'processing', updated_at = now()
     WHERE analysis_id = $1 AND status = 'queued'`,
    [payload.analysisId],
  );

  let cleanup: Awaited<ReturnType<typeof deleteRawAudio>> | null = null;
  try {
    let storageUrl: string;
    try {
      storageUrl = await storage.getSignedReadUrl(row.storage_key);
    } catch {
      throw new SlidePracticeProcessingError("AUDIO_ANALYSIS_FAILED");
    }
    let response: Response;
    try {
      response = await fetch(new URL("/slide-practice/analyze-audio", pythonWorkerUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: payload.analysisId,
          projectId: payload.projectId,
          audio: {
            fileId: row.audio_file_id,
            storageUrl,
            mimeType: row.mime_type,
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new SlidePracticeProcessingError("TRANSCRIPTION_FAILED");
    }
    if (!response.ok) throw new SlidePracticeProcessingError("TRANSCRIPTION_FAILED");
    let evidence: z.infer<typeof slidePracticeServerAudioResponseSchema>;
    try {
      evidence = slidePracticeServerAudioResponseSchema.parse(await response.json());
    } catch {
      throw new SlidePracticeProcessingError("AUDIO_ANALYSIS_FAILED");
    }
    cleanup = await deleteRawAudio(dataSource, storage, row);
    const syllableCount = countSpokenSyllables(evidence.transcript);
    const fillers = analyzeKoreanFillers(evidence.transcript);
    const voice = {
      ...evidence.voice,
      syllablesPerSecond: evidence.voice.activeSpeechMs >= 1_000
        ? syllableCount / (evidence.voice.activeSpeechMs / 1_000)
        : null,
    };
    const baselineRow = row.device_id_hash
      ? firstQueryRowOrNull(await dataSource.query(
        `SELECT baseline_version, metrics_json FROM user_voice_baselines
         WHERE user_id = $1 AND device_id_hash = $2 AND expires_at > now()`,
        [row.created_by, row.device_id_hash],
      ))
      : null;
    const baseline = baselineRow ? voiceBaselineMetricsSchema.parse(baselineRow.metrics_json) : null;
    const baselineVersion = baselineRow ? Number(baselineRow.baseline_version) : null;
    const qualityReasons: SlidePracticeReport["quality"]["reasons"] = [];
    if (syllableCount < 5 || row.duration_ms < 3_000 || voice.activeSpeechMs < 1_000) {
      qualityReasons.push("insufficient-speech");
    }
    if (voice.loudnessDb === null) qualityReasons.push("audio-analysis-unavailable");
    if (voice.pitchMedianHz === null) qualityReasons.push("pitch-unavailable");
    const qualityState = qualityReasons.includes("insufficient-speech")
      ? "unmeasured"
      : qualityReasons.length > 0 ? "partial" : "measured";
    const reportVersionFields = row.content_hash_version && row.slide_content_hash
      ? {
          reportVersion: 3 as const,
          metricDefinitionVersion: 3 as const,
          contentHashVersion: row.content_hash_version,
          slideContentHash: row.slide_content_hash,
        }
      : {
          reportVersion: 2 as const,
          metricDefinitionVersion: 2 as const,
        };
    const reportWithoutCoaching = slidePracticeReportSchema.parse({
      ...reportVersionFields,
      classifierVersion: 4,
      practiceSessionId: row.practice_session_id,
      projectId: row.project_id,
      deckId: row.deck_id,
      deckVersion: row.deck_version,
      slideId: row.slide_id,
      slideOrder: row.slide_order,
      startedAt: toIso(row.started_at),
      durationMs: row.duration_ms,
      syllableCount,
      meanRecognitionConfidence: evidence.meanRecognitionConfidence,
      fillers: {
        policyVersion: 1,
        totalCount: fillers.totalCount,
        details: fillers.details,
      },
      voice,
      loudnessSamples: evidence.loudnessSamples,
      speedSamples: evidence.speedSamples,
      style: qualityState === "unmeasured"
        ? createUnmeasuredVoiceStyleResult()
        : classifyVoiceStyle(voice, baseline),
      quality: { state: qualityState, reasons: Array.from(new Set(qualityReasons)) },
      source: {
        kind: "server",
        sttEngine: "report-stt",
        deviceIdHash: row.device_id_hash,
        baselineVersion,
      },
    });
    const coachingStartedAt = Date.now();
    const issueCodes = findSlidePracticeCoachingIssues(reportWithoutCoaching);
    const speakerNotes = issueCodes.length > 0
      ? await loadSpeakerNotes(dataSource, row).catch(() => "")
      : "";
    const evidenceCandidates = buildSlidePracticeCoachingEvidence({
      speakerNotes,
      transcriptSegments: evidence.transcriptSegments,
      pauseSegments: evidence.pauseSegments,
      loudnessSamples: evidence.loudnessSamples,
      voice,
      issueCodes,
    });
    const coaching = await createSlidePracticeCoaching({
      pythonWorkerUrl,
      speakerNotes,
      issueCodes,
      evidenceCandidates,
      report: reportWithoutCoaching,
    });
    emitBusinessEvent(onEvent, {
      event: "slide_practice.coaching.completed",
      jobId: payload.jobId,
      projectId: payload.projectId,
      analysisId: payload.analysisId,
      status: coaching.status,
      issueCodes,
      durationMs: Math.max(0, Date.now() - coachingStartedAt),
    });
    const report = slidePracticeReportSchema.parse({
      ...reportWithoutCoaching,
      coaching,
    });
    const reportId = await persistDerivedReport(dataSource, row, report);
    await dataSource.query(
      `UPDATE slide_practice_audio_analyses
       SET status = 'succeeded', report_id = $2, cleanup_state = $3,
           raw_audio_deleted_at = $4, updated_at = now(), completed_at = now()
       WHERE analysis_id = $1 AND status = 'processing'`,
      [payload.analysisId, reportId, cleanup.state, cleanup.deletedAt],
    );
    const result = slidePracticeAnalysisJobResultSchema.parse({
      analysisId: payload.analysisId,
      reportId,
    });
    return updateJob(dataSource, payload.jobId, "succeeded", 100, "슬라이드 연습 분석 완료", result, null);
  } catch (error) {
    const code = error instanceof SlidePracticeProcessingError
      ? error.code
      : error instanceof z.ZodError
        ? "AUDIO_ANALYSIS_FAILED"
        : "REPORT_PERSIST_FAILED";
    cleanup ??= await deleteRawAudio(dataSource, storage, row);
    await dataSource.query(
      `UPDATE slide_practice_audio_analyses
       SET status = 'failed', error_code = $2, cleanup_state = $3,
           raw_audio_deleted_at = $4, updated_at = now(), completed_at = now()
       WHERE analysis_id = $1 AND status IN ('queued','processing')`,
      [payload.analysisId, code, cleanup.state, cleanup.deletedAt],
    );
    return updateJob(dataSource, payload.jobId, "failed", 100, "슬라이드 연습 분석 실패", null, {
      code,
      message: "Slide practice analysis failed.",
    });
  }
}

async function createSlidePracticeCoaching(input: {
  pythonWorkerUrl: string;
  speakerNotes: string;
  issueCodes: SlidePracticeCoachingIssueCode[];
  evidenceCandidates: SlidePracticeCoachingEvidenceCandidate[];
  report: SlidePracticeReport;
}): Promise<SlidePracticeCoaching> {
  if (input.issueCodes.length === 0) {
    return input.report.quality.state === "measured"
      ? {
          status: "not-needed",
          summary: "정말 잘했어요 개선점이 없어요!!",
          issueCodes: [],
          items: [],
          practicePlan: null,
          model: null,
          policyVersion: 1,
          promptVersion: 2,
          generatedAt: null,
        }
      : unavailableCoaching(
          "측정 데이터가 부족해 개선점을 생성하지 못했습니다.",
          [],
        );
  }

  if (input.evidenceCandidates.length === 0) {
    return unavailableCoaching(
      "대본과 측정 구간을 안전하게 연결하지 못해 개선점을 생성하지 않았습니다.",
      input.issueCodes,
    );
  }

  try {
    const response = await fetch(
      new URL("/slide-practice/coaching", input.pythonWorkerUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          speakerNotes: input.speakerNotes,
          issueCodes: input.issueCodes,
          metrics: {
            fillerDetails: input.report.fillers.details,
            fillerTotalCount: input.report.fillers.totalCount,
            syllablesPerSecond: input.report.voice.syllablesPerSecond,
            pauseRatio: input.report.voice.pauseRatio,
            pitchSpanHz: input.report.voice.pitchSpanHz,
            loudnessDb: input.report.voice.loudnessDb,
            loudnessVariationDb: input.report.voice.loudnessMadDb,
            rhythmRegularity: input.report.voice.rhythmRegularity,
          },
          evidenceCandidates: input.evidenceCandidates,
        }),
      },
    );
    if (!response.ok) {
      return unavailableCoaching(
        "AI 개선점을 생성하지 못했습니다. 그래프와 측정 결과는 정상적으로 확인할 수 있습니다.",
        input.issueCodes,
      );
    }
    const generated = slidePracticeCoachingSelectionContentSchema.parse(await response.json());
    const selectedEvidence = input.evidenceCandidates.find(
      (candidate) => candidate.evidenceId === generated.item.evidenceId,
    );
    if (
      !selectedEvidence
      || !input.speakerNotes.includes(selectedEvidence.originalText)
      || !selectedEvidence.issueCodes.some(
        (issueCode) => coachingCategory(issueCode) === generated.item.category,
      )
    ) {
      return unavailableCoaching(
        "AI 개선점의 대본 근거를 확인하지 못했습니다. 그래프와 측정 결과는 정상적으로 확인할 수 있습니다.",
        input.issueCodes,
      );
    }
    const { evidenceId: _evidenceId, ...scriptEvidence } = selectedEvidence;
    return {
      status: "succeeded",
      summary: generated.summary,
      issueCodes: input.issueCodes,
      items: [{
        category: generated.item.category,
        title: generated.item.title,
        reason: generated.item.reason,
        action: generated.item.action,
        practiceTip: generated.item.practiceTip,
        scriptEdit: null,
        scriptEvidence,
      }],
      practicePlan: null,
      model: generated.model,
      policyVersion: 1,
      promptVersion: 2,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return unavailableCoaching(
      "AI 개선점을 생성하지 못했습니다. 그래프와 측정 결과는 정상적으로 확인할 수 있습니다.",
      input.issueCodes,
    );
  }
}

function unavailableCoaching(
  summary: string,
  issueCodes: SlidePracticeCoachingIssueCode[],
): SlidePracticeCoaching {
  return {
    status: "unavailable",
    summary,
    issueCodes,
    items: [],
    practicePlan: null,
    model: null,
    policyVersion: 1,
    promptVersion: 2,
    generatedAt: null,
  };
}

function coachingCategory(issueCode: SlidePracticeCoachingIssueCode) {
  switch (issueCode) {
    case "filler-use":
      return "filler";
    case "pace-slow":
    case "pace-fast":
      return "pace";
    case "pause-low":
    case "pause-high":
      return "pause";
    case "pitch-flat":
    case "pitch-wide":
      return "pitch";
    case "loudness-low":
    case "loudness-high":
    case "loudness-unstable":
      return "loudness";
  }
}

async function loadSpeakerNotes(
  dataSource: DataSource,
  row: z.infer<typeof inputRowSchema>,
) {
  const rows = await dataSource.query(
    `SELECT
       d.deck_json,
       d.version,
       COALESCE((
         SELECT jsonb_agg(
           jsonb_build_object(
             'before_version', p.before_version,
             'after_version', p.after_version,
             'source', p.source,
             'operations', p.operations,
             'created_at', p.created_at
           ) ORDER BY p.after_version ASC, p.created_at ASC, p.change_id ASC
         )
         FROM deck_patches p
         WHERE p.project_id = d.project_id
           AND p.deck_id = d.deck_id
           AND p.after_version > d.version
           AND p.after_version <= $3
       ), '[]'::jsonb) AS patch_rows
     FROM decks d
     WHERE d.project_id = $1 AND d.deck_id = $2`,
    [row.project_id, row.deck_id, row.deck_version],
  );
  const rawDeckRow = firstQueryRowOrNull(rows);
  if (!rawDeckRow) return "";
  const deckRow = deckCheckpointRowSchema.parse(rawDeckRow);
  if (deckRow.version > row.deck_version) return "";
  let deck = deckSchema.parse(jsonValue(deckRow.deck_json));
  if (deck.version !== deckRow.version) return "";

  const patchRows = z.array(deckPatchRowSchema).parse(jsonValue(deckRow.patch_rows));
  for (const patchRow of patchRows) {
    if (
      patchRow.before_version !== deck.version
      || patchRow.after_version !== patchRow.before_version + 1
    ) {
      return "";
    }
    const patch = deckPatchSchema.parse({
      deckId: deck.deckId,
      baseVersion: patchRow.before_version,
      source: patchRow.source,
      operations: jsonValue(patchRow.operations),
    });
    const applied = applyDeckPatch(deck, patch, {
      createdAt: toIso(patchRow.created_at),
    });
    if (!applied.ok || applied.deck.version !== patchRow.after_version) return "";
    deck = applied.deck;
  }
  if (deck.version !== row.deck_version) return "";
  return deck.slides.find((slide) => slide.slideId === row.slide_id)
    ?.speakerNotes.slice(0, 6_000) ?? "";
}

export type SlidePracticeAnalysisBusinessEvent = {
  event: "slide_practice.coaching.completed";
  jobId: string;
  projectId: string;
  analysisId: string;
  status: SlidePracticeCoaching["status"];
  issueCodes: SlidePracticeCoachingIssueCode[];
  durationMs: number;
};

function emitBusinessEvent(
  onEvent: ((event: SlidePracticeAnalysisBusinessEvent) => void) | undefined,
  event: SlidePracticeAnalysisBusinessEvent,
) {
  try {
    onEvent?.(event);
  } catch {
    // Diagnostic logging must not change slide practice analysis behavior.
  }
}

async function persistDerivedReport(
  dataSource: DataSource,
  row: z.infer<typeof inputRowSchema>,
  report: SlidePracticeReport,
) {
  const existing = firstQueryRowOrNull(await dataSource.query(
    `SELECT report_id FROM slide_practice_reports
     WHERE project_id = $1 AND created_by = $2 AND client_request_id = $3`,
    [row.project_id, row.created_by, row.client_request_id],
  ));
  if (existing) return String(existing.report_id);

  const reportId = `practice_report_${randomUUID()}`;
  const now = new Date();
  const rows = await dataSource.query(
    `INSERT INTO slide_practice_reports (
      report_id, project_id, created_by, client_request_id, deck_id, deck_version,
      slide_id, slide_order, content_hash_version, slide_content_hash,
      metric_definition_version, classifier_version,
      report_json, created_at, expires_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (project_id, created_by, client_request_id) DO NOTHING
    RETURNING report_id`,
    [
      reportId,
      row.project_id,
      row.created_by,
      row.client_request_id,
      row.deck_id,
      row.deck_version,
      row.slide_id,
      row.slide_order,
      report.reportVersion === 3 ? slidePracticeContentHashVersion : null,
      report.reportVersion === 3 ? report.slideContentHash : null,
      report.metricDefinitionVersion,
      report.classifierVersion,
      report,
      now.toISOString(),
      new Date(now.getTime() + reportRetentionMs).toISOString(),
    ],
  );
  const inserted = firstQueryRowOrNull(rows);
  if (inserted) return String(inserted.report_id);
  const conflicted = firstQueryRowOrNull(await dataSource.query(
    `SELECT report_id FROM slide_practice_reports
     WHERE project_id = $1 AND created_by = $2 AND client_request_id = $3`,
    [row.project_id, row.created_by, row.client_request_id],
  ));
  if (!conflicted) throw new SlidePracticeProcessingError("REPORT_PERSIST_FAILED");
  return String(conflicted.report_id);
}

async function deleteRawAudio(
  dataSource: DataSource,
  storage: Pick<StoragePort, "removeObject">,
  row: z.infer<typeof inputRowSchema>,
) {
  try {
    await storage.removeObject(row.storage_key);
    const deletedAt = new Date().toISOString();
    await dataSource.query(
      `UPDATE project_assets SET status = 'deleted', deleted_at = $3
       WHERE project_id = $1 AND file_id = $2`,
      [row.project_id, row.audio_file_id, deletedAt],
    );
    return { state: "deleted", deletedAt } as const;
  } catch {
    await scheduleRawAudioDeletion(dataSource, row);
    return { state: "pending", deletedAt: null } as const;
  }
}

async function scheduleRawAudioDeletion(
  dataSource: DataSource,
  row: z.infer<typeof inputRowSchema>,
) {
  const now = new Date().toISOString();
  const storageKeyHash = createHash("sha256").update(row.storage_key).digest("hex");
  await dataSource.query(
    `INSERT INTO storage_deletion_outbox (
      deletion_id, project_id, file_id, storage_key, storage_key_hash,
      purpose, status, attempt_count, next_attempt_at, created_at
    ) VALUES ($1,$2,$3,$4,$5,'slide-practice-audio','pending',0,$6,$6)
    ON CONFLICT (storage_key_hash) DO NOTHING`,
    [`deletion_${storageKeyHash.slice(0, 32)}`, row.project_id, row.audio_file_id, row.storage_key, storageKeyHash, now],
  );
}

class SlidePracticeProcessingError extends Error {
  constructor(readonly code: "TRANSCRIPTION_FAILED" | "AUDIO_ANALYSIS_FAILED" | "REPORT_PERSIST_FAILED") {
    super(code);
  }
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
  return dataSource.query(
    `UPDATE jobs SET status=$2, progress=$3, message=$4, result=$5, error=$6,
     updated_at=now() WHERE job_id=$1 RETURNING *`,
    [jobId, status, progress, message, result, error],
  ).then((rows) => jobRow(firstQueryRow(rows)));
}

function currentJob(dataSource: DataSource, jobId: string) {
  return dataSource.query(`SELECT * FROM jobs WHERE job_id=$1`, [jobId])
    .then((rows) => jobRow(firstQueryRow(rows)));
}

function jobRow(row: any): Job {
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
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function jsonValue(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function firstQueryRow<T = any>(value: unknown): T {
  const first = Array.isArray(value) ? value[0] : undefined;
  return (Array.isArray(first) ? first[0] : first) as T;
}

function firstQueryRowOrNull<T = any>(value: unknown): T | null {
  const row = firstQueryRow<T | undefined>(value);
  return row ?? null;
}
