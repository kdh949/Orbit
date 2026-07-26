import {
  coachingIdSchema,
  completeFocusedPracticeAudioRequestSchema,
  createFocusedPracticeAttemptRequestSchema,
  createFocusedPracticeSessionRequestSchema,
  focusedPracticeAttemptSchema,
  focusedPracticeAttemptSummarySchema,
  focusedPracticeSessionSchema,
  type FocusedPracticeAttempt,
  type FocusedPracticeSession,
} from "@orbit/shared/coaching";
import { deckSchema, type Deck } from "@orbit/shared/deck";
import { createAssetUploadUrlRequestSchema } from "@orbit/shared/files";
import {
  rehearsalEvaluationSnapshotSchema,
  type RehearsalEvaluationSnapshot,
} from "@orbit/shared/rehearsals";
import { enqueueFocusedPracticeAnalysisJob } from "@orbit/job-queue";
import { isAdaptiveCoachingProjectAllowed, loadOrbitConfig } from "@orbit/config";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";

import { FilesService } from "../files/files.service";
import { JobsService } from "../jobs/jobs.service";
import { ProjectsService } from "../projects/projects.service";
import {
  assertFocusedPracticeTimeline,
  FocusedPracticeTargetValidationError,
  resolveFocusedPracticeTarget,
  type FocusedPracticeTargetResolution,
} from "./focused-practice-target";

@Injectable()
export class FocusedPracticeService {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });
  private readonly focusedPracticeAudioUploadRequestSchema = createAssetUploadUrlRequestSchema({
    maxRehearsalAudioUploadSizeBytes: this.config.REHEARSAL_AUDIO_MAX_BYTES,
    allowedPrivatePurpose: "focused-practice-audio"
  });

  constructor(
    private readonly dataSource: DataSource,
    private readonly projects: ProjectsService,
    private readonly files: FilesService,
    private readonly jobs: JobsService,
    @Optional()
    @InjectPinoLogger(FocusedPracticeService.name)
    private readonly logger?: PinoLogger,
  ) {}

  async createSession(projectId: string, actorUserId: string, body: unknown) {
    const request = createFocusedPracticeSessionRequestSchema.parse(body);
    await this.projects.assertCanWriteProject(projectId, actorUserId);
    if (!this.config.ADAPTIVE_REHEARSAL_COACH_ENABLED || !this.config.FOCUSED_PRACTICE_ENABLED || !isAdaptiveCoachingProjectAllowed(this.config, projectId)) {
      throw new ForbiddenException("Focused practice is not enabled for this project.");
    }
    return this.dataSource.transaction(async (manager) => {
      const existing = first(await manager.query(
        `SELECT * FROM focused_practice_sessions WHERE project_id = $1 AND client_request_id = $2`,
        [projectId, request.clientRequestId],
      ));
      if (existing) return { session: toSession(existing) };
      const resumeLockKey = [
        projectId,
        actorUserId,
        request.sourceFullRunId,
        request.sourceGoalSetId,
        [...request.goalIds].sort().join(","),
        canonical(request.targetScope),
      ].join(":");
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [resumeLockKey],
      );
      const rows = await manager.query(
        `
          SELECT runs.deck_id, runs.evaluation_snapshot_json, sets.analysis_state,
                 sets.goal_set_id, sets.revision AS goal_set_revision,
                 json_agg(goals ORDER BY goals.priority) AS goals
          FROM rehearsal_runs runs
          JOIN practice_goal_sets sets ON sets.project_id = runs.project_id
            AND sets.goal_set_id = $3 AND sets.source_full_run_id = runs.run_id
          JOIN practice_goals goals ON goals.project_id = sets.project_id
            AND goals.goal_set_id = sets.goal_set_id AND goals.goal_id = ANY($4::text[])
          WHERE runs.project_id = $1 AND runs.run_id = $2 AND runs.status = 'succeeded'
          GROUP BY runs.deck_id, runs.evaluation_snapshot_json, sets.analysis_state,
                   sets.goal_set_id, sets.revision
        `,
        [projectId, request.sourceFullRunId, request.sourceGoalSetId, request.goalIds],
      );
      const source = first(rows);
      const goals = Array.isArray(source?.goals) ? source.goals as Record<string, unknown>[] : [];
      if (!source || source.analysis_state !== "final" || goals.length !== request.goalIds.length) {
        throw new ConflictException({ code: "SOURCE_INCOMPATIBLE", message: "Focused practice source is not current and final." });
      }
      for (const goal of goals) {
        if (canonical(goal.target_scope_json) !== canonical(request.targetScope) || goal.measurement_state !== "measured") {
          throw new BadRequestException("Focused practice goals must share the requested measured target scope.");
        }
      }
      const snapshotResult = rehearsalEvaluationSnapshotSchema.safeParse(source.evaluation_snapshot_json);
      if (!snapshotResult.success) {
        throw new ConflictException({ code: "SOURCE_INCOMPATIBLE", message: "Evaluation snapshot is unavailable." });
      }
      const snapshot = snapshotResult.data;
      const plan = snapshot.evaluationPlan;
      if (!plan) throw new ConflictException({ code: "SOURCE_INCOMPATIBLE", message: "Evaluation plan is unavailable." });
      const deckRow = first(await manager.query(
        `SELECT deck_json FROM decks WHERE project_id = $1 AND deck_id = $2`,
        [projectId, source.deck_id],
      ));
      const deckResult = deckSchema.safeParse(deckRow?.deck_json);
      const targetResolution = resolveTargetOrBadRequest(
        request.targetScope,
        snapshot,
        deckResult.success ? deckResult.data : null,
      );
      if (targetResolution.compatibilityState === "current") {
        const resumable = first(await manager.query(
          `SELECT * FROM focused_practice_sessions
           WHERE project_id = $1
             AND created_by = $2
             AND source_full_run_id = $3
             AND source_goal_set_id = $4
             AND goal_ids_json @> $5::jsonb
             AND goal_ids_json <@ $5::jsonb
             AND target_scope_json = $6::jsonb
             AND status = 'active'
             AND compatibility_state = 'current'
           ORDER BY created_at DESC
           LIMIT 1`,
          [projectId, actorUserId, request.sourceFullRunId, request.sourceGoalSetId,
            JSON.stringify(request.goalIds), JSON.stringify(request.targetScope)],
        ));
        if (resumable) return { session: toSession(resumable) };
      }
      const now = new Date().toISOString();
      const session = focusedPracticeSessionSchema.parse({
        practiceSessionId: `practice_${randomUUID()}`,
        projectId,
        deckId: source.deck_id,
        sourceFullRunId: request.sourceFullRunId,
        sourceGoalSetId: request.sourceGoalSetId,
        goalIds: request.goalIds,
        targetScope: request.targetScope,
        snapshot: {
          deckVersion: snapshot.deckVersion,
          goalSetRef: {
            goalSetId: source.goal_set_id,
            revision: source.goal_set_revision,
          },
          briefRef: plan.briefRef,
          evaluatorLensRef: plan.evaluatorLensRef,
          criterionRefs: goals.map((goal) => goal.criterion_ref_json),
        },
        compatibilityState: targetResolution.compatibilityState,
        status: "active",
        dataOrigin: "live",
        createdBy: actorUserId,
        createdAt: now,
        completedAt: null,
      });
      const inserted = await manager.query(
        `INSERT INTO focused_practice_sessions (
          practice_session_id, project_id, deck_id, source_full_run_id, source_goal_set_id,
          client_request_id, goal_ids_json, target_scope_json, snapshot_json,
          compatibility_state, status, data_origin, created_by, created_at, completed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (project_id, client_request_id) DO NOTHING
        RETURNING practice_session_id`,
        [session.practiceSessionId, projectId, session.deckId, session.sourceFullRunId,
          session.sourceGoalSetId, request.clientRequestId, JSON.stringify(session.goalIds), session.targetScope,
          session.snapshot, session.compatibilityState, session.status, session.dataOrigin,
          session.createdBy, session.createdAt, null],
      );
      if (first(inserted)) return { session };
      const concurrent = first(await manager.query(
        `SELECT * FROM focused_practice_sessions WHERE project_id = $1 AND client_request_id = $2`,
        [projectId, request.clientRequestId],
      ));
      if (!concurrent) throw new ConflictException("Focused practice session could not be created.");
      return { session: toSession(concurrent) };
    });
  }

  async getSession(sessionId: string, actorUserId: string) {
    const storedRow = await this.getSessionRow(sessionId);
    await this.projects.assertCanReadProject(String(storedRow.project_id), actorUserId);
    const { row } = await this.refreshSessionCompatibility(storedRow);
    const attempts = (await this.dataSource.query(
      `SELECT * FROM focused_practice_attempts WHERE practice_session_id = $1 ORDER BY attempt_number ASC`,
      [sessionId],
    )).map(toAttempt);
    return { session: toSession(row), attempts, stabilization: deriveStabilization(attempts) };
  }

  async getAttemptSummary(projectId: string, sourceFullRunId: string, actorUserId: string) {
    const validatedRunId = coachingIdSchema.parse(sourceFullRunId);
    await this.projects.assertCanReadProject(projectId, actorUserId);
    const rows = await this.dataSource.query(
      `SELECT goals.goal_id,
              COUNT(attempts.attempt_id) FILTER (
                WHERE attempts.status = 'succeeded'
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(attempts.goal_outcomes_json, '[]'::jsonb)) outcome
                    WHERE outcome->>'goalId' = goals.goal_id
                      AND outcome->>'outcome' = 'passed'
                  )
              )::int AS passed_count
       FROM practice_goal_heads heads
       JOIN practice_goal_sets sets
         ON sets.project_id = heads.project_id
        AND sets.goal_set_id = heads.current_goal_set_id
       JOIN practice_goals goals
         ON goals.project_id = sets.project_id
        AND goals.goal_set_id = sets.goal_set_id
       LEFT JOIN focused_practice_sessions sessions
         ON sessions.project_id = goals.project_id
        AND sessions.source_full_run_id = sets.source_full_run_id
        AND sessions.source_goal_set_id = sets.goal_set_id
        AND sessions.created_by = $3
        AND sessions.goal_ids_json @> jsonb_build_array(goals.goal_id)
       LEFT JOIN focused_practice_attempts attempts
         ON attempts.project_id = sessions.project_id
        AND attempts.practice_session_id = sessions.practice_session_id
       WHERE heads.project_id = $1
         AND heads.source_full_run_id = $2
       GROUP BY goals.goal_id, goals.priority
       ORDER BY goals.priority ASC`,
      [projectId, validatedRunId, actorUserId],
    );
    return focusedPracticeAttemptSummarySchema.parse({
      sourceFullRunId: validatedRunId,
      goals: (Array.isArray(rows) ? rows : []).map((row) => ({
        goalId: row.goal_id,
        passedCount: Number(row.passed_count),
      })),
    });
  }

  async createAttempt(sessionId: string, actorUserId: string, body: unknown) {
    const request = createFocusedPracticeAttemptRequestSchema.parse(body);
    const storedRow = await this.getSessionRow(sessionId);
    const projectId = String(storedRow.project_id);
    await this.projects.assertCanWriteProject(projectId, actorUserId);
    const { row: sessionRow } = await this.refreshSessionCompatibility(storedRow);
    if (sessionRow.status !== "active" || sessionRow.compatibility_state !== "current") {
      throw new ConflictException({ code: "INVALID_STATE_TRANSITION", message: "Focused practice session is not active." });
    }
    const existing = first(await this.dataSource.query(
      `SELECT * FROM focused_practice_attempts WHERE practice_session_id = $1 AND client_request_id = $2`,
      [sessionId, request.clientRequestId],
    ));
    if (existing) return { attempt: toAttempt(existing), upload: null };
    const upload = await this.files.createUploadUrl(projectId, this.focusedPracticeAudioUploadRequestSchema.parse({
      originalName: focusedPracticeAudioFileName(request.mimeType),
      mimeType: request.mimeType,
      size: request.size,
      purpose: "focused-practice-audio",
    }));
    const now = new Date();
    const rows = await this.dataSource.query(
      `INSERT INTO focused_practice_attempts (
        attempt_id, project_id, practice_session_id, client_request_id, attempt_number,
        status, result, audio_file_id, analysis_job_id, cleanup_state, cleanup_generation,
        raw_audio_deleted_at, raw_audio_delete_deadline_at, duration_ms,
        slide_timeline_json, goal_outcomes_json, error_code, created_at, completed_at
      ) SELECT $1,$2,$3,$4,COALESCE(MAX(attempt_number),0)+1,'uploading',NULL,$5,NULL,
        'pending',1,NULL,$6,NULL,'[]'::jsonb,'[]'::jsonb,NULL,$7,NULL
        FROM focused_practice_attempts WHERE practice_session_id = $3 RETURNING *`,
      [`attempt_${randomUUID()}`, projectId, sessionId, request.clientRequestId,
        upload.fileId, new Date(now.getTime() + 30 * 60_000).toISOString(), now.toISOString()],
    );
    return { attempt: toAttempt(first(rows)!), upload };
  }

  async completeAttempt(attemptId: string, actorUserId: string, body: unknown) {
    const request = completeFocusedPracticeAudioRequestSchema.parse(body);
    const attempt = await this.getAttemptRow(attemptId);
    await this.projects.assertCanWriteProject(String(attempt.project_id), actorUserId);
    if (attempt.status === "queued" || attempt.status === "processing" || ["succeeded", "failed", "cancelled"].includes(String(attempt.status))) {
      return { attempt: toAttempt(attempt) };
    }
    if (attempt.status !== "uploading" || attempt.audio_file_id !== request.fileId) {
      throw new ConflictException({ code: "INVALID_STATE_TRANSITION", message: "Attempt is not awaiting this audio file." });
    }
    const refreshed = await this.refreshSessionCompatibility(
      await this.getSessionRow(String(attempt.practice_session_id)),
    );
    if (refreshed.row.compatibility_state !== "current" || !refreshed.resolution) {
      throw new ConflictException({ code: "INVALID_STATE_TRANSITION", message: "Focused practice target is stale." });
    }
    validateTimeline(request.slideTimeline, request.durationMs);
    try {
      assertFocusedPracticeTimeline(
        toSession(refreshed.row).targetScope,
        refreshed.resolution,
        request.slideTimeline,
      );
    } catch (error) {
      if (error instanceof FocusedPracticeTargetValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    await this.files.completeUpload(String(attempt.project_id), { fileId: request.fileId }, "focused-practice-audio");
    const job = await this.jobs.create({
      projectId: String(attempt.project_id),
      type: "focused-practice-analysis",
      payload: { practiceSessionId: attempt.practice_session_id, attemptId, audioFileId: request.fileId },
    });
    const rows = await this.dataSource.query(
      `UPDATE focused_practice_attempts SET status = 'queued', analysis_job_id = $2,
        duration_ms = $3, slide_timeline_json = $4 WHERE attempt_id = $1 AND status = 'uploading' RETURNING *`,
      [attemptId, job.jobId, request.durationMs, JSON.stringify(request.slideTimeline)],
    );
    try {
      await enqueueFocusedPracticeAnalysisJob({
        driver: this.config.JOB_QUEUE_DRIVER,
        redisUrl: this.config.REDIS_URL,
        jobId: job.jobId,
        projectId: String(attempt.project_id),
        practiceSessionId: String(attempt.practice_session_id),
        attemptId,
        audioFileId: request.fileId,
      });
      this.logger?.info({ event: "job.enqueued", jobId: job.jobId, jobType: job.type, projectId: String(attempt.project_id) }, "Focused practice analysis job enqueued.");
    } catch (error) {
      let rawAudioDeletedAt: string | null = null;
      let cleanupState: "deleted" | "pending" = "pending";
      let cleanupError: unknown;
      try {
        rawAudioDeletedAt = await this.files.deleteUploadedAsset(String(attempt.project_id), request.fileId, "focused-practice-audio");
        cleanupState = "deleted";
      } catch (caughtCleanupError) {
        cleanupError = caughtCleanupError;
      }
      await Promise.all([
        this.jobs.update(job.jobId, {
          status: "failed", progress: 0, message: "Focused practice analysis enqueue failed.",
          error: { code: "FOCUSED_PRACTICE_ANALYSIS_ENQUEUE_FAILED", message: "Focused practice analysis enqueue failed." },
        }),
        this.dataSource.query(`UPDATE focused_practice_attempts SET status='failed',error_code='PROVIDER_UNAVAILABLE',
          cleanup_state=$2,raw_audio_deleted_at=$3,raw_audio_delete_deadline_at=CASE WHEN $2='deleted' THEN NULL ELSE raw_audio_delete_deadline_at END,completed_at=now()
          WHERE attempt_id=$1 AND analysis_job_id=$4 AND status='queued'`, [attemptId, cleanupState, rawAudioDeletedAt, job.jobId]),
      ]);
      this.logger?.error({ event: "job.enqueue_failed", jobId: job.jobId, jobType: job.type, projectId: String(attempt.project_id), errorName: error instanceof Error ? error.name : "UnknownError", cleanupErrorName: cleanupError instanceof Error ? cleanupError.name : cleanupError ? "UnknownError" : undefined }, "Focused practice analysis enqueue failed.");
      throw error;
    }
    return { attempt: toAttempt(first(rows)!), job };
  }

  async finishSession(sessionId: string, actorUserId: string, status: "completed" | "cancelled") {
    const row = await this.getSessionRow(sessionId);
    await this.projects.assertCanWriteProject(String(row.project_id), actorUserId);
    const rows = await this.dataSource.query(
      `UPDATE focused_practice_sessions SET status = $2, completed_at = now()
       WHERE practice_session_id = $1 AND status = 'active' RETURNING *`,
      [sessionId, status],
    );
    const updated = first(rows);
    if (!updated) throw new ConflictException({ code: "INVALID_STATE_TRANSITION", message: "Session is already terminal." });
    return { session: toSession(updated) };
  }

  private async getSessionRow(sessionId: string) {
    const row = first(await this.dataSource.query(`SELECT * FROM focused_practice_sessions WHERE practice_session_id = $1`, [sessionId]));
    if (!row) throw new NotFoundException("Focused practice session not found.");
    return row;
  }

  private async refreshSessionCompatibility(
    row: Record<string, any>,
    executor: QueryExecutor = this.dataSource,
  ): Promise<{ row: Record<string, any>; resolution: FocusedPracticeTargetResolution | null }> {
    if (row.compatibility_state !== "current") return { row, resolution: null };

    const source = first(await executor.query(
      `SELECT runs.evaluation_snapshot_json, decks.deck_json
       FROM rehearsal_runs runs
       LEFT JOIN decks ON decks.project_id = runs.project_id AND decks.deck_id = runs.deck_id
       WHERE runs.project_id = $1 AND runs.run_id = $2`,
      [row.project_id, row.source_full_run_id],
    ));
    const snapshotResult = rehearsalEvaluationSnapshotSchema.safeParse(source?.evaluation_snapshot_json);
    const deckResult = deckSchema.safeParse(source?.deck_json);
    if (!snapshotResult.success) return { row: await this.markSessionStale(executor, row), resolution: null };

    let resolution: FocusedPracticeTargetResolution;
    try {
      resolution = resolveFocusedPracticeTarget({
        currentDeck: deckResult.success ? deckResult.data : null,
        sourceSnapshot: snapshotResult.data,
        targetScope: toSession(row).targetScope,
      });
    } catch (error) {
      if (error instanceof FocusedPracticeTargetValidationError) {
        return { row: await this.markSessionStale(executor, row), resolution: null };
      }
      throw error;
    }
    if (resolution.compatibilityState === "stale") {
      return { row: await this.markSessionStale(executor, row), resolution };
    }
    return { row, resolution };
  }

  private async markSessionStale(executor: QueryExecutor, row: Record<string, any>) {
    await executor.query(
      `UPDATE focused_practice_sessions SET compatibility_state = 'stale'
       WHERE practice_session_id = $1 AND compatibility_state = 'current'`,
      [row.practice_session_id],
    );
    this.logger?.warn({
      event: "focused_practice.target_stale",
      projectId: row.project_id,
      runId: row.source_full_run_id,
      sessionId: row.practice_session_id,
    }, "Focused practice target became stale.");
    return { ...row, compatibility_state: "stale" };
  }

  private async getAttemptRow(attemptId: string) {
    const row = first(await this.dataSource.query(`SELECT * FROM focused_practice_attempts WHERE attempt_id = $1`, [attemptId]));
    if (!row) throw new NotFoundException("Focused practice attempt not found.");
    return row;
  }
}

type QueryExecutor = {
  query: (sql: string, parameters?: unknown[]) => Promise<unknown>;
};

function resolveTargetOrBadRequest(
  targetScope: FocusedPracticeSession["targetScope"],
  sourceSnapshot: RehearsalEvaluationSnapshot,
  currentDeck: Deck | null,
) {
  try {
    return resolveFocusedPracticeTarget({ targetScope, sourceSnapshot, currentDeck });
  } catch (error) {
    if (error instanceof FocusedPracticeTargetValidationError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

function toSession(row: Record<string, any>): FocusedPracticeSession {
  return focusedPracticeSessionSchema.parse({
    practiceSessionId: row.practice_session_id, projectId: row.project_id, deckId: row.deck_id,
    sourceFullRunId: row.source_full_run_id, sourceGoalSetId: row.source_goal_set_id,
    goalIds: row.goal_ids_json, targetScope: row.target_scope_json, snapshot: row.snapshot_json,
    compatibilityState: row.compatibility_state, status: row.status, dataOrigin: row.data_origin,
    createdBy: row.created_by, createdAt: iso(row.created_at), completedAt: row.completed_at ? iso(row.completed_at) : null,
  });
}

function toAttempt(row: Record<string, any>): FocusedPracticeAttempt {
  return focusedPracticeAttemptSchema.parse({
    attemptId: row.attempt_id, projectId: row.project_id, practiceSessionId: row.practice_session_id,
    attemptNumber: row.attempt_number, status: row.status, result: row.result,
    audioFileId: row.audio_file_id, analysisJobId: row.analysis_job_id, cleanupState: row.cleanup_state,
    cleanupGeneration: row.cleanup_generation, rawAudioDeletedAt: row.raw_audio_deleted_at ? iso(row.raw_audio_deleted_at) : null,
    rawAudioDeleteDeadlineAt: iso(row.raw_audio_delete_deadline_at), durationMs: row.duration_ms,
    slideTimeline: row.slide_timeline_json ?? [], goalOutcomes: row.goal_outcomes_json ?? [],
    errorCode: row.error_code, createdAt: iso(row.created_at), completedAt: row.completed_at ? iso(row.completed_at) : null,
  });
}

export function deriveStabilization(attempts: FocusedPracticeAttempt[]) {
  const terminal = attempts.filter((attempt) => ["succeeded", "failed", "cancelled"].includes(attempt.status));
  const latest = terminal.at(-1);
  const previous = terminal.at(-2);
  const goalIds = new Set([...(latest?.goalOutcomes ?? []), ...(previous?.goalOutcomes ?? [])].map((item) => item.goalId));
  return [...goalIds].map((goalId) => ({
    goalId,
    stabilized: Boolean(
      latest?.status === "succeeded" &&
      previous?.status === "succeeded" &&
      latest?.goalOutcomes.find((item) => item.goalId === goalId)?.outcome === "passed" &&
      previous?.goalOutcomes.find((item) => item.goalId === goalId)?.outcome === "passed"
    ),
  }));
}

export function focusedPracticeAudioFileName(mimeType: string) {
  const extension = {
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/mpga": "mp3",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/mp4": "mp4",
    "video/mp4": "mp4",
    "audio/flac": "flac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
  }[mimeType] ?? "webm";

  return `focused-practice-audio.${extension}`;
}

function validateTimeline(timeline: Array<{ enteredAtMs: number; exitedAtMs: number | null }>, durationMs: number) {
  if (timeline.some((item) => item.enteredAtMs > durationMs || (item.exitedAtMs ?? durationMs) > durationMs)) {
    throw new BadRequestException("Slide timeline must stay within the recording duration.");
  }
}

function first(rows: unknown): Record<string, any> | undefined {
  if (!Array.isArray(rows)) return undefined;
  const value = Array.isArray(rows[0]) ? rows[0][0] : rows[0];
  return value && typeof value === "object" ? value as Record<string, any> : undefined;
}
function iso(value: unknown) { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }
function canonical(value: unknown) { return JSON.stringify(value, Object.keys((value ?? {}) as object).sort()); }
