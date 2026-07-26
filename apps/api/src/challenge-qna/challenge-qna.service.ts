import { isAdaptiveCoachingProjectAllowed, loadOrbitConfig } from "@orbit/config";
import {
  enqueueChallengeQnaAnswerAnalysisJob,
  enqueueChallengeQnaGenerationJob,
} from "@orbit/job-queue";
import {
  challengeQnaAnswerAttemptSchema,
  challengeQnaGroundingSnapshotSchema,
  challengeQnaSessionSchema,
  challengeQnaSourceSnapshotSchema,
  completeChallengeQnaAudioRequestSchema,
  createChallengeQnaAnswerAttemptRequestSchema,
  createChallengeQnaSessionRequestSchema,
  retryChallengeQnaGenerationRequestSchema,
  revealAssistanceRequestSchema,
  type ChallengeQnaAnswerAttempt,
  type ChallengeQnaSession,
} from "@orbit/shared/coaching";
import { deckSchema } from "@orbit/shared/deck";
import { createAssetUploadUrlRequestSchema } from "@orbit/shared/files";
import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import { DataSource, type EntityManager } from "typeorm";
import { FilesService } from "../files/files.service";
import { JobsService } from "../jobs/jobs.service";
import { deckContentHash, sha256Canonical } from "../practice-goals/evaluation-plan";
import { ProjectsService } from "../projects/projects.service";
import { ChallengeQnaEvidenceCache, CHALLENGE_QNA_EVIDENCE_TTL_SECONDS } from "./challenge-qna-evidence-cache";

const assistanceRank = { none: 0, "concept-hint": 1, "slide-hint": 2, "full-guide": 3 } as const;

@Injectable()
export class ChallengeQnaService {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });
  private readonly qnaAnswerAudioUploadRequestSchema = createAssetUploadUrlRequestSchema({
    maxRehearsalAudioUploadSizeBytes: this.config.REHEARSAL_AUDIO_MAX_BYTES,
    allowedPrivatePurpose: "qna-answer-audio"
  });
  constructor(
    private readonly dataSource: DataSource,
    private readonly projects: ProjectsService,
    private readonly files: FilesService,
    private readonly jobs: JobsService,
    private readonly evidence: ChallengeQnaEvidenceCache,
    @Optional()
    @InjectPinoLogger(ChallengeQnaService.name)
    private readonly logger?: PinoLogger,
  ) {}

  async createSession(projectId: string, actorUserId: string, body: unknown) {
    const request = createChallengeQnaSessionRequestSchema.parse(body);
    await this.projects.assertCanWriteProject(projectId, actorUserId);
    if (!this.config.ADAPTIVE_REHEARSAL_COACH_ENABLED || !this.config.CHALLENGE_QNA_ENABLED || !isAdaptiveCoachingProjectAllowed(this.config, projectId)) {
      throw new ForbiddenException("Challenge Q&A is not enabled for this project.");
    }
    let result: { created: boolean; session: ChallengeQnaSession };
    try {
      result = await this.dataSource.transaction(async (manager) => {
        const existing = first(await manager.query(`SELECT * FROM challenge_qna_sessions WHERE project_id=$1 AND client_request_id=$2`, [projectId, request.clientRequestId]));
        if (existing) return { created: false, session: toSession(existing, false) };
        const source = await buildChallengeQnaSource(manager, projectId, request.source);
        const now = new Date().toISOString();
        const created = challengeQnaSessionSchema.parse({
          qnaSessionId: `qna_${randomUUID()}`, projectId, deckId: source.sourceSnapshot.deck.deckId,
          source: request.source, sourceSnapshot: source.sourceSnapshot, groundingSnapshot: source.groundingSnapshot,
          status: "preparing", generationRevision: 1, generationJobId: null, activeQuestionOrder: null,
          executionMode: "provider", errorCode: null, createdBy: actorUserId, createdAt: now, completedAt: null,
        });
        await manager.query(`INSERT INTO challenge_qna_sessions (
          qna_session_id, project_id, deck_id, client_request_id, source_json,
          source_full_run_id, source_practice_session_id, source_attempt_id,
          source_snapshot_json, grounding_snapshot_json, status, generation_revision,
          generation_job_id, active_question_order, execution_mode, error_code, created_by, created_at, completed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,NULL,$13,NULL,$14,$15,NULL)`, [
          created.qnaSessionId, projectId, created.deckId, request.clientRequestId, request.source,
          request.source.mode === "final" ? request.source.sourceFullRunId : null,
          request.source.mode === "checkpoint" ? request.source.sourcePracticeSessionId : null,
          request.source.mode === "checkpoint" ? request.source.sourceAttemptId : null,
          created.sourceSnapshot, source.groundingSnapshot, created.status, 1, created.executionMode, actorUserId, now,
        ]);
        return { created: true, session: created };
      });
    } catch (error) {
      if (!isQnaClientRequestConflict(error)) throw error;
      const existing = first(await this.dataSource.query(
        `SELECT * FROM challenge_qna_sessions WHERE project_id=$1 AND client_request_id=$2`,
        [projectId, request.clientRequestId],
      ));
      if (!existing) throw error;
      result = { created: false, session: toSession(existing, false) };
    }
    if (result.created) await this.dispatchGeneration(result.session);
    const session = result.session;
    return this.getSession(session.qnaSessionId, actorUserId);
  }

  async getSession(sessionId: string, actorUserId: string) {
    const row = await this.getSessionRow(sessionId);
    await this.projects.assertCanReadProject(String(row.project_id), actorUserId);
    const questions = await this.dataSource.query(`
      SELECT questions.*, COALESCE(assistance.level,'none') AS assistance_level,
        (COUNT(attempts.answer_attempt_id) FILTER (WHERE attempts.status='succeeded'))::int AS succeeded_attempt_count
      FROM challenge_qna_questions questions
      LEFT JOIN challenge_qna_assistance assistance ON assistance.qna_session_id=questions.qna_session_id
        AND assistance.question_id=questions.question_id AND assistance.question_revision=questions.revision
      LEFT JOIN challenge_qna_answer_attempts attempts ON attempts.qna_session_id=questions.qna_session_id
        AND attempts.question_id=questions.question_id AND attempts.question_revision=questions.revision
      WHERE questions.qna_session_id=$1 AND questions.revision=$2
      GROUP BY questions.question_id, questions.revision, assistance.level
      ORDER BY questions.question_order`, [sessionId, row.generation_revision]);
    const attempts = (await this.dataSource.query(`SELECT * FROM challenge_qna_answer_attempts WHERE qna_session_id=$1 ORDER BY created_at`, [sessionId])).map(toAttempt);
    return {
      session: toSession(row, true),
      questions: questions.map(publicQuestion),
      attempts,
    };
  }

  async retryGeneration(sessionId: string, actorUserId: string, body: unknown) {
    const request = retryChallengeQnaGenerationRequestSchema.parse(body);
    const row = await this.getSessionRow(sessionId);
    await this.projects.assertCanWriteProject(String(row.project_id), actorUserId);
    if (row.generation_revision !== request.expectedGenerationRevision || !["ready", "failed"].includes(String(row.status))) {
      throw new ConflictException({ code: "REVISION_CONFLICT", message: "Question generation revision changed." });
    }
    const rows = await this.dataSource.query(`UPDATE challenge_qna_sessions SET generation_revision=generation_revision+1,
      status='preparing', generation_job_id=NULL, active_question_order=NULL, error_code=NULL
      WHERE qna_session_id=$1 AND generation_revision=$2 RETURNING *`, [sessionId, request.expectedGenerationRevision]);
    const session = toSession(first(rows)!, false);
    await this.dispatchGeneration(session);
    return this.getSession(sessionId, actorUserId);
  }

  async revealAssistance(sessionId: string, questionId: string, actorUserId: string, body: unknown) {
    const request = revealAssistanceRequestSchema.parse(body);
    const row = await this.getSessionRow(sessionId);
    await this.projects.assertCanWriteProject(String(row.project_id), actorUserId);
    const question = first(await this.dataSource.query(`SELECT * FROM challenge_qna_questions WHERE qna_session_id=$1 AND question_id=$2 AND revision=$3`, [sessionId, questionId, request.questionRevision]));
    if (!question || request.questionRevision !== row.generation_revision) throw new ConflictException({ code: "SOURCE_INCOMPATIBLE", message: "Question revision is stale." });
    if (request.level === "full-guide") {
      const firstAttempt = first(await this.dataSource.query(`SELECT 1 FROM challenge_qna_answer_attempts WHERE qna_session_id=$1 AND question_id=$2 AND question_revision=$3 AND status='succeeded' LIMIT 1`, [sessionId, questionId, request.questionRevision]));
      if (!firstAttempt) throw new ConflictException({ code: "INVALID_STATE_TRANSITION", message: "Submit an answer before revealing the full guide." });
    }
    await this.dataSource.query(`INSERT INTO challenge_qna_assistance (project_id,qna_session_id,question_id,question_revision,level,level_rank,updated_by,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (qna_session_id,question_id,question_revision) DO UPDATE SET
      level=CASE WHEN challenge_qna_assistance.level_rank < EXCLUDED.level_rank THEN EXCLUDED.level ELSE challenge_qna_assistance.level END,
      level_rank=GREATEST(challenge_qna_assistance.level_rank,EXCLUDED.level_rank), updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [row.project_id, sessionId, questionId, request.questionRevision, request.level, assistanceRank[request.level], actorUserId]);
    return this.getSession(sessionId, actorUserId);
  }

  async createAnswer(sessionId: string, questionId: string, actorUserId: string, body: unknown) {
    const request = createChallengeQnaAnswerAttemptRequestSchema.parse(body);
    const session = await this.getSessionRow(sessionId);
    await this.projects.assertCanWriteProject(String(session.project_id), actorUserId);
    if (!["ready", "active"].includes(String(session.status)) || request.questionRevision !== session.generation_revision) {
      throw new ConflictException({ code: "INVALID_STATE_TRANSITION", message: "Question is not active." });
    }
    const question = first(await this.dataSource.query(`SELECT * FROM challenge_qna_questions WHERE qna_session_id=$1 AND question_id=$2 AND revision=$3 AND question_order=$4`, [sessionId, questionId, request.questionRevision, session.active_question_order]));
    if (!question) throw new ConflictException({ code: "SOURCE_INCOMPATIBLE", message: "Question is not the server-owned active question." });
    const existing = first(await this.dataSource.query(`SELECT * FROM challenge_qna_answer_attempts WHERE qna_session_id=$1 AND client_request_id=$2`, [sessionId, request.clientRequestId]));
    if (existing) return { attempt: toAttempt(existing), upload: null };
    const assistance = first(await this.dataSource.query(`SELECT level FROM challenge_qna_assistance WHERE qna_session_id=$1 AND question_id=$2 AND question_revision=$3`, [sessionId, questionId, request.questionRevision]));
    const attemptId = `answer_${randomUUID()}`;
    const now = new Date();
    let upload: Awaited<ReturnType<FilesService["createUploadUrl"]>> | null = null;
    if (request.inputMode === "voice") upload = await this.files.createUploadUrl(
      String(session.project_id),
      this.qnaAnswerAudioUploadRequestSchema.parse({
        originalName: "challenge-qna-answer", mimeType: request.mimeType, size: request.size, purpose: "qna-answer-audio",
      }),
    );
    const status = request.inputMode === "voice" ? "uploading" : "created";
    const rows = await this.dataSource.query(`INSERT INTO challenge_qna_answer_attempts (
      answer_attempt_id,project_id,qna_session_id,question_id,question_revision,client_request_id,attempt_number,input_mode,
      assistance_level,status,analysis_job_id,audio_file_id,cleanup_state,cleanup_generation,raw_audio_deleted_at,
      raw_audio_delete_deadline_at,duration_ms,evidence_expires_at,concept_outcomes_json,clarity,audience_fit,error_code,created_at,completed_at
    ) SELECT $1,$2,$3,$4,$5,$6,COALESCE(MAX(attempt_number),0)+1,$7,$8,$9,NULL,$10,$11,1,NULL,$12,NULL,$13,'[]'::jsonb,NULL,NULL,NULL,$14,NULL
      FROM challenge_qna_answer_attempts WHERE qna_session_id=$3 AND question_id=$4 AND question_revision=$5 RETURNING *`, [
      attemptId, session.project_id, sessionId, questionId, request.questionRevision, request.clientRequestId, request.inputMode,
      assistance?.level ?? "none", status, upload?.fileId ?? null, request.inputMode === "voice" ? "pending" : "not-required",
      request.inputMode === "voice" ? new Date(now.getTime() + 30 * 60_000).toISOString() : null,
      request.inputMode === "text" ? new Date(now.getTime() + CHALLENGE_QNA_EVIDENCE_TTL_SECONDS * 1000).toISOString() : null,
      now.toISOString(),
    ]);
    await this.dataSource.query(`UPDATE challenge_qna_sessions SET status='active' WHERE qna_session_id=$1 AND status='ready'`, [sessionId]);
    if (request.inputMode === "text") {
      await this.evidence.putText(attemptId, request.answerText);
      return { attempt: await this.queueAnswer(first(rows)!), upload: null };
    }
    return { attempt: toAttempt(first(rows)!), upload };
  }

  async completeAudio(attemptId: string, actorUserId: string, body: unknown) {
    const request = completeChallengeQnaAudioRequestSchema.parse(body);
    const row = first(await this.dataSource.query(`SELECT * FROM challenge_qna_answer_attempts WHERE answer_attempt_id=$1`, [attemptId]));
    if (!row) throw new NotFoundException("Q&A answer attempt not found.");
    await this.projects.assertCanWriteProject(String(row.project_id), actorUserId);
    if (row.status !== "uploading" || row.audio_file_id !== request.fileId) throw new ConflictException({ code: "INVALID_STATE_TRANSITION", message: "Audio attempt is not uploadable." });
    await this.files.completeUpload(String(row.project_id), { fileId: request.fileId }, "qna-answer-audio");
    const rows = await this.dataSource.query(`UPDATE challenge_qna_answer_attempts SET duration_ms=$2 WHERE answer_attempt_id=$1 AND status='uploading' RETURNING *`, [attemptId, request.durationMs]);
    return { attempt: await this.queueAnswer(first(rows)!) };
  }

  async advance(sessionId: string, actorUserId: string) {
    const row = await this.getSessionRow(sessionId);
    await this.projects.assertCanWriteProject(String(row.project_id), actorUserId);
    const answered = first(await this.dataSource.query(`SELECT 1 FROM challenge_qna_answer_attempts a JOIN challenge_qna_questions q ON q.question_id=a.question_id AND q.revision=a.question_revision WHERE a.qna_session_id=$1 AND q.question_order=$2 AND a.status='succeeded'`, [sessionId, row.active_question_order]));
    if (!answered) throw new ConflictException({ code: "INVALID_STATE_TRANSITION", message: "Current question requires a completed answer." });
    const count = Number(row.source_json.questionCount);
    const next = Number(row.active_question_order) + 1;
    const terminal = next > count;
    const rows = await this.dataSource.query(`UPDATE challenge_qna_sessions SET status=$2, active_question_order=$3, completed_at=$4 WHERE qna_session_id=$1 RETURNING *`, [sessionId, terminal ? "completed" : "active", terminal ? null : next, terminal ? new Date().toISOString() : null]);
    return { session: toSession(first(rows)!, true) };
  }

  async cancel(sessionId: string, actorUserId: string) {
    const row = await this.getSessionRow(sessionId); await this.projects.assertCanWriteProject(String(row.project_id), actorUserId);
    const rows = await this.dataSource.query(`UPDATE challenge_qna_sessions SET status='cancelled',active_question_order=NULL,completed_at=now() WHERE qna_session_id=$1 AND status NOT IN ('completed','cancelled') RETURNING *`, [sessionId]);
    const updated = first(rows);
    if (!updated) throw new ConflictException({ code: "INVALID_STATE_TRANSITION", message: "Session is terminal." });
    return { session: toSession(updated, true) };
  }

  private async dispatchGeneration(session: ChallengeQnaSession) {
    const job = await this.jobs.create({ projectId: session.projectId, type: "challenge-qna-generation", payload: { qnaSessionId: session.qnaSessionId, generationRevision: session.generationRevision } });
    await this.dataSource.query(`UPDATE challenge_qna_sessions SET generation_job_id=$2 WHERE qna_session_id=$1 AND generation_revision=$3`, [session.qnaSessionId, job.jobId, session.generationRevision]);
    try {
      await enqueueChallengeQnaGenerationJob({ driver: this.config.JOB_QUEUE_DRIVER, redisUrl: this.config.REDIS_URL, jobId: job.jobId, projectId: session.projectId, qnaSessionId: session.qnaSessionId, generationRevision: session.generationRevision });
      this.logger?.info({ event: "job.enqueued", jobId: job.jobId, jobType: job.type, projectId: session.projectId }, "Challenge Q&A generation job enqueued.");
    } catch (error) {
      await Promise.all([
        this.jobs.update(job.jobId, {
          status: "failed", progress: 0, message: "Challenge Q&A generation enqueue failed.",
          error: { code: "QNA_GENERATION_ENQUEUE_FAILED", message: "Challenge Q&A generation enqueue failed." },
        }),
        this.dataSource.query(`UPDATE challenge_qna_sessions SET status='failed',error_code='PROVIDER_UNAVAILABLE'
          WHERE qna_session_id=$1 AND generation_job_id=$2 AND generation_revision=$3 AND status='preparing'`,
          [session.qnaSessionId, job.jobId, session.generationRevision]),
      ]);
      this.logger?.error({ event: "job.enqueue_failed", jobId: job.jobId, jobType: job.type, projectId: session.projectId, errorName: error instanceof Error ? error.name : "UnknownError" }, "Challenge Q&A generation enqueue failed.");
      throw error;
    }
  }

  private async queueAnswer(row: Record<string, any>): Promise<ChallengeQnaAnswerAttempt> {
    const job = await this.jobs.create({ projectId: String(row.project_id), type: "challenge-qna-answer-analysis", payload: { answerAttemptId: row.answer_attempt_id } });
    const rows = await this.dataSource.query(`UPDATE challenge_qna_answer_attempts SET status='queued',analysis_job_id=$2 WHERE answer_attempt_id=$1 AND status IN ('created','uploading') RETURNING *`, [row.answer_attempt_id, job.jobId]);
    await enqueueChallengeQnaAnswerAnalysisJob({ driver: this.config.JOB_QUEUE_DRIVER, redisUrl: this.config.REDIS_URL, jobId: job.jobId, projectId: String(row.project_id), answerAttemptId: String(row.answer_attempt_id) });
    return toAttempt(first(rows)!);
  }

  private async getSessionRow(sessionId: string) {
    const row = first(await this.dataSource.query(`SELECT * FROM challenge_qna_sessions WHERE qna_session_id=$1`, [sessionId]));
    if (!row) throw new NotFoundException("Challenge Q&A session not found."); return row;
  }
}

export async function buildChallengeQnaSource(manager: EntityManager, projectId: string, source: ReturnType<typeof createChallengeQnaSessionRequestSchema.parse>["source"]) {
  const sourceRows = source.mode === "final"
    ? await manager.query(`SELECT runs.deck_id,runs.evaluation_snapshot_json,heads.current_goal_set_id AS goal_set_id FROM rehearsal_runs runs LEFT JOIN practice_goal_heads heads ON heads.project_id=runs.project_id AND heads.source_full_run_id=runs.run_id WHERE runs.project_id=$1 AND runs.run_id=$2 AND runs.status='succeeded'`, [projectId, source.sourceFullRunId])
    : await manager.query(`SELECT sessions.deck_id,runs.evaluation_snapshot_json,sessions.source_goal_set_id AS goal_set_id FROM focused_practice_sessions sessions JOIN focused_practice_attempts attempts ON attempts.practice_session_id=sessions.practice_session_id AND attempts.project_id=sessions.project_id JOIN rehearsal_runs runs ON runs.run_id=sessions.source_full_run_id AND runs.project_id=sessions.project_id WHERE sessions.project_id=$1 AND sessions.practice_session_id=$2 AND attempts.attempt_id=$3 AND attempts.status='succeeded'`, [projectId, source.sourcePracticeSessionId, source.sourceAttemptId]);
  const sourceRow = first(sourceRows);
  if (!sourceRow) throw new ConflictException({ code: "SOURCE_INCOMPATIBLE", message: "Q&A source must be a succeeded canonical run or attempt." });
  const deckRow = first(await manager.query(`SELECT deck_id,version,deck_json FROM decks WHERE project_id=$1 AND deck_id=$2`, [projectId, sourceRow.deck_id]));
  if (!deckRow) throw new NotFoundException("Deck not found.");
  const deck = deckSchema.parse(deckRow.deck_json);
  const plan = sourceRow.evaluation_snapshot_json?.evaluationPlan;
  if (!plan) throw new ConflictException({ code: "SOURCE_INCOMPATIBLE", message: "Frozen evaluation plan is unavailable." });
  const goals = sourceRow.goal_set_id ? await manager.query(`SELECT goal_id,criterion_ref_json FROM practice_goals WHERE project_id=$1 AND goal_set_id=$2 ORDER BY priority LIMIT 3`, [projectId, sourceRow.goal_set_id]) : [];
  const approved = Array.isArray(plan.approvedReferences) ? plan.approvedReferences : [];
  const chunks: Array<Record<string, unknown>> = [];
  for (const reference of approved.slice(0, 10)) {
    const rows = await manager.query(`SELECT chunks.id,chunks.content,chunks.content_hash,assets.content_hash AS file_content_hash
      FROM reference_chunks chunks JOIN project_assets assets ON assets.project_id=chunks.project_id AND assets.file_id=chunks.file_id
      WHERE chunks.project_id=$1 AND chunks.file_id=$2 AND assets.content_hash=$3 AND assets.status='uploaded'
      ORDER BY chunks.chunk_index LIMIT 20`, [projectId, reference.fileId, reference.fileContentHash]);
    for (const chunk of rows) if (chunks.length < 20) chunks.push({ fileId: reference.fileId, fileContentHash: chunk.file_content_hash, chunkId: String(chunk.id), content: String(chunk.content).slice(0, 2000), contentHash: chunk.content_hash });
  }
  const capturedAt = new Date().toISOString();
  const sourceSnapshot = challengeQnaSourceSnapshotSchema.parse({ snapshotVersion: 1, projectId,
    deck: { deckId: deck.deckId, deckVersion: deck.version, deckContentHash: deckContentHash(deck), slides: deck.slides.map((slide) => {
      const visibleText = collectVisibleText(slide.elements).slice(0, 12_000);
      return { slideId: slide.slideId, order: slide.order, title: slide.title, visibleText, contentHash: sha256Canonical({ slideId: slide.slideId, order: slide.order, title: slide.title, visibleText }) };
    }) }, briefRef: plan.briefRef, evaluatorLensRef: plan.evaluatorLensRef,
    linkedGoalRefs: goals.map((goal: any) => ({ goalId: goal.goal_id, criterionId: goal.criterion_ref_json.criterionId, criterionRevision: goal.criterion_ref_json.revision })),
    approvedReferences: approved, capturedAt,
  });
  const groundingSnapshot = challengeQnaGroundingSnapshotSchema.parse({ snapshotVersion: 1, chunks, capturedAt });
  return { sourceSnapshot, groundingSnapshot };
}

function collectVisibleText(elements: unknown): string {
  const output: string[] = [];
  const visit = (value: unknown, key = "") => {
    if (typeof value === "string" && ["text", "content", "label", "alt"].includes(key)) output.push(value);
    else if (Array.isArray(value)) value.forEach((item) => visit(item));
    else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([nextKey, item]) => visit(item, nextKey));
  };
  visit(elements); return output.join("\n");
}

function toSession(row: Record<string, any>, redactGrounding: boolean): ChallengeQnaSession {
  return challengeQnaSessionSchema.parse({ qnaSessionId: row.qna_session_id, projectId: row.project_id, deckId: row.deck_id,
    source: row.source_json, sourceSnapshot: row.source_snapshot_json, groundingSnapshot: redactGrounding ? null : row.grounding_snapshot_json,
    status: row.status, generationRevision: row.generation_revision, generationJobId: row.generation_job_id,
    activeQuestionOrder: row.active_question_order, executionMode: row.execution_mode, errorCode: row.error_code,
    createdBy: row.created_by, createdAt: iso(row.created_at), completedAt: row.completed_at ? iso(row.completed_at) : null });
}

function publicQuestion(row: Record<string, any>) {
  const canRevealGuide = Number(row.succeeded_attempt_count) > 0;
  return { questionId: row.question_id, projectId: row.project_id, qnaSessionId: row.qna_session_id, revision: row.revision,
    order: row.question_order, questionType: row.question_type, difficulty: row.difficulty, questionText: row.question_text,
    linkedGoalIds: row.linked_goal_ids_json, sourceRefs: row.source_refs_json, assistanceLevel: row.assistance_level,
    answerGuide: canRevealGuide ? row.answer_guide_json : null,
    conceptHints: assistanceRank[row.assistance_level as keyof typeof assistanceRank] >= 1 ? row.answer_guide_json.mustIncludeConcepts.map((item: any) => item.label) : [],
    slideHints: assistanceRank[row.assistance_level as keyof typeof assistanceRank] >= 2 ? row.answer_guide_json.mustIncludeConcepts.flatMap((item: any) => item.sourceRefs).filter((item: any) => item.type === "slide") : [],
    provenance: row.provenance_json };
}

function toAttempt(row: Record<string, any>): ChallengeQnaAnswerAttempt {
  return challengeQnaAnswerAttemptSchema.parse({ answerAttemptId: row.answer_attempt_id, projectId: row.project_id,
    qnaSessionId: row.qna_session_id, questionId: row.question_id, questionRevision: row.question_revision,
    attemptNumber: row.attempt_number, inputMode: row.input_mode, assistanceLevel: row.assistance_level, status: row.status,
    analysisJobId: row.analysis_job_id, audioFileId: row.audio_file_id, cleanupState: row.cleanup_state,
    cleanupGeneration: row.cleanup_generation, rawAudioDeletedAt: row.raw_audio_deleted_at ? iso(row.raw_audio_deleted_at) : null,
    rawAudioDeleteDeadlineAt: row.raw_audio_delete_deadline_at ? iso(row.raw_audio_delete_deadline_at) : null,
    durationMs: row.duration_ms, evidenceExpiresAt: row.evidence_expires_at ? iso(row.evidence_expires_at) : null,
    conceptOutcomes: row.concept_outcomes_json ?? [], clarity: row.clarity, audienceFit: row.audience_fit,
    errorCode: row.error_code, createdAt: iso(row.created_at), completedAt: row.completed_at ? iso(row.completed_at) : null });
}

function first(rows: unknown): Record<string, any> | undefined { if(!Array.isArray(rows))return undefined;const value=Array.isArray(rows[0])?rows[0][0]:rows[0];return value&&typeof value==="object"?value as Record<string,any>:undefined; }
function isQnaClientRequestConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505"
    && "constraint" in error && error.constraint === "uq_qna_session_client");
}
function iso(value: unknown) { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }
