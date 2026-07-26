import {
  challengeAnswerGuideSchema,
  challengeQnaGenerationJobPayloadSchema,
  challengeQnaGenerationJobResultSchema,
  challengeSourceReferenceSchema,
} from "@orbit/shared/coaching";
import { jobSchema, type Job } from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { z } from "zod";

const generatedQuestionSchema = z.object({
  questionType: z.enum(["clarification", "evidence", "objection", "decision"]),
  difficulty: z.enum(["standard", "challenging"]),
  questionText: z.string().trim().min(1).max(500),
  linkedGoalIds: z.array(z.string()).max(3),
  sourceRefs: z.array(challengeSourceReferenceSchema).max(20),
  answerGuide: challengeAnswerGuideSchema,
}).strict();
const responseSchema = z.object({ questions: z.array(generatedQuestionSchema).min(1).max(3) }).strict();

export async function processChallengeQnaGenerationJob(dataSource: DataSource, pythonWorkerUrl: string, rawPayload: unknown): Promise<Job> {
  const payload = challengeQnaGenerationJobPayloadSchema.parse(rawPayload);
  const rows = await dataSource.query(`SELECT * FROM challenge_qna_sessions WHERE qna_session_id=$1 AND project_id=$2`, [payload.qnaSessionId, payload.projectId]);
  const row = firstQueryRow<any>(rows);
  if (!row || row.generation_revision !== payload.generationRevision || row.status !== "preparing") return currentJob(dataSource, payload.jobId);
  await updateJob(dataSource, payload.jobId, "running", 20, "질문 근거 확인 중", null, null);
  try {
    const response = await fetch(new URL("/challenge-qna/generate", pythonWorkerUrl), {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ source: row.source_json, sourceSnapshot: row.source_snapshot_json, groundingSnapshot: row.grounding_snapshot_json }),
    });
    if (!response.ok) throw new Error("QNA_GENERATION_FAILED");
    const result = responseSchema.parse(await response.json());
    if (result.questions.length !== Number(row.source_json.questionCount)) throw new Error("QNA_GENERATION_FAILED");
    validateSources(result.questions, row.source_snapshot_json, row.grounding_snapshot_json);
    await dataSource.transaction(async (manager) => {
      const locked = (await manager.query(`SELECT generation_revision,status FROM challenge_qna_sessions WHERE qna_session_id=$1 FOR UPDATE`, [payload.qnaSessionId]))[0];
      if (!locked || locked.generation_revision !== payload.generationRevision || locked.status !== "preparing") return;
      for (const [index, question] of result.questions.entries()) {
        await manager.query(`INSERT INTO challenge_qna_questions (
          question_id,project_id,qna_session_id,revision,question_order,question_type,difficulty,question_text,
          linked_goal_ids_json,source_refs_json,answer_guide_json,provenance_json,created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())`, [
          `question_${payload.qnaSessionId}_${payload.generationRevision}_${index + 1}`.slice(0, 128), payload.projectId,
          payload.qnaSessionId, payload.generationRevision, index + 1, question.questionType, question.difficulty,
          question.questionText, JSON.stringify(question.linkedGoalIds), JSON.stringify(question.sourceRefs), question.answerGuide,
          { generator: "orbit-python-provider", model: "grounded-rule-v1", schemaVersion: 1, promptTemplateVersion: "challenge-qna-v1" },
        ]);
      }
      await manager.query(`UPDATE challenge_qna_sessions SET status='ready',active_question_order=1,error_code=NULL WHERE qna_session_id=$1 AND generation_revision=$2`, [payload.qnaSessionId, payload.generationRevision]);
    });
    const jobResult = challengeQnaGenerationJobResultSchema.parse({
      qnaSessionId: payload.qnaSessionId,
      generationRevision: payload.generationRevision,
      questionCount: result.questions.length,
    });
    return updateJob(dataSource, payload.jobId, "succeeded", 100, "질문 준비 완료", jobResult, null);
  } catch {
    await dataSource.query(`UPDATE challenge_qna_sessions SET status='failed',error_code='QNA_GENERATION_FAILED' WHERE qna_session_id=$1 AND generation_revision=$2 AND status='preparing'`, [payload.qnaSessionId, payload.generationRevision]);
    return updateJob(dataSource, payload.jobId, "failed", 100, "질문 준비 실패", null, { code: "QNA_GENERATION_FAILED", message: "Challenge Q&A generation failed." });
  }
}

function validateSources(questions: z.infer<typeof responseSchema>["questions"], source: any, grounding: any) {
  const allowedSlides = new Set(source.deck.slides.map((slide: any) => `${slide.slideId}:${slide.contentHash}`));
  const allowedChunks = new Set((grounding?.chunks ?? []).map((chunk: any) => `${chunk.fileId}:${chunk.fileContentHash}:${chunk.chunkId}:${chunk.contentHash}`));
  for (const reference of questions.flatMap((question) => question.sourceRefs.concat(question.answerGuide.mustIncludeConcepts.flatMap((concept) => concept.sourceRefs)))) {
    const allowed = reference.type === "slide"
      ? allowedSlides.has(`${reference.slideId}:${reference.contentHash}`)
      : allowedChunks.has(`${reference.fileId}:${reference.fileContentHash}:${reference.chunkId}:${reference.contentHash}`);
    if (!allowed) throw new Error("QNA_SOURCE_NOT_APPROVED");
  }
}

function updateJob(dataSource: DataSource, jobId: string, status: "running" | "succeeded" | "failed", progress: number, message: string, result: Record<string, unknown> | null, error: { code: string; message: string } | null) {
  return dataSource.query(`UPDATE jobs SET status=$2,progress=$3,message=$4,result=$5,error=$6,updated_at=now() WHERE job_id=$1 RETURNING *`, [jobId,status,progress,message,result,error]).then((rows) => toJob(firstQueryRow(rows)));
}
function currentJob(dataSource: DataSource, jobId: string) { return dataSource.query(`SELECT * FROM jobs WHERE job_id=$1`, [jobId]).then((rows) => toJob(firstQueryRow(rows))); }
function toJob(row: any) { return jobSchema.parse({ jobId: row.job_id,projectId:row.project_id,type:row.type,status:row.status,progress:row.progress,message:row.message,result:row.result,error:row.error,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at) }); }
function iso(value: unknown) { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }
function firstQueryRow<T=any>(value:unknown):T { const first=Array.isArray(value)?value[0]:undefined; return (Array.isArray(first)?first[0]:first) as T; }
