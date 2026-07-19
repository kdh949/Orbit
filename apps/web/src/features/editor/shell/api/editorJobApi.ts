import {
  deckExportEnqueueErrorSchema,
  deckExportJobResultSchema,
  getOoxmlSyncStateResponseSchema,
  pptxOoxmlGenerationJobResultSchema,
  retryOoxmlSyncResponseSchema,
  type Deck,
  type DeckExportRequest,
  type DeckExportJobResult,
  type OoxmlSyncState,
  type PptxOoxmlGenerationJobResult
} from "@orbit/shared";
import { jobSchema, type Job } from "../../../../../../../packages/shared/src/jobs/job.schema";

import { uploadProjectAsset } from "../../../projects/ProjectAssetWorkspace";
import { getPptxImportValidationMessage } from "../utils/editorFileValidation";

export async function createPptxOoxmlGenerationJob(
  projectId: string,
  fileId: string,
  fetcher: typeof fetch = fetch
): Promise<Job> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/pptx-ooxml-generations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileId })
    }
  );

  if (!response.ok) {
    throw new Error(
      await readPlainError(response, "PPTX OOXML generation job creation failed")
    );
  }

  const payload = (await response.json()) as { job?: unknown };
  return jobSchema.parse(payload.job);
}

export async function createSemanticCueExtractionJob(
  projectId: string,
  force: boolean,
  fetcher: typeof fetch = fetch
): Promise<Job> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/deck/semantic-cues`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force })
    }
  );

  if (!response.ok) {
    throw new Error(
      await readPlainError(response, "Semantic Cue extraction job creation failed")
    );
  }

  const payload = (await response.json()) as { job?: unknown };
  return jobSchema.parse(payload.job);
}

export async function waitForSemanticCueExtractionJob(
  jobId: string,
  fetcher: typeof fetch = fetch,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {}
): Promise<Job> {
  const pollIntervalMs = options.pollIntervalMs ?? 1200;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const startedAt = Date.now();

  for (;;) {
    const response = await fetcher(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok) {
      throw new Error(
        await readPlainError(response, "Semantic Cue extraction job fetch failed")
      );
    }

    const job = jobSchema.parse(await response.json());
    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Semantic Cue extraction job timed out.");
    }
    await delay(pollIntervalMs);
  }
}

export async function waitForPptxOoxmlGenerationJob(
  jobId: string,
  fetcher: typeof fetch = fetch,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {}
): Promise<Job> {
  const pollIntervalMs = options.pollIntervalMs ?? 1200;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const startedAt = Date.now();

  for (;;) {
    const response = await fetcher(`/api/jobs/${encodeURIComponent(jobId)}`);

    if (!response.ok) {
      throw new Error(
        await readPlainError(response, "PPTX OOXML generation job fetch failed")
      );
    }

    const job = jobSchema.parse(await response.json());
    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("PPTX OOXML generation job timed out.");
    }

    await delay(pollIntervalMs);
  }
}

export async function createDeckExportJob(
  projectId: string,
  input: DeckExportRequest = { format: "pptx" },
  fetcher: typeof fetch = fetch
): Promise<Job> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/deck/exports`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    }
  );

  if (!response.ok) {
    throw new Error(
      await readDeckExportError(response, "Deck export job creation failed")
    );
  }

  const payload = (await response.json()) as { job?: unknown };
  return jobSchema.parse(payload.job);
}

export async function getOoxmlSyncState(
  projectId: string,
  fetcher: typeof fetch = fetch
): Promise<OoxmlSyncState> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/deck/ooxml-sync-state`
  );
  if (!response.ok) {
    throw new Error(await readPlainError(response, "OOXML 동기화 상태를 확인하지 못했습니다."));
  }
  return getOoxmlSyncStateResponseSchema.parse(await response.json()).ooxmlSyncState;
}

export async function retryOoxmlSync(
  projectId: string,
  fetcher: typeof fetch = fetch
): Promise<OoxmlSyncState> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/deck/ooxml-sync/retry`,
    { method: "POST" }
  );
  if (!response.ok) {
    throw new Error(await readPlainError(response, "OOXML 동기화 재시도에 실패했습니다."));
  }
  return retryOoxmlSyncResponseSchema.parse(await response.json()).ooxmlSyncState;
}

export async function waitForOoxmlSync(
  projectId: string,
  initialState?: OoxmlSyncState,
  fetcher: typeof fetch = fetch,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {}
): Promise<OoxmlSyncState> {
  const pollIntervalMs = options.pollIntervalMs ?? 1200;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const startedAt = Date.now();
  let state = initialState ?? (await getOoxmlSyncState(projectId, fetcher));

  for (;;) {
    if (state.status === "synced" || state.status === "not-applicable") return state;
    if (state.status === "failed") {
      throw new Error("PPTX 원본 동기화에 실패했습니다. 동기화 재시도 후 다시 내보내세요.");
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("PPTX 원본 동기화가 완료되지 않았습니다. 잠시 후 다시 시도하세요.");
    }
    await delay(pollIntervalMs);
    state = await getOoxmlSyncState(projectId, fetcher);
  }
}

export async function ensureOoxmlReadyForExport(
  projectId: string,
  fetcher: typeof fetch = fetch
): Promise<void> {
  let state = await getOoxmlSyncState(projectId, fetcher);
  if (state.status === "stale" || state.status === "failed") {
    state = await retryOoxmlSync(projectId, fetcher);
  }
  await waitForOoxmlSync(projectId, state, fetcher);
}

export async function waitForDeckExportJob(
  jobId: string,
  fetcher: typeof fetch = fetch,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {}
): Promise<Job> {
  const pollIntervalMs = options.pollIntervalMs ?? 1200;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const startedAt = Date.now();

  for (;;) {
    const response = await fetcher(`/api/jobs/${encodeURIComponent(jobId)}`);

    if (!response.ok) {
      throw new Error(await readPlainError(response, "Deck export job fetch failed"));
    }

    const job = jobSchema.parse(await response.json());
    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Deck export job timed out.");
    }

    await delay(pollIntervalMs);
  }
}

export async function exportDeckToPptx(
  projectId: string,
  fetcher: typeof fetch = fetch
): Promise<DeckExportJobResult> {
  return exportDeck(projectId, { format: "pptx" }, fetcher);
}

export async function exportDeck(
  projectId: string,
  input: DeckExportRequest,
  fetcher: typeof fetch = fetch
): Promise<DeckExportJobResult> {
  if (input.format === "pptx") {
    await ensureOoxmlReadyForExport(projectId, fetcher);
  }
  const queuedJob = await createDeckExportJob(projectId, input, fetcher);
  const job = await waitForDeckExportJob(queuedJob.jobId, fetcher);
  if (job.status === "failed") {
    throw new Error(toDeckExportErrorMessage(job.error?.code, job.error?.message));
  }
  return deckExportJobResultSchema.parse(job.result);
}

function toDeckExportErrorMessage(code?: string, message?: string): string {
  if (code === "DECK_EXPORT_OOXML_SYNC_STALE") {
    return "최신 편집 내용의 PPTX 동기화가 완료되지 않아 내보낼 수 없습니다. 동기화 재시도 후 다시 시도하세요.";
  }
  return message ?? "Deck 내보내기에 실패했습니다.";
}

export async function uploadAndImportPptxTemplate(
  projectId: string,
  file: File,
  options: {
    fetcher?: typeof fetch;
    onPhase?: (phase: "uploading" | "importing") => void;
    pollIntervalMs?: number;
    timeoutMs?: number;
  } = {}
): Promise<PptxOoxmlGenerationJobResult> {
  const validationMessage = getPptxImportValidationMessage(file);
  if (validationMessage) {
    throw new Error(validationMessage);
  }

  const fetcher = options.fetcher ?? fetch;
  options.onPhase?.("uploading");
  const uploaded = await uploadProjectAsset(projectId, file, "pptx-import", fetcher);
  options.onPhase?.("importing");
  const queuedJob = await createPptxOoxmlGenerationJob(
    projectId,
    uploaded.fileId,
    fetcher
  );
  const job = await waitForPptxOoxmlGenerationJob(queuedJob.jobId, fetcher, {
    pollIntervalMs: options.pollIntervalMs,
    timeoutMs: options.timeoutMs
  });

  if (job.status === "failed") {
    throw new Error(job.error?.message ?? "PPTX OOXML generation failed.");
  }

  return pptxOoxmlGenerationJobResultSchema.parse(job.result);
}

export function requireMatchingPptxImportedDeck(
  importResult: Pick<PptxOoxmlGenerationJobResult, "deckId">,
  importedDeck: Deck | undefined
): Deck {
  if (!importedDeck) {
    throw new Error("변환된 PPTX Deck을 불러오지 못했습니다.");
  }

  if (importedDeck.deckId !== importResult.deckId) {
    throw new Error("변환 결과와 불러온 PPTX Deck이 일치하지 않습니다.");
  }

  return importedDeck;
}

export async function importPptxIntoEditor(
  projectId: string,
  file: File,
  options: {
    fetcher?: typeof fetch;
    onPhase?: (phase: "uploading" | "importing") => void;
    pollIntervalMs?: number;
    timeoutMs?: number;
    refetchDeck: () => Promise<Deck | undefined>;
  }
): Promise<{
  importResult: PptxOoxmlGenerationJobResult;
  importedDeck: Deck;
}> {
  const importResult = await uploadAndImportPptxTemplate(projectId, file, options);
  const importedDeck = requireMatchingPptxImportedDeck(
    importResult,
    await options.refetchDeck()
  );

  return { importResult, importedDeck };
}

async function readPlainError(response: Response, fallbackMessage: string) {
  const text = await response.text();
  return text || fallbackMessage;
}

async function readDeckExportError(
  response: Response,
  fallbackMessage: string
) {
  const text = await response.text();
  try {
    const parsed = deckExportEnqueueErrorSchema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data.message;
  } catch {
    // Plain-text and empty error bodies are handled by the existing fallback.
  }
  return text || fallbackMessage;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
