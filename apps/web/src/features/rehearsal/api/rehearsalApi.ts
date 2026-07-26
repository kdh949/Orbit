import { demoIds } from "@orbit/shared/common";
import type { BriefRef, EvaluatorLensRef } from "@orbit/shared/coaching";
import type {
  Deck,
  GetDeckResponse,
  PutDeckResponse,
} from "@orbit/shared/deck";
import type { AssetUploadUrlResponse } from "@orbit/shared/files";
import type { Job } from "@orbit/shared/jobs";
import {
  createRehearsalEvaluationSnapshot,
  type CompleteRehearsalAudioUploadResponse,
  type CreateRehearsalAudioUploadUrlResponse,
  type CreateRehearsalRunResponse,
  type GetRehearsalReportResponse,
  type RehearsalEvaluationSnapshot,
  type RehearsalRun,
  type RehearsalRunMeta,
  type RetryRehearsalSemanticEvaluationResponse,
  type SlideTranscriptSnapshot,
  type UpdateRehearsalRunMetaRequest,
} from "@orbit/shared/rehearsals";

import { readRehearsalErrorMessage as readErrorMessage } from "../rehearsalErrorHandling";

export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type RehearsalFlowStage =
  | "deck"
  | "run"
  | "upload-url"
  | "storage-put"
  | "meta"
  | "cancel"
  | "complete"
  | "job-poll"
  | "run-fetch"
  | "report-fetch"
  | "semantic-retry";

export type RehearsalReportStatus =
  | "idle"
  | "loading"
  | "ready"
  | "not-ready"
  | "unavailable"
  | "failed";

export class RehearsalFlowError extends Error {
  constructor(
    readonly stage: RehearsalFlowStage,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RehearsalFlowError";
  }
}

export async function fetchRehearsalDeck(
  projectId: string = demoIds.projectId,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/deck`,
  );
  if (!response.ok) {
    throw new RehearsalFlowError(
      "deck",
      await readErrorMessage(response, "발표 자료를 불러오지 못했습니다."),
    );
  }

  const payload = (await response.json()) as GetDeckResponse;
  return payload.deck;
}

export async function fetchOrCreateRehearsalDeck(
  options: {
    projectId?: string;
    fallbackDeck?: Deck;
    fetcher?: Fetcher;
  } = {},
) {
  const projectId =
    options.projectId ?? options.fallbackDeck?.projectId ?? demoIds.projectId;
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/deck`,
  );

  if (response.ok) {
    const payload = (await response.json()) as GetDeckResponse;
    return payload.deck;
  }

  if (response.status === 404 && options.fallbackDeck) {
    const putResponse = await fetcher(
      `/api/v1/projects/${encodeURIComponent(projectId)}/deck`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deck: options.fallbackDeck,
          snapshotReason: "deck-replaced",
        }),
      },
    );

    if (!putResponse.ok) {
      throw new RehearsalFlowError(
        "deck",
        await readErrorMessage(
          putResponse,
          "리허설 발표 자료를 초기화하지 못했습니다.",
        ),
      );
    }

    const payload = (await putResponse.json()) as PutDeckResponse;
    return payload.deck;
  }

  if (
    options.fallbackDeck &&
    (response.status === 401 || response.status === 403)
  ) {
    return options.fallbackDeck;
  }

  throw new RehearsalFlowError(
    "deck",
    await readErrorMessage(response, "발표 자료를 불러오지 못했습니다."),
  );
}

export async function createRehearsalRun(
  projectId: string,
  deckId: string,
  fetcher: Fetcher = fetch,
  options: {
    expectedDeckVersion?: number;
    semanticEvaluationMode?: "full" | "delivery-only";
    coachingContext?: {
      briefRef: BriefRef;
      evaluatorLensRef: EvaluatorLensRef;
      sourceGoalSetId: string | null;
    };
    slideSnapshots?: Array<{ fileId: string; slideId: string }>;
  } = {},
) {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/rehearsals`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deckId,
        ...(options.expectedDeckVersion === undefined
          ? {}
          : { expectedDeckVersion: options.expectedDeckVersion }),
        ...(options.semanticEvaluationMode === undefined
          ? {}
          : { semanticEvaluationMode: options.semanticEvaluationMode }),
        ...(options.slideSnapshots === undefined
          ? {}
          : { slideSnapshots: options.slideSnapshots }),
        ...(options.coachingContext ?? {}),
      }),
    },
  );

  if (!response.ok) {
    throw new RehearsalFlowError(
      "run",
      await readErrorMessage(response, "리허설 실행을 만들지 못했습니다."),
      response.status,
    );
  }

  return (await response.json()) as CreateRehearsalRunResponse;
}

export async function cancelRehearsalRun(
  runId: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/rehearsals/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" },
  );

  if (!response.ok) {
    throw new RehearsalFlowError(
      "cancel",
      await readErrorMessage(response, "리허설 실행을 취소하지 못했습니다."),
      response.status,
    );
  }

  return ((await response.json()) as { run: RehearsalRun }).run;
}

export async function createRehearsalRunForUpload(
  projectId: string,
  deckId: string,
  expectedDeckVersion: number,
  fetcher: Fetcher = fetch,
  coachingContext?: {
    briefRef: BriefRef;
    evaluatorLensRef: EvaluatorLensRef;
    sourceGoalSetId: string | null;
  },
  slideSnapshots?: Array<{ fileId: string; slideId: string }>,
) {
  try {
    const created = await createRehearsalRun(projectId, deckId, fetcher, {
      expectedDeckVersion,
      semanticEvaluationMode: "full",
      coachingContext,
      slideSnapshots,
    });
    return { run: created.run, evaluationSnapshotMismatch: false };
  } catch (cause) {
    if (!(cause instanceof RehearsalFlowError) || cause.status !== 409) {
      throw cause;
    }

    const deliveryOnly = await createRehearsalRun(projectId, deckId, fetcher, {
      expectedDeckVersion,
      semanticEvaluationMode: "delivery-only",
      slideSnapshots,
    });
    return { run: deliveryOnly.run, evaluationSnapshotMismatch: true };
  }
}

export async function prepareRehearsalEvaluationRun(
  deck: Deck,
  fetcher: Fetcher = fetch,
  coachingContext?: {
    briefRef: BriefRef;
    evaluatorLensRef: EvaluatorLensRef;
    sourceGoalSetId: string | null;
  },
  slideSnapshots?: Array<{ fileId: string; slideId: string }>,
): Promise<{
  run: RehearsalRun | null;
  evaluationSnapshot: RehearsalEvaluationSnapshot;
  serverEvaluation:
    | { state: "available" }
    | { state: "unavailable"; reason: "network_error" };
}> {
  const provisionalSnapshot = createRehearsalEvaluationSnapshot(deck);
  try {
    const created = await createRehearsalRun(
      deck.projectId,
      deck.deckId,
      fetcher,
      {
        expectedDeckVersion: deck.version,
        semanticEvaluationMode: "full",
        coachingContext,
        slideSnapshots,
      },
    );
    return {
      run: created.run,
      evaluationSnapshot: created.run.evaluationSnapshot ?? provisionalSnapshot,
      serverEvaluation: { state: "available" },
    };
  } catch {
    return {
      run: null,
      evaluationSnapshot: provisionalSnapshot,
      serverEvaluation: { state: "unavailable", reason: "network_error" },
    };
  }
}

export async function requestRehearsalAudioUploadUrl(
  runId: string,
  file: File,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/rehearsals/${encodeURIComponent(runId)}/audio/upload-url`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        originalName: file.name,
        mimeType: file.type || "audio/webm",
        size: file.size,
      }),
    },
  );

  if (!response.ok) {
    throw new RehearsalFlowError(
      "upload-url",
      await readErrorMessage(
        response,
        "리허설 오디오 업로드 URL을 발급하지 못했습니다.",
      ),
    );
  }

  return (await response.json()) as CreateRehearsalAudioUploadUrlResponse;
}

export async function uploadRehearsalAudio(
  upload: AssetUploadUrlResponse,
  file: File,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(upload.uploadUrl, {
    method: upload.method,
    headers: upload.headers,
    body: file,
  });

  if (!response.ok) {
    throw new RehearsalFlowError(
      "storage-put",
      await readErrorMessage(
        response,
        "리허설 오디오 업로드가 중단되었습니다.",
      ),
    );
  }
}

export async function completeRehearsalAudioUpload(
  runId: string,
  fileId: string,
  liveTranscriptOrFetcher: string | null | Fetcher = null,
  fetcher: Fetcher = fetch,
  slideTranscriptSnapshots: SlideTranscriptSnapshot[] = [],
) {
  const liveTranscript =
    typeof liveTranscriptOrFetcher === "function"
      ? null
      : liveTranscriptOrFetcher;
  const requestFetcher =
    typeof liveTranscriptOrFetcher === "function"
      ? liveTranscriptOrFetcher
      : fetcher;
  const response = await requestFetcher(
    `/api/v1/rehearsals/${encodeURIComponent(runId)}/audio/complete`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileId,
        liveTranscript,
        slideTranscriptSnapshots,
      }),
    },
  );

  if (!response.ok) {
    throw new RehearsalFlowError(
      "complete",
      await readErrorMessage(
        response,
        "리허설 음성 분석 작업을 시작하지 못했습니다.",
      ),
    );
  }

  return (await response.json()) as CompleteRehearsalAudioUploadResponse;
}

export async function updateRehearsalRunMeta(
  runId: string,
  meta: UpdateRehearsalRunMetaRequest,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/rehearsals/${encodeURIComponent(runId)}/meta`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(meta),
    },
  );

  if (!response.ok) {
    throw new RehearsalFlowError(
      "meta",
      await readErrorMessage(
        response,
        "리허설 진행 메타데이터를 저장하지 못했습니다.",
      ),
    );
  }
}

export async function fetchRehearsalRun(
  runId: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/rehearsals/${encodeURIComponent(runId)}`,
  );
  if (!response.ok) {
    throw new RehearsalFlowError(
      "run-fetch",
      await readErrorMessage(
        response,
        "리허설 실행 상태를 불러오지 못했습니다.",
      ),
    );
  }

  const payload = (await response.json()) as { run: RehearsalRun };
  return payload.run;
}

export async function fetchRehearsalReport(
  runId: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/rehearsals/${encodeURIComponent(runId)}/report`,
  );
  if (!response.ok) {
    throw new RehearsalFlowError(
      "report-fetch",
      await readErrorMessage(response, "리허설 보고서를 불러오지 못했습니다."),
    );
  }

  return (await response.json()) as GetRehearsalReportResponse;
}

export async function retryRehearsalSemanticEvaluation(
  runId: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/rehearsals/${encodeURIComponent(runId)}/semantic-evaluation/retry`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new RehearsalFlowError(
      "semantic-retry",
      await readSemanticRetryError(response),
      response.status,
    );
  }

  const payload =
    (await response.json()) as RetryRehearsalSemanticEvaluationResponse;
  return payload.job;
}

export function resolveRehearsalReportLoadState(
  response: GetRehearsalReportResponse,
  requestedProjectId: string,
): { error: string; status: RehearsalReportStatus } {
  if (response.run.projectId !== requestedProjectId) {
    return {
      error: "요청한 프로젝트와 리허설 실행 정보가 일치하지 않습니다.",
      status: "failed",
    };
  }

  if (response.run.status === "failed") {
    return {
      error: response.run.error?.message || "리허설 분석 작업이 실패했습니다.",
      status: "failed",
    };
  }

  if (response.report) {
    return { error: "", status: "ready" };
  }

  if (response.run.status === "succeeded" && !response.run.jobId) {
    return { error: "", status: "unavailable" };
  }

  return { error: "", status: "not-ready" };
}

export async function fetchProjectRehearsalRuns(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<RehearsalRun[]> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/rehearsals`,
    { credentials: "include" },
  );
  if (!response.ok) return [];
  const data = (await response.json()) as { runs: RehearsalRun[] };
  return data.runs ?? [];
}

export async function pollRehearsalJob(
  jobId: string,
  options: {
    delayMs?: number;
    fetcher?: Fetcher;
    onUpdate?: (job: Job) => void;
    timeoutMs?: number;
  } = {},
) {
  const delayMs = options.delayMs ?? 1000;
  const fetcher = options.fetcher ?? fetch;
  const timeoutAt = Date.now() + (options.timeoutMs ?? 120_000);

  for (;;) {
    const response = await fetcher(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok) {
      throw new RehearsalFlowError(
        "job-poll",
        await readErrorMessage(
          response,
          "리허설 분석 작업 상태를 불러오지 못했습니다.",
        ),
      );
    }

    const job = (await response.json()) as Job;
    options.onUpdate?.(job);
    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }

    if (Date.now() > timeoutAt) {
      throw new RehearsalFlowError(
        "job-poll",
        "리허설 분석 작업이 제한 시간 안에 끝나지 않았습니다.",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export async function runRehearsalUploadFlow(options: {
  runId: string;
  audioFile: File;
  fetcher?: Fetcher;
  onJobUpdate?: (job: Job) => void;
  pollDelayMs?: number;
  pollTimeoutMs?: number;
  runMeta?: RehearsalRunMeta | null;
  liveTranscript?: string | null;
  slideTranscriptSnapshots?: SlideTranscriptSnapshot[];
  slideTimeline?: UpdateRehearsalRunMetaRequest["slideTimeline"];
}) {
  const fetcher = options.fetcher ?? fetch;
  const uploadResponse = await requestRehearsalAudioUploadUrl(
    options.runId,
    options.audioFile,
    fetcher,
  );

  await uploadRehearsalAudio(uploadResponse.upload, options.audioFile, fetcher);

  const runMeta =
    options.runMeta ??
    (options.slideTimeline?.length
      ? {
          recordingDurationSeconds: null,
          slideTimeline: options.slideTimeline,
          missedKeywords: [],
          adviceEvents: [],
          utteranceOutcomes: [],
          semanticCueDecisions: [],
          semanticCapabilityEvents: [],
        }
      : null);

  if (
    runMeta &&
    (runMeta.slideTimeline.length > 0 ||
      runMeta.missedKeywords.length > 0 ||
      runMeta.adviceEvents.length > 0 ||
      runMeta.utteranceOutcomes.length > 0 ||
      runMeta.semanticCueDecisions.length > 0 ||
      runMeta.semanticCapabilityEvents.length > 0)
  ) {
    try {
      await updateRehearsalRunMeta(options.runId, runMeta, fetcher);
    } catch {
      // Report generation can continue without optional slide timing metadata.
    }
  }

  const completed = await completeRehearsalAudioUpload(
    options.runId,
    uploadResponse.upload.fileId,
    options.liveTranscript ?? null,
    fetcher,
    options.slideTranscriptSnapshots ?? [],
  );
  const job = await pollRehearsalJob(completed.job.jobId, {
    fetcher,
    delayMs: options.pollDelayMs,
    timeoutMs: options.pollTimeoutMs,
    onUpdate: options.onJobUpdate,
  });
  const run = await fetchRehearsalRun(options.runId, fetcher);

  return { run, job };
}

async function readSemanticRetryError(response: Response) {
  const raw = await response.text();
  let code = "";
  try {
    const payload = JSON.parse(raw) as { code?: unknown };
    code = typeof payload.code === "string" ? payload.code : "";
  } catch {
    // The report UI intentionally does not expose raw server error details.
  }

  if (code === "REHEARSAL_SEMANTIC_EVIDENCE_EXPIRED") {
    return "재평가 가능 시간이 지났습니다. 새 리허설을 시작해 주세요.";
  }
  if (code === "REHEARSAL_SEMANTIC_EVALUATION_NOT_READY") {
    return "현재 리포트는 서버 재평가를 시작할 수 없습니다.";
  }
  return "서버 재평가를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
