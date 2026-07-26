import type { StoragePort } from "@orbit/storage";
import {
  focusedPracticeAnalysisJobPayloadSchema,
  focusedPracticeAnalysisJobResultSchema,
  focusedPracticeGoalOutcomeSchema,
} from "@orbit/shared/coaching";
import { jobSchema, type Job } from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { createHash } from "node:crypto";
import { z } from "zod";

const inputRowSchema = z.object({
  attempt_id: z.string(), project_id: z.string(), practice_session_id: z.string(),
  status: z.enum(["queued", "processing", "succeeded", "failed", "cancelled"]), duration_ms: z.number().int().positive(),
  audio_file_id: z.string(), storage_key: z.string(), mime_type: z.string(),
  goal_ids_json: z.array(z.string()), snapshot_json: z.record(z.unknown()),
  evaluation_snapshot_json: z.record(z.unknown()),
});

const transcribeResponseSchema = z.object({ transcript: z.string(), segments: z.array(z.record(z.unknown())).default([]) });
const analysisResponseSchema = z.object({ outcomes: z.array(focusedPracticeGoalOutcomeSchema).max(3) }).strict();

export async function processFocusedPracticeAnalysisJob(
  dataSource: DataSource,
  storage: Pick<StoragePort, "getSignedReadUrl" | "removeObject">,
  pythonWorkerUrl: string,
  rawPayload: unknown,
): Promise<Job> {
  const payload = focusedPracticeAnalysisJobPayloadSchema.parse(rawPayload);
  const rows = await dataSource.query(
    `SELECT attempts.attempt_id, attempts.project_id, attempts.practice_session_id,
      attempts.status, attempts.duration_ms, attempts.audio_file_id,
      assets.storage_key, assets.mime_type, sessions.goal_ids_json, sessions.snapshot_json,
      runs.evaluation_snapshot_json
     FROM focused_practice_attempts attempts
     JOIN focused_practice_sessions sessions ON sessions.practice_session_id = attempts.practice_session_id
     JOIN project_assets assets ON assets.file_id = attempts.audio_file_id AND assets.project_id = attempts.project_id
     JOIN rehearsal_runs runs ON runs.run_id = sessions.source_full_run_id AND runs.project_id = sessions.project_id
     WHERE attempts.attempt_id = $1 AND attempts.project_id = $2`,
    [payload.attemptId, payload.projectId],
  );
  const row = inputRowSchema.parse(firstQueryRow(rows));
  if (row.status !== "queued") return currentJob(dataSource, payload.jobId);
  await updateJob(dataSource, payload.jobId, "running", 10, "부분 연습 분석 준비 중", null, null);
  await dataSource.query(`UPDATE focused_practice_attempts SET status = 'processing' WHERE attempt_id = $1 AND status = 'queued'`, [payload.attemptId]);

  try {
    const storageUrl = await storage.getSignedReadUrl(row.storage_key);
    const transcribe = await fetch(new URL("/audio/transcribe-private", pythonWorkerUrl), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: payload.attemptId, projectId: payload.projectId,
        audio: { fileId: row.audio_file_id, storageUrl, mimeType: row.mime_type },
      }), signal: AbortSignal.timeout(120_000),
    });
    if (!transcribe.ok) throw new Error("TRANSCRIPTION_FAILED");
    const evidence = transcribeResponseSchema.parse(await transcribe.json());
    const plan = (row.evaluation_snapshot_json as any).evaluationPlan;
    const criteria = Array.isArray(plan?.criteria) ? plan.criteria : [];
    const goalRows = await dataSource.query(
      `SELECT goal_id, criterion_ref_json FROM practice_goals WHERE project_id = $1 AND goal_id = ANY($2::text[])`,
      [payload.projectId, row.goal_ids_json],
    );
    const goals = goalRows.map((goal: any) => ({
      goalId: goal.goal_id,
      criterionRef: goal.criterion_ref_json,
      criterion: criteria.find((criterion: any) =>
        criterion.criterionId === goal.criterion_ref_json.criterionId && criterion.revision === goal.criterion_ref_json.revision),
    }));
    const analyze = await fetch(new URL("/focused-practice/analyze", pythonWorkerUrl), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: evidence.transcript, durationMs: row.duration_ms, goals }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!analyze.ok) throw new Error("ANALYSIS_FAILED");
    const result = analysisResponseSchema.parse(await analyze.json());
    const aggregate = result.outcomes.some((item) => item.outcome === "failed")
      ? "needs-retry" : result.outcomes.some((item) => item.outcome === "unmeasured") ? "unmeasured" : "passed";
    let deletedAt: string | null = null;
    try {
      await storage.removeObject(row.storage_key);
      deletedAt = new Date().toISOString();
      await dataSource.query(`UPDATE project_assets SET status = 'deleted', deleted_at = $3 WHERE project_id = $1 AND file_id = $2`, [payload.projectId, row.audio_file_id, deletedAt]);
    } catch {
      await scheduleRawAudioDeletion(dataSource, row);
    }
    await dataSource.query(
      `UPDATE focused_practice_attempts SET status = 'succeeded', result = $2,
       goal_outcomes_json = $3, cleanup_state = $4, raw_audio_deleted_at = $5,
       completed_at = now() WHERE attempt_id = $1 AND status = 'processing'`,
      [payload.attemptId, aggregate, JSON.stringify(result.outcomes), deletedAt ? "deleted" : "pending", deletedAt],
    );
    const jobResult = focusedPracticeAnalysisJobResultSchema.parse({
      attemptId: payload.attemptId,
      result: aggregate,
    });
    return updateJob(
      dataSource,
      payload.jobId,
      "succeeded",
      100,
      "부분 연습 분석 완료",
      jobResult,
      null,
    );
  } catch (error) {
    const code = error instanceof Error && ["TRANSCRIPTION_FAILED", "ANALYSIS_FAILED"].includes(error.message)
      ? error.message : "ANALYSIS_FAILED";
    let cleanupState = "deleted";
    let deletedAt: string | null = null;
    try {
      await storage.removeObject(row.storage_key);
      deletedAt = new Date().toISOString();
      await dataSource.query(`UPDATE project_assets SET status = 'deleted', deleted_at = $3 WHERE project_id = $1 AND file_id = $2`, [payload.projectId, row.audio_file_id, deletedAt]);
    } catch {
      cleanupState = "pending";
      await scheduleRawAudioDeletion(dataSource, row);
    }
    await dataSource.query(`UPDATE focused_practice_attempts SET status = 'failed', error_code = $2,
      cleanup_state = $3, raw_audio_deleted_at = $4, completed_at = now()
      WHERE attempt_id = $1 AND status IN ('queued','processing')`, [payload.attemptId, code, cleanupState, deletedAt]);
    return updateJob(dataSource, payload.jobId, "failed", 100, "부분 연습 분석 실패", null, { code, message: "Focused practice analysis failed." });
  }
}

function updateJob(dataSource: DataSource, jobId: string, status: "running" | "succeeded" | "failed", progress: number, message: string, result: Record<string, unknown> | null, error: { code: string; message: string } | null) {
  return dataSource.query(`UPDATE jobs SET status=$2, progress=$3, message=$4, result=$5, error=$6, updated_at=now() WHERE job_id=$1 RETURNING *`, [jobId, status, progress, message, result, error]).then((rows) => jobRow(firstQueryRow(rows)));
}
function currentJob(dataSource: DataSource, jobId: string) { return dataSource.query(`SELECT * FROM jobs WHERE job_id=$1`, [jobId]).then((rows) => jobRow(firstQueryRow(rows))); }
async function scheduleRawAudioDeletion(dataSource: DataSource, row: z.infer<typeof inputRowSchema>) {
  const now = new Date().toISOString();
  const storageKeyHash = createHash("sha256").update(row.storage_key).digest("hex");
  await dataSource.query(
    `INSERT INTO storage_deletion_outbox (
      deletion_id, project_id, file_id, storage_key, storage_key_hash,
      purpose, status, attempt_count, next_attempt_at, created_at
    ) VALUES ($1,$2,$3,$4,$5,'focused-practice-audio','pending',0,$6,$6)
    ON CONFLICT (storage_key_hash) DO NOTHING`,
    [`deletion_${storageKeyHash.slice(0, 32)}`, row.project_id, row.audio_file_id, row.storage_key, storageKeyHash, now],
  );
}

function jobRow(row: any): Job { return jobSchema.parse({ jobId: row.job_id, projectId: row.project_id, type: row.type, status: row.status, progress: row.progress, message: row.message, result: row.result, error: row.error, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }); }
function iso(value: unknown) { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }
function firstQueryRow<T=any>(value:unknown):T { const first=Array.isArray(value)?value[0]:undefined; return (Array.isArray(first)?first[0]:first) as T; }
