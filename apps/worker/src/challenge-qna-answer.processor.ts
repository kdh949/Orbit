import type { StoragePort } from "@orbit/storage";
import {
  challengeQnaAnswerAnalysisJobPayloadSchema,
  challengeQnaAnswerAnalysisJobResultSchema,
  coachingErrorCodeSchema,
} from "@orbit/shared/coaching";
import { jobSchema, type Job } from "@orbit/shared/jobs";
import { createHash } from "node:crypto";
import type { DataSource } from "typeorm";
import { z } from "zod";
import type { ChallengeQnaEvidenceCache } from "./challenge-qna-evidence-cache";

const rowSchema = z.object({
  answer_attempt_id:z.string(),project_id:z.string(),qna_session_id:z.string(),question_id:z.string(),question_revision:z.number(),
  input_mode:z.enum(["voice","text"]),status:z.enum(["queued","processing","succeeded","failed","cancelled"]),
  audio_file_id:z.string().nullable(),storage_key:z.string().nullable(),mime_type:z.string().nullable(),duration_ms:z.number().nullable(),
  answer_guide_json:z.record(z.unknown()),question_text:z.string(),source_snapshot_json:z.record(z.unknown()),
});
const resultSchema = z.object({
  conceptOutcomes:z.array(z.object({conceptId:z.string(),outcome:z.enum(["covered","partial","missed","unmeasured"])}).strict()).max(8),
  clarity:z.enum(["clear","needs-focus","unmeasured"]),
  audienceFit:z.enum(["appropriate","too-technical","too-vague","unmeasured"]),
}).strict();

export async function processChallengeQnaAnswerJob(dataSource: DataSource, storage: Pick<StoragePort,"getSignedReadUrl"|"removeObject">, evidenceCache: ChallengeQnaEvidenceCache, pythonWorkerUrl: string, rawPayload: unknown): Promise<Job> {
  const payload = challengeQnaAnswerAnalysisJobPayloadSchema.parse(rawPayload);
  const rows = await dataSource.query(`SELECT attempts.*,assets.storage_key,assets.mime_type,questions.answer_guide_json,
    questions.question_text,sessions.source_snapshot_json FROM challenge_qna_answer_attempts attempts
    JOIN challenge_qna_questions questions ON questions.project_id=attempts.project_id AND questions.question_id=attempts.question_id AND questions.revision=attempts.question_revision
    JOIN challenge_qna_sessions sessions ON sessions.qna_session_id=attempts.qna_session_id AND sessions.project_id=attempts.project_id
    LEFT JOIN project_assets assets ON assets.project_id=attempts.project_id AND assets.file_id=attempts.audio_file_id
    WHERE attempts.answer_attempt_id=$1 AND attempts.project_id=$2`, [payload.answerAttemptId,payload.projectId]);
  const row = rowSchema.parse(firstQueryRow(rows));
  if (row.status !== "queued") return currentJob(dataSource,payload.jobId);
  await updateJob(dataSource,payload.jobId,"running",20,"답변 분석 중",null,null);
  await dataSource.query(`UPDATE challenge_qna_answer_attempts SET status='processing' WHERE answer_attempt_id=$1 AND status='queued'`,[payload.answerAttemptId]);
  let answerText: string | null = null;
  try {
    if (row.input_mode === "text") answerText = await evidenceCache.take(payload.answerAttemptId);
    else {
      if (!row.storage_key || !row.audio_file_id || !row.mime_type) throw new Error("ANSWER_EVIDENCE_UNAVAILABLE");
      const storageUrl = await storage.getSignedReadUrl(row.storage_key);
      const response = await fetch(new URL("/audio/transcribe-private",pythonWorkerUrl),{method:"POST",headers:{"content-type":"application/json"},signal:AbortSignal.timeout(120_000),body:JSON.stringify({runId:payload.answerAttemptId,projectId:payload.projectId,audio:{fileId:row.audio_file_id,storageUrl,mimeType:row.mime_type}})});
      if (!response.ok) throw new Error("TRANSCRIPTION_FAILED");
      answerText=z.object({transcript:z.string()}).passthrough().parse(await response.json()).transcript;
    }
    if (!answerText) throw new Error("ANSWER_EVIDENCE_UNAVAILABLE");
    const response = await fetch(new URL("/challenge-qna/analyze-answer",pythonWorkerUrl),{method:"POST",headers:{"content-type":"application/json"},signal:AbortSignal.timeout(120_000),body:JSON.stringify({answerText,questionText:row.question_text,answerGuide:row.answer_guide_json,sourceSnapshot:row.source_snapshot_json})});
    if (!response.ok) throw new Error("QNA_ANSWER_ANALYSIS_FAILED");
    const result=resultSchema.parse(await response.json());
    const deletedAt=await cleanupVoice(dataSource,storage,row);
    await dataSource.query(`UPDATE challenge_qna_answer_attempts SET status='succeeded',concept_outcomes_json=$2,clarity=$3,audience_fit=$4,
      cleanup_state=$5,raw_audio_deleted_at=$6,evidence_expires_at=NULL,completed_at=now() WHERE answer_attempt_id=$1 AND status='processing'`,
      [payload.answerAttemptId,JSON.stringify(result.conceptOutcomes),result.clarity,result.audienceFit,row.input_mode==="voice"?(deletedAt?"deleted":"pending"):"not-required",deletedAt]);
    const jobResult=challengeQnaAnswerAnalysisJobResultSchema.parse({answerAttemptId:payload.answerAttemptId,measuredConceptCount:result.conceptOutcomes.filter((item)=>item.outcome!=="unmeasured").length});
    return updateJob(dataSource,payload.jobId,"succeeded",100,"답변 분석 완료",jobResult,null);
  } catch (error) {
    const code=challengeQnaAnswerFailureCode(error);
    const deletedAt=await cleanupVoice(dataSource,storage,row);
    await evidenceCache.delete(payload.answerAttemptId);
    await dataSource.query(`UPDATE challenge_qna_answer_attempts SET status='failed',error_code=$2,cleanup_state=$3,raw_audio_deleted_at=$4,evidence_expires_at=NULL,completed_at=now() WHERE answer_attempt_id=$1 AND status IN ('queued','processing')`,[payload.answerAttemptId,code,row.input_mode==="voice"?(deletedAt?"deleted":"pending"):"not-required",deletedAt]);
    return updateJob(dataSource,payload.jobId,"failed",100,"답변 분석 실패",null,{code,message:"Challenge Q&A answer analysis failed."});
  } finally { answerText=null; }
}

function challengeQnaAnswerFailureCode(error:unknown) {
  return coachingErrorCodeSchema.parse(
    error instanceof Error&&error.message==="TRANSCRIPTION_FAILED"
      ? "TRANSCRIPTION_FAILED"
      : "ANALYSIS_FAILED"
  );
}

async function cleanupVoice(dataSource:DataSource,storage:Pick<StoragePort,"removeObject">,row:z.infer<typeof rowSchema>) {
  if (row.input_mode!=="voice"||!row.storage_key||!row.audio_file_id) return null;
  try { await storage.removeObject(row.storage_key); const deletedAt=new Date().toISOString(); await dataSource.query(`UPDATE project_assets SET status='deleted',deleted_at=$3 WHERE project_id=$1 AND file_id=$2`,[row.project_id,row.audio_file_id,deletedAt]); return deletedAt; }
  catch { const hash=createHash("sha256").update(row.storage_key).digest("hex"); const now=new Date().toISOString(); await dataSource.query(`INSERT INTO storage_deletion_outbox (deletion_id,project_id,file_id,storage_key,storage_key_hash,purpose,status,attempt_count,next_attempt_at,created_at) VALUES ($1,$2,$3,$4,$5,'qna-answer-audio','pending',0,$6,$6) ON CONFLICT (storage_key_hash) DO NOTHING`,[`deletion_${hash.slice(0,32)}`,row.project_id,row.audio_file_id,row.storage_key,hash,now]); return null; }
}
function updateJob(ds:DataSource,id:string,status:"running"|"succeeded"|"failed",progress:number,message:string,result:Record<string,unknown>|null,error:{code:string;message:string}|null){return ds.query(`UPDATE jobs SET status=$2,progress=$3,message=$4,result=$5,error=$6,updated_at=now() WHERE job_id=$1 RETURNING *`,[id,status,progress,message,result,error]).then((rows)=>toJob(firstQueryRow(rows)));}
function currentJob(ds:DataSource,id:string){return ds.query(`SELECT * FROM jobs WHERE job_id=$1`,[id]).then((rows)=>toJob(firstQueryRow(rows)));}
function toJob(row:any){return jobSchema.parse({jobId:row.job_id,projectId:row.project_id,type:row.type,status:row.status,progress:row.progress,message:row.message,result:row.result,error:row.error,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)});}
function iso(value:unknown){return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function firstQueryRow<T=any>(value:unknown):T { const first=Array.isArray(value)?value[0]:undefined; return (Array.isArray(first)?first[0]:first) as T; }
