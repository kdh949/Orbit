import {
  completeSlidePracticeAnalysisRequestSchema,
  createSlidePracticeAnalysisRequestSchema,
  createSlidePracticeAnalysisResponseSchema,
  createSlidePracticeReportRequestSchema,
  listSlidePracticeReportsQuerySchema,
  slidePracticeContentHashVersion,
  slidePracticeAnalysisResultResponseSchema,
  slidePracticeAnalysisSchema,
  slidePracticeReportListResponseSchema,
  slidePracticeReportRecordSchema,
  upsertVoiceBaselineRequestSchema,
  voiceBaselineRecordSchema,
  slideQuestionGuideTextHashInput,
} from "@orbit/shared/slide-practice";
import { loadOrbitConfig } from "@orbit/config";
import { enqueueSlidePracticeAnalysisJob } from "@orbit/job-queue";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";
import { FilesService } from "../files/files.service";
import { JobsService } from "../jobs/jobs.service";
import { ProjectsService } from "../projects/projects.service";
import { DecksService } from "../decks/decks.service";
import { sha256Canonical } from "../practice-goals/evaluation-plan";

const practiceReportRetentionMs = 90 * 24 * 60 * 60 * 1_000;
const voiceBaselineRetentionMs = 180 * 24 * 60 * 60 * 1_000;
@Injectable()
export class SlidePracticeService {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly decks: DecksService,
    private readonly files: FilesService,
    private readonly jobs: JobsService,
    private readonly projects: ProjectsService,
    @InjectPinoLogger(SlidePracticeService.name)
    private readonly logger: PinoLogger,
  ) {}

  async createAnalysis(
    projectId: string,
    actorUserId: string,
    body: unknown,
    requestOrigin?: string | null,
  ) {
    this.assertEnabled();
    const request = createSlidePracticeAnalysisRequestSchema.parse(body);
    const existing = firstRow(await this.dataSource.query(
      `SELECT * FROM slide_practice_audio_analyses
       WHERE project_id = $1 AND created_by = $2 AND client_request_id = $3`,
      [projectId, actorUserId, request.clientRequestId],
    ));
    if (existing) {
      return createSlidePracticeAnalysisResponseSchema.parse({
        analysis: toAnalysis(existing),
        upload: null,
      });
    }
    const { deck } = await this.decks.getDeck(projectId);
    if (deck.deckId !== request.deckId) {
      throw new ConflictException({
        code: "SLIDE_PRACTICE_DECK_VERSION_MISMATCH",
        message: "The practice deck version does not match the current deck version.",
        actualDeckVersion: deck.version,
      });
    }
    const slide = deck.slides.find((candidate) => candidate.slideId === request.slideId);
    if (!slide) {
      throw new NotFoundException("Slide not found at the requested order in the current deck.");
    }
    const slideContentHash = sha256Canonical(slideQuestionGuideTextHashInput(slide));
    const hasContentHash = Boolean(request.contentHashVersion && request.slideContentHash);
    if (hasContentHash && request.slideContentHash !== slideContentHash) {
      throwSlidePracticeContentHashMismatch(slideContentHash);
    }
    if (!hasContentHash && deck.version !== request.deckVersion) {
      throw new ConflictException({
        code: "SLIDE_PRACTICE_DECK_VERSION_MISMATCH",
        message: "The practice deck version does not match the current deck version.",
        actualDeckVersion: deck.version,
      });
    }
    if (!hasContentHash && slide.order !== request.slideOrder) {
      throw new NotFoundException("Slide not found at the requested order in the current deck.");
    }
    const freshnessResolution = deck.version === request.deckVersion
      ? "exact"
      : "content-hash";
    const upload = await this.files.createUploadUrl(
      projectId,
      {
        originalName: slidePracticeAudioFileName(request.mimeType),
        mimeType: request.mimeType,
        size: request.size,
        purpose: "slide-practice-audio",
      },
      requestOrigin,
    );
    const now = new Date();
    const rows = await this.dataSource.query(
      `INSERT INTO slide_practice_audio_analyses (
        analysis_id, project_id, created_by, client_request_id, practice_session_id,
        deck_id, deck_version, slide_id, slide_order, content_hash_version,
        slide_content_hash, started_at, duration_ms,
        device_id_hash, status, audio_file_id, analysis_job_id, report_id,
        error_code, cleanup_state, raw_audio_deleted_at, raw_audio_delete_deadline_at,
        created_at, updated_at, expires_at, completed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13,'uploading',$14,NULL,NULL,
        NULL,'pending',NULL,$15,$16,$16,$17,NULL)
      RETURNING *`,
      [
        `practice_analysis_${randomUUID()}`,
        projectId,
        actorUserId,
        request.clientRequestId,
        request.practiceSessionId,
        deck.deckId,
        deck.version,
        slide.slideId,
        slide.order,
        slidePracticeContentHashVersion,
        slideContentHash,
        request.startedAt,
        request.deviceIdHash,
        upload.fileId,
        new Date(now.getTime() + 30 * 60_000).toISOString(),
        now.toISOString(),
        new Date(now.getTime() + practiceReportRetentionMs).toISOString(),
      ],
    );
    const analysis = toAnalysis(firstRow(rows)!);
    this.logger.info({
      event: "slide_practice.analysis.created",
      projectId,
      analysisId: analysis.analysisId,
      deckId: deck.deckId,
      deckVersion: deck.version,
      requestedDeckVersion: request.deckVersion,
      resolvedDeckVersion: deck.version,
      freshnessResolution,
      slideId: slide.slideId,
    }, "Slide practice analysis created.");
    return createSlidePracticeAnalysisResponseSchema.parse({ analysis, upload });
  }

  async completeAnalysis(analysisId: string, actorUserId: string, body: unknown) {
    this.assertEnabled();
    const request = completeSlidePracticeAnalysisRequestSchema.parse(body);
    const row = await this.getAnalysisRow(analysisId, actorUserId);
    await this.projects.assertCanWriteProject(String(row.project_id), actorUserId);
    if (["queued", "processing", "succeeded", "failed", "cancelled"].includes(String(row.status))) {
      return this.getAnalysis(analysisId, actorUserId);
    }
    if (row.status !== "uploading" || row.audio_file_id !== request.fileId) {
      throw new ConflictException({
        code: "INVALID_STATE_TRANSITION",
        message: "Slide practice analysis is not awaiting this audio file.",
      });
    }
    await this.files.completeUpload(String(row.project_id), { fileId: request.fileId }, "slide-practice-audio");
    const job = await this.jobs.create({
      projectId: String(row.project_id),
      type: "slide-practice-analysis",
      payload: { analysisId },
    });
    await this.dataSource.query(
      `UPDATE slide_practice_audio_analyses
       SET status = 'queued', analysis_job_id = $2, duration_ms = $3, updated_at = now()
       WHERE analysis_id = $1 AND status = 'uploading'`,
      [analysisId, job.jobId, request.durationMs],
    );
    await enqueueSlidePracticeAnalysisJob({
      driver: this.config.JOB_QUEUE_DRIVER,
      redisUrl: this.config.REDIS_URL,
      jobId: job.jobId,
      projectId: String(row.project_id),
      analysisId,
    });
    this.logger.info({
      event: "slide_practice.analysis.enqueued",
      projectId: row.project_id,
      analysisId,
      jobId: job.jobId,
    }, "Slide practice analysis enqueued.");
    return this.getAnalysis(analysisId, actorUserId);
  }

  async getAnalysis(analysisId: string, actorUserId: string) {
    this.assertEnabled();
    const row = await this.getAnalysisRow(analysisId, actorUserId);
    await this.projects.assertCanReadProject(String(row.project_id), actorUserId);
    const reportRow = row.report_id
      ? firstRow(await this.dataSource.query(
        `SELECT * FROM slide_practice_reports
         WHERE project_id = $1 AND report_id = $2 AND created_by = $3`,
        [row.project_id, row.report_id, actorUserId],
      ))
      : null;
    return slidePracticeAnalysisResultResponseSchema.parse({
      analysis: toAnalysis(row),
      report: reportRow ? toPracticeReport(reportRow) : null,
    });
  }

  async createReport(projectId: string, actorUserId: string, body: unknown) {
    this.assertEnabled();
    const request = createSlidePracticeReportRequestSchema.parse(body);
    if (request.report.projectId !== projectId) {
      throw new BadRequestException("URL projectId must match report.projectId.");
    }
    const existing = firstRow(await this.dataSource.query(
      `SELECT * FROM slide_practice_reports
       WHERE project_id = $1 AND created_by = $2 AND client_request_id = $3`,
      [projectId, actorUserId, request.clientRequestId],
    ));
    if (existing) return { report: toPracticeReport(existing) };

    if (request.report.reportVersion === 3) {
      const { deck } = await this.decks.getDeck(projectId);
      const slide = deck.deckId === request.report.deckId
        ? deck.slides.find((candidate) => candidate.slideId === request.report.slideId)
        : null;
      if (!slide || slide.order !== request.report.slideOrder) {
        throw new NotFoundException("Slide not found at the requested order in the current deck.");
      }
      const slideContentHash = sha256Canonical(slideQuestionGuideTextHashInput(slide));
      if (request.report.slideContentHash !== slideContentHash) {
        throwSlidePracticeContentHashMismatch(slideContentHash);
      }
    }

    const now = new Date();
    const reportId = `practice_report_${randomUUID()}`;
    const rows = await this.dataSource.query(
      `INSERT INTO slide_practice_reports (
        report_id, project_id, created_by, client_request_id, deck_id, deck_version,
        slide_id, slide_order, content_hash_version, slide_content_hash,
        metric_definition_version, classifier_version,
        report_json, created_at, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (project_id, created_by, client_request_id) DO NOTHING
      RETURNING *`,
      [
        reportId,
        projectId,
        actorUserId,
        request.clientRequestId,
        request.report.deckId,
        request.report.deckVersion,
        request.report.slideId,
        request.report.slideOrder,
        request.report.reportVersion === 3 ? request.report.contentHashVersion : null,
        request.report.reportVersion === 3 ? request.report.slideContentHash : null,
        request.report.metricDefinitionVersion,
        request.report.classifierVersion,
        request.report,
        now.toISOString(),
        new Date(now.getTime() + practiceReportRetentionMs).toISOString(),
      ],
    );
    const row = firstRow(rows) ?? firstRow(await this.dataSource.query(
      `SELECT * FROM slide_practice_reports
       WHERE project_id = $1 AND created_by = $2 AND client_request_id = $3`,
      [projectId, actorUserId, request.clientRequestId],
    ));
    if (!row) throw new Error("Slide practice report could not be persisted.");

    this.logger.info({
      event: "slide_practice.report.created",
      projectId,
      reportId: row.report_id,
      deckId: request.report.deckId,
      deckVersion: request.report.deckVersion,
      slideId: request.report.slideId,
      qualityState: request.report.quality.state,
    }, "Slide practice report created.");
    return { report: toPracticeReport(row) };
  }

  async listReports(
    projectId: string,
    actorUserId: string,
    rawQuery: Record<string, string | undefined>,
  ) {
    this.assertEnabled();
    const query = listSlidePracticeReportsQuerySchema.parse(rawQuery);
    const rows = await this.dataSource.query(
      `SELECT * FROM slide_practice_reports
       WHERE project_id = $1
         AND created_by = $2
         AND expires_at > now()
         AND ($3::text IS NULL OR deck_id = $3)
         AND ($4::text IS NULL OR slide_id = $4)
         AND ($5::text IS NULL OR (
           slide_content_hash = $5
           AND content_hash_version = 'slide-text-v1'
           AND metric_definition_version = 3
         ))
         AND ($6::timestamptz IS NULL OR created_at < $6)
       ORDER BY created_at DESC
       LIMIT $7`,
      [
        projectId,
        actorUserId,
        query.deckId ?? null,
        query.slideId ?? null,
        query.slideContentHash ?? null,
        query.cursor ?? null,
        query.limit + 1,
      ],
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return slidePracticeReportListResponseSchema.parse({
      reports: page.map(toPracticeReport),
      nextCursor: rows.length > query.limit && last ? toIso(last.created_at) : null,
    });
  }

  async upsertVoiceBaseline(actorUserId: string, deviceIdHash: string, body: unknown) {
    this.assertEnabled();
    const request = upsertVoiceBaselineRequestSchema.parse(body);
    if (request.deviceIdHash !== deviceIdHash) {
      throw new BadRequestException("URL deviceIdHash must match body.deviceIdHash.");
    }
    const now = new Date();
    const rows = await this.dataSource.query(
      `INSERT INTO user_voice_baselines (
        user_id, device_id_hash, baseline_version, sample_count, metrics_json,
        updated_at, expires_at
      ) VALUES ($1,$2,1,$3,$4,$5,$6)
      ON CONFLICT (user_id, device_id_hash) DO UPDATE SET
        baseline_version = 1,
        sample_count = EXCLUDED.sample_count,
        metrics_json = EXCLUDED.metrics_json,
        updated_at = EXCLUDED.updated_at,
        expires_at = EXCLUDED.expires_at
      RETURNING *`,
      [actorUserId, deviceIdHash, request.sampleCount, request.metrics, now.toISOString(), new Date(now.getTime() + voiceBaselineRetentionMs).toISOString()],
    );
    this.logger.info({
      event: "slide_practice.voice_baseline.updated",
      userId: actorUserId,
      sampleCount: request.sampleCount,
    }, "Voice baseline updated.");
    return { baseline: toVoiceBaseline(firstRow(rows)!) };
  }

  async getVoiceBaseline(actorUserId: string, deviceIdHash: string) {
    this.assertEnabled();
    const row = firstRow(await this.dataSource.query(
      `SELECT * FROM user_voice_baselines
       WHERE user_id = $1 AND device_id_hash = $2 AND expires_at > now()`,
      [actorUserId, deviceIdHash],
    ));
    if (!row) throw new NotFoundException("Voice baseline not found.");
    return { baseline: toVoiceBaseline(row) };
  }

  private assertEnabled() {
    if (!this.config.SLIDE_PRACTICE_ENABLED) {
      throw new ForbiddenException("Slide practice is not enabled.");
    }
  }

  private async getAnalysisRow(analysisId: string, actorUserId: string) {
    const row = firstRow(await this.dataSource.query(
      `SELECT * FROM slide_practice_audio_analyses
       WHERE analysis_id = $1 AND created_by = $2`,
      [analysisId, actorUserId],
    ));
    if (!row) throw new NotFoundException("Slide practice analysis not found.");
    return row;
  }
}

function toPracticeReport(row: Record<string, any>) {
  return slidePracticeReportRecordSchema.parse({
    ...row.report_json,
    reportId: row.report_id,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
  });
}

function toVoiceBaseline(row: Record<string, any>) {
  return voiceBaselineRecordSchema.parse({
    baselineVersion: row.baseline_version,
    userId: row.user_id,
    deviceIdHash: row.device_id_hash,
    sampleCount: row.sample_count,
    metrics: row.metrics_json,
    updatedAt: toIso(row.updated_at),
    expiresAt: toIso(row.expires_at),
  });
}

function toAnalysis(row: Record<string, any>) {
  return slidePracticeAnalysisSchema.parse({
    analysisId: row.analysis_id,
    projectId: row.project_id,
    practiceSessionId: row.practice_session_id,
    status: row.status,
    analysisJobId: row.analysis_job_id,
    reportId: row.report_id,
    errorCode: row.error_code,
    createdAt: toIso(row.created_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
  });
}

function slidePracticeAudioFileName(mimeType: string) {
  if (mimeType.includes("wav")) return "slide-practice.wav";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "slide-practice.m4a";
  if (mimeType.includes("ogg")) return "slide-practice.ogg";
  return "slide-practice.webm";
}

function firstRow(value: unknown): Record<string, any> | null {
  if (!Array.isArray(value)) return null;
  const first = value[0];
  return Array.isArray(first) ? (first[0] ?? null) : (first ?? null);
}

function toIso(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function throwSlidePracticeContentHashMismatch(actualSlideContentHash: string): never {
  throw new ConflictException({
    code: "SLIDE_PRACTICE_CONTENT_HASH_MISMATCH",
    message: "The slide practice content hash does not match the current slide content.",
    actualSlideContentHash,
  });
}
