import { type Job } from "@orbit/shared/jobs";
import {
  rehearsalEvaluationSnapshotSchema,
  rehearsalReportSchema,
  rehearsalRunMetaSchema,
  rehearsalSemanticEvaluationJobPayloadSchema,
  type RehearsalEvaluationSnapshot,
  type RehearsalReport,
} from "@orbit/shared/rehearsals";
import type { DataSource } from "typeorm";
import { z } from "zod";
import {
  buildSemanticAnalysisRequest,
  requestSemanticAnalysis,
  semanticEndpointFailureReason
} from "./rehearsal-stt.processor";
import type { RehearsalTranscriptCache } from "./rehearsal-transcript-cache";
import {
  derivePracticeGoalSet,
  loadPracticeGoalRankingContext,
  publishPracticeGoalSet
} from "./practice-goal-derivation";

const retryRunRowSchema = z.object({
  run_id: z.string().min(1),
  project_id: z.string().min(1),
  deck_id: z.string().min(1),
  status: z.string().min(1),
  semantic_evaluation_mode: z.enum(["full", "delivery-only"]),
  evaluation_snapshot_json: rehearsalEvaluationSnapshotSchema.nullable(),
  meta_json: z.record(z.unknown()).nullable(),
  report_json: z.record(z.unknown()).nullable(),
  analysis_revision: z.number().int().nonnegative().default(0)
});

export type RehearsalSemanticEvaluationRetryBusinessEvent = {
  event:
    | "rehearsal.semantic_evaluation.started"
    | "rehearsal.semantic_evaluation.succeeded"
    | "rehearsal.semantic_evaluation.retry_failed";
  projectId: string;
  runId: string;
  jobId: string;
  deckId?: string;
  deckVersion?: number;
  cueCount?: number;
  slideCount?: number;
  latencyMs?: number;
  reasons?: string[];
  reason?: string;
};

export async function processRehearsalSemanticEvaluationJob(
  dataSource: DataSource,
  pythonWorkerUrl: string,
  rawPayload: unknown,
  transcriptCache: Pick<RehearsalTranscriptCache, "getSemanticEvidence">,
  onEvent?: (event: RehearsalSemanticEvaluationRetryBusinessEvent) => void
): Promise<Job> {
  const payloadResult = rehearsalSemanticEvaluationJobPayloadSchema.safeParse(
    rawPayload
  );
  if (!payloadResult.success) {
    const jobId = readPayloadString(rawPayload, "jobId");
    if (!jobId) {
      throw new Error(payloadResult.error.message);
    }
    return failJob(
      dataSource,
      jobId,
      0,
      "REHEARSAL_SEMANTIC_EVALUATION_PAYLOAD_INVALID",
      payloadResult.error.message
    );
  }

  const payload = payloadResult.data;
  await updateJob(dataSource, payload.jobId, {
    status: "running",
    progress: 10,
    message: "의미 평가 재시도 준비 중",
    result: null,
    error: null
  });

  let run: z.infer<typeof retryRunRowSchema>;
  let snapshot: RehearsalEvaluationSnapshot;
  let previousReport: RehearsalReport;
  try {
    run = await loadRetryRun(dataSource, payload.runId, payload.projectId);
    if (
      run.status !== "succeeded" ||
      run.semantic_evaluation_mode !== "full" ||
      run.evaluation_snapshot_json === null ||
      run.report_json === null
    ) {
      throw new RetryEvaluationError(
        "REHEARSAL_SEMANTIC_EVALUATION_NOT_READY",
        "Rehearsal semantic evaluation is not ready for retry."
      );
    }
    snapshot = run.evaluation_snapshot_json;
    previousReport = rehearsalReportSchema.parse(run.report_json);
  } catch (error) {
    const failure = retryFailure(error, "REHEARSAL_SEMANTIC_EVALUATION_NOT_READY");
    emitEvent(onEvent, {
      event: "rehearsal.semantic_evaluation.retry_failed",
      projectId: payload.projectId,
      runId: payload.runId,
      jobId: payload.jobId,
      reason: failure.code
    });
    return failJob(
      dataSource,
      payload.jobId,
      10,
      failure.code,
      failure.message
    );
  }

  const baseEvent = semanticEventBase(payload, snapshot);
  if (previousReport.semanticEvaluation.state === "succeeded") {
    emitEvent(onEvent, {
      event: "rehearsal.semantic_evaluation.succeeded",
      ...baseEvent,
      latencyMs: 0,
      reasons: []
    });
    return completeJob(
      dataSource,
      payload.jobId,
      payload.runId,
      previousReport.semanticCueOutcomes.length
    );
  }
  if (!previousReport.semanticEvaluation.retryable) {
    const failure = {
      code: "REHEARSAL_SEMANTIC_EVALUATION_NOT_READY",
      message: "Rehearsal semantic evaluation is not retryable."
    };
    emitRetryFailure(onEvent, baseEvent, failure.code);
    return failJob(
      dataSource,
      payload.jobId,
      10,
      failure.code,
      failure.message
    );
  }

  let evidence;
  try {
    evidence = await transcriptCache.getSemanticEvidence(payload.runId);
  } catch {
    const failure = {
      code: "REHEARSAL_SEMANTIC_EVIDENCE_INVALID",
      message: "Rehearsal semantic evidence is invalid."
    };
    emitRetryFailure(onEvent, baseEvent, failure.code);
    return failJob(
      dataSource,
      payload.jobId,
      10,
      failure.code,
      failure.message
    );
  }
  if (evidence === null) {
    const failure = {
      code: "REHEARSAL_SEMANTIC_EVIDENCE_EXPIRED",
      message: "Rehearsal semantic evidence has expired."
    };
    emitRetryFailure(onEvent, baseEvent, failure.code);
    return failJob(
      dataSource,
      payload.jobId,
      10,
      failure.code,
      failure.message
    );
  }

  await updateJob(dataSource, payload.jobId, {
    status: "running",
    progress: 60,
    message: "의미 평가 재실행 중",
    result: null,
    error: null
  });
  emitEvent(onEvent, {
    event: "rehearsal.semantic_evaluation.started",
    ...baseEvent
  });

  const startedAt = Date.now();
  try {
    const runMeta = rehearsalRunMetaSchema.parse(run.meta_json ?? {});
    const request = buildSemanticAnalysisRequest(
      payload.runId,
      snapshot,
      evidence.segments,
      runMeta
    );
    const semanticResult = await requestSemanticAnalysis(
      pythonWorkerUrl,
      snapshot,
      request
    );
    if (semanticResult.semanticEvaluation.state !== "succeeded") {
      throw new RetryEvaluationError(
        "REHEARSAL_SEMANTIC_EVALUATION_INCOMPLETE",
        semanticResult.semanticEvaluation.reasons.join(",") ||
          "Semantic evaluation remained incomplete."
      );
    }

    const nextReport = rehearsalReportSchema.parse({
      ...previousReport,
      semanticEvaluation: semanticResult.semanticEvaluation,
      semanticCueOutcomes: semanticResult.semanticCueOutcomes
    });
    const update = await replaceSemanticReportFields(dataSource, payload, nextReport);
    if (update.didUpdate) {
      const rankingContext = await loadPracticeGoalRankingContext({
        executor: dataSource,
        projectId: payload.projectId,
        sourceFullRunId: payload.runId,
        snapshot
      });
      const goalSet = derivePracticeGoalSet({
        projectId: payload.projectId,
        sourceFullRunId: payload.runId,
        sourceAnalysisRevision: update.analysisRevision,
        snapshot,
        report: nextReport,
        rankingContext
      });
      if (goalSet) {
        await publishPracticeGoalSet(dataSource, goalSet, {
          evaluatedFullRunId: payload.runId,
          snapshot,
          report: nextReport
        });
      }
    }

    emitEvent(onEvent, {
      event: "rehearsal.semantic_evaluation.succeeded",
      ...baseEvent,
      latencyMs: Date.now() - startedAt,
      reasons: []
    });
    return completeJob(
      dataSource,
      payload.jobId,
      payload.runId,
      semanticResult.semanticCueOutcomes.length
    );
  } catch (error) {
    const failure = retryFailure(
      error,
      "REHEARSAL_SEMANTIC_EVALUATION_FAILED"
    );
    emitRetryFailure(onEvent, baseEvent, failure.code, Date.now() - startedAt);
    return failJob(
      dataSource,
      payload.jobId,
      60,
      failure.code,
      failure.message
    );
  }
}

class RetryEvaluationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function retryFailure(error: unknown, defaultCode: string) {
  if (error instanceof RetryEvaluationError) {
    return { code: error.code, message: error.message };
  }
  const semanticReason = semanticEndpointFailureReason(error);
  return {
    code: defaultCode,
    message: semanticReason
  };
}

function semanticEventBase(
  payload: { jobId: string; projectId: string; runId: string },
  snapshot: RehearsalEvaluationSnapshot
) {
  return {
    projectId: payload.projectId,
    deckId: snapshot.deckId,
    deckVersion: snapshot.deckVersion,
    runId: payload.runId,
    jobId: payload.jobId,
    cueCount: snapshot.slides.reduce(
      (count, slide) => count + slide.semanticCues.length,
      0
    ),
    slideCount: snapshot.slides.length
  };
}

function emitRetryFailure(
  callback: ((event: RehearsalSemanticEvaluationRetryBusinessEvent) => void) | undefined,
  baseEvent: ReturnType<typeof semanticEventBase>,
  reason: string,
  latencyMs?: number
) {
  emitEvent(callback, {
    event: "rehearsal.semantic_evaluation.retry_failed",
    ...baseEvent,
    reason,
    ...(latencyMs === undefined ? {} : { latencyMs })
  });
}

function emitEvent(
  callback: ((event: RehearsalSemanticEvaluationRetryBusinessEvent) => void) | undefined,
  event: RehearsalSemanticEvaluationRetryBusinessEvent
) {
  try {
    callback?.(event);
  } catch {
    // 업무 이벤트 로깅 실패는 재평가 결과를 바꾸지 않는다.
  }
}

async function loadRetryRun(
  dataSource: DataSource,
  runId: string,
  projectId: string
) {
  const rows = await dataSource.query(
    `
      SELECT run_id, project_id, deck_id, status, semantic_evaluation_mode,
             evaluation_snapshot_json, meta_json, report_json, analysis_revision
      FROM rehearsal_runs
      WHERE run_id = $1 AND project_id = $2
    `,
    [runId, projectId]
  );
  const row = readFirstQueryRow<unknown>(rows);
  if (!row) {
    throw new RetryEvaluationError(
      "REHEARSAL_RUN_UNAVAILABLE",
      `Rehearsal run not found: ${runId}`
    );
  }
  return retryRunRowSchema.parse(row);
}

async function replaceSemanticReportFields(
  dataSource: DataSource,
  payload: { runId: string; projectId: string },
  report: RehearsalReport
) {
  const rows = await dataSource.query(
    `
      UPDATE rehearsal_runs
      SET report_json = jsonb_set(
            jsonb_set(report_json, '{semanticEvaluation}', $3::jsonb, true),
            '{semanticCueOutcomes}', $4::jsonb, true
          ),
          analysis_revision = analysis_revision + 1,
          analysis_finalized_at = now(),
          updated_at = now()
      WHERE run_id = $1
        AND project_id = $2
        AND status = 'succeeded'
        AND report_json IS NOT NULL
        AND report_json #>> '{semanticEvaluation,retryable}' = 'true'
      RETURNING report_json, analysis_revision
    `,
    [
      payload.runId,
      payload.projectId,
      JSON.stringify(report.semanticEvaluation),
      JSON.stringify(report.semanticCueOutcomes)
    ]
  );
  const row = readFirstQueryRow<{ report_json: unknown; analysis_revision: number }>(rows);
  if (row) {
    rehearsalReportSchema.parse(row.report_json);
    return { didUpdate: true as const, analysisRevision: row.analysis_revision };
  }

  const currentRows = await dataSource.query(
    `
      SELECT report_json, analysis_revision
      FROM rehearsal_runs
      WHERE run_id = $1 AND project_id = $2 AND status = 'succeeded'
    `,
    [payload.runId, payload.projectId]
  );
  const current = readFirstQueryRow<{ report_json: unknown; analysis_revision: number }>(currentRows);
  const currentReport = current
    ? rehearsalReportSchema.safeParse(current.report_json)
    : null;
  if (
    currentReport?.success &&
    currentReport.data.semanticEvaluation.state === "succeeded"
  ) {
    return {
      didUpdate: false as const,
      analysisRevision: current?.analysis_revision ?? 0
    };
  }
  throw new RetryEvaluationError(
    "REHEARSAL_SEMANTIC_REPORT_UPDATE_CONFLICT",
    "Rehearsal semantic report could not be updated."
  );
}

function completeJob(
  dataSource: DataSource,
  jobId: string,
  runId: string,
  semanticCueOutcomeCount: number
) {
  return updateJob(dataSource, jobId, {
    status: "succeeded",
    progress: 100,
    message: "의미 평가 재시도 완료",
    result: {
      runId,
      semanticEvaluationState: "succeeded",
      semanticCueOutcomeCount
    },
    error: null
  });
}

async function failJob(
  dataSource: DataSource,
  jobId: string,
  progress: number,
  code: string,
  message: string
) {
  return updateJob(dataSource, jobId, {
    status: "failed",
    progress,
    message: "의미 평가 재시도 실패",
    result: null,
    error: { code, message }
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
  }
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
    [jobId, patch.status, patch.progress, patch.message, patch.result, patch.error]
  );
  const row = readFirstQueryRow<JobRow>(rows);
  if (!row) {
    throw new Error(`Job not found: ${jobId}`);
  }
  return rowToJob(row);
}

type JobRow = {
  job_id: string;
  project_id: string;
  type: Job["type"];
  status: Job["status"];
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function rowToJob(row: JobRow): Job {
  return {
    jobId: row.job_id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    message: row.message,
    result: row.result,
    error: row.error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function readFirstQueryRow<T>(queryResult: unknown): T | null {
  if (!Array.isArray(queryResult)) {
    return null;
  }
  const first = queryResult[0];
  return Array.isArray(first)
    ? ((first[0] as T | undefined) ?? null)
    : ((first as T | undefined) ?? null);
}

function readPayloadString(value: unknown, key: string) {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return "";
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : "";
}

function toIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp value: ${String(value)}`);
  }
  return date.toISOString();
}
