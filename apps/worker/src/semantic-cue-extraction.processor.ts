import {
  deckSchema,
  semanticCueExtractionJobPayloadSchema,
  semanticCueExtractionResultSchema,
  semanticCueExtractionSlideStatusSchema,
  semanticCueSchema,
  type Deck,
  type SemanticCue,
  type SemanticCueExtractionResult,
} from "@orbit/shared/deck";
import { type Job } from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { z } from "zod";

const pythonSemanticCueExtractionSlideSchema = z
  .object({
    slideId: z.string().min(1),
    status: semanticCueExtractionSlideStatusSchema.optional(),
    semanticCues: z.array(semanticCueSchema).default([]),
    warnings: z.array(z.string().trim().min(1).max(160)).default([])
  })
  .strict();

const pythonSemanticCueExtractionResultSchema = z
  .object({
    deckId: z.string().min(1),
    sourceDeckVersion: z.number().int().positive().optional(),
    slides: z.array(pythonSemanticCueExtractionSlideSchema).default([])
  })
  .strict();

const deckRowSchema = z.object({
  deck_json: z.record(z.unknown()),
  version: z.number().int().positive(),
  deck_id: z.string().min(1)
});

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

class SemanticCueDeckVersionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticCueDeckVersionConflictError";
  }
}

export async function processSemanticCueExtractionJob(
  dataSource: DataSource,
  pythonWorkerUrl: string,
  rawPayload: unknown
): Promise<Job> {
  const payloadResult = semanticCueExtractionJobPayloadSchema.safeParse(rawPayload);
  if (!payloadResult.success) {
    const jobId = readPayloadJobId(rawPayload);
    if (!jobId) {
      throw new Error(payloadResult.error.message);
    }
    return failJob(
      dataSource,
      jobId,
      0,
      "SEMANTIC_CUE_PAYLOAD_INVALID",
      payloadResult.error.message
    );
  }

  const payload = payloadResult.data;
  await updateJob(dataSource, payload.jobId, {
    status: "running",
    progress: 10,
    message: "Semantic cue extraction input loading.",
    result: null,
    error: null
  });

  let deck: Deck;
  try {
    deck = await loadExtractionDeck(
      dataSource,
      payload.projectId,
      payload.request.deckId,
      payload.request.baseVersion
    );
  } catch (error) {
    if (error instanceof SemanticCueDeckVersionConflictError) {
      return failJob(
        dataSource,
        payload.jobId,
        10,
        "SEMANTIC_CUE_DECK_VERSION_CONFLICT",
        error.message
      );
    }
    return failJob(
      dataSource,
      payload.jobId,
      10,
      "SEMANTIC_CUE_DECK_UNAVAILABLE",
      error instanceof Error ? error.message : "Semantic cue deck unavailable."
    );
  }

  const targetSlides = deck.slides.filter(
    (slide) => payload.request.force || shouldExtractSlide(slide.semanticCues)
  );
  if (targetSlides.length === 0) {
    return completeJob(dataSource, payload.jobId, deck, deck.version, [], 0);
  }

  await updateJob(dataSource, payload.jobId, {
    status: "running",
    progress: 45,
    message: "Semantic cue extraction running.",
    result: null,
    error: null
  });

  let providerPayload: unknown;
  try {
    const response = await fetch(workerUrl(pythonWorkerUrl, "/ai/extract-semantic-cues"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: payload.projectId,
        deck: { ...deck, slides: targetSlides }
      }),
      signal: AbortSignal.timeout(120_000)
    });

    if (!response.ok) {
      return failJob(
        dataSource,
        payload.jobId,
        45,
        "PYTHON_WORKER_SEMANTIC_CUE_FAILED",
        "Python worker semantic cue extraction failed."
      );
    }

    providerPayload = await response.json();
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      45,
      "PYTHON_WORKER_SEMANTIC_CUE_UNAVAILABLE",
      error instanceof Error ? error.message : "Python worker semantic cue extraction unavailable."
    );
  }

  let extraction: SemanticCueExtractionResult;
  try {
    extraction = normalizeProviderExtraction(
      pythonSemanticCueExtractionResultSchema.parse(providerPayload),
      deck,
      new Set(targetSlides.map((slide) => slide.slideId)),
      payload.request.baseVersion
    );
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      70,
      "SEMANTIC_CUE_RESULT_INVALID",
      error instanceof Error ? error.message : "Semantic cue result invalid."
    );
  }

  let merged: ReturnType<typeof mergeExtractionResult>;
  try {
    merged = mergeExtractionResult(
      deck,
      extraction,
      new Set(targetSlides.map((slide) => slide.slideId)),
      payload.request.force
    );
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      70,
      "SEMANTIC_CUE_RESULT_INVALID",
      error instanceof Error ? error.message : "Semantic cue result invalid."
    );
  }

  if (merged.processedSlideCount === 0) {
    return completeJob(
      dataSource,
      payload.jobId,
      deck,
      payload.request.baseVersion,
      merged.warnings,
      0
    );
  }

  try {
    const saved = await saveDeckCheckpointWithCas(
      dataSource,
      merged.deck,
      payload.request.baseVersion
    );
    if (!saved) {
      return failJob(
        dataSource,
        payload.jobId,
        85,
        "SEMANTIC_CUE_DECK_VERSION_CONFLICT",
        "Deck changed after semantic cue extraction started."
      );
    }
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      85,
      "SEMANTIC_CUE_DECK_SAVE_FAILED",
      error instanceof Error ? error.message : "Semantic cue deck save failed."
    );
  }

  return completeJob(
    dataSource,
    payload.jobId,
    merged.deck,
    payload.request.baseVersion,
    merged.warnings,
    merged.processedSlideCount
  );
}

async function loadExtractionDeck(
  dataSource: DataSource,
  projectId: string,
  deckId: string,
  baseVersion: number
): Promise<Deck> {
  const rows = await dataSource.query(
    `SELECT deck_id, deck_json, version FROM decks WHERE project_id = $1 AND deck_id = $2`,
    [projectId, deckId]
  );
  const row = deckRowSchema.parse(readFirstQueryRow<unknown>(rows));
  const deck = deckSchema.parse(row.deck_json);

  if (row.version !== baseVersion || deck.version !== baseVersion) {
    throw new SemanticCueDeckVersionConflictError(
      "Deck version does not match the extraction baseVersion."
    );
  }

  const patchRows = await dataSource.query(
    `SELECT 1 FROM deck_patches WHERE project_id = $1 AND deck_id = $2 AND after_version > $3 LIMIT 1`,
    [projectId, deckId, baseVersion]
  );
  if (readFirstQueryRow<unknown>(patchRows)) {
    throw new SemanticCueDeckVersionConflictError(
      "Deck has pending patches after the extraction baseVersion."
    );
  }

  return deck;
}

function shouldExtractSlide(cues: SemanticCue[]): boolean {
  return (
    cues.length === 0 ||
    cues.some(
      (cue) =>
        !isProtectedCue(cue) &&
        (cue.freshness === "stale" ||
          (cue.origin === "ai" && cue.reviewStatus === "suggested"))
    )
  );
}

function normalizeProviderExtraction(
  providerResult: z.infer<typeof pythonSemanticCueExtractionResultSchema>,
  deck: Deck,
  targetSlideIds: Set<string>,
  baseVersion: number
): SemanticCueExtractionResult {
  if (providerResult.deckId !== deck.deckId) {
    throw new Error("Semantic cue extraction returned another deckId.");
  }
  if (
    providerResult.sourceDeckVersion !== undefined &&
    providerResult.sourceDeckVersion !== baseVersion
  ) {
    throw new Error("Semantic cue extraction returned another sourceDeckVersion.");
  }

  const slidesById = new Map(deck.slides.map((slide) => [slide.slideId, slide]));
  return semanticCueExtractionResultSchema.parse({
    deckId: providerResult.deckId,
    sourceDeckVersion: baseVersion,
    slides: providerResult.slides.map((result) => {
      if (!targetSlideIds.has(result.slideId)) {
        throw new Error("Semantic cue extraction returned an untargeted slide.");
      }
      const existingSlide = slidesById.get(result.slideId);
      if (!existingSlide) {
        throw new Error("Semantic cue extraction returned an unknown slide.");
      }

      const legacyEmptyResult =
        result.status === undefined &&
        result.semanticCues.length === 0 &&
        existingSlide.semanticCues.length > 0;
      return {
        slideId: result.slideId,
        status: result.status ?? (legacyEmptyResult ? "skipped" : "succeeded"),
        semanticCues: result.semanticCues,
        warnings: legacyEmptyResult
          ? [...result.warnings, "empty-slide-result-preserved"]
          : result.warnings
      };
    })
  });
}

function mergeExtractionResult(
  deck: Deck,
  extraction: SemanticCueExtractionResult,
  targetSlideIds: Set<string>,
  force: boolean
): { deck: Deck; warnings: string[]; processedSlideCount: number } {
  if (
    extraction.deckId !== deck.deckId ||
    extraction.sourceDeckVersion !== deck.version
  ) {
    throw new Error("Semantic cue extraction source does not match the loaded deck.");
  }

  const resultBySlideId = new Map(
    extraction.slides.map((result) => [result.slideId, result])
  );
  const warnings: string[] = [];
  let processedSlideCount = 0;
  const slides = deck.slides.map((slide) => {
    const result = resultBySlideId.get(slide.slideId);
    if (!result) {
      if (targetSlideIds.has(slide.slideId)) {
        warnings.push(`provider-omitted-slide:${slide.slideId}`);
      }
      return slide;
    }

    warnings.push(...result.warnings.map((warning) => `${slide.slideId}:${warning}`));
    if (result.status !== "succeeded") {
      return slide;
    }

    processedSlideCount += 1;
    const preserved = slide.semanticCues.filter((cue) => shouldPreserveCue(cue, force));
    const preservedIds = new Set(preserved.map((cue) => cue.cueId));
    const generated = result.semanticCues
      .filter((cue) => {
        if (!preservedIds.has(cue.cueId)) {
          return true;
        }
        warnings.push(`protected-cue-id-collision:${slide.slideId}:${cue.cueId}`);
        return false;
      })
      .map((cue) => {
        const hasStableIdentity = cue.sourceFingerprint !== undefined;
        return {
          ...cue,
          reviewStatus: hasStableIdentity ? cue.reviewStatus : ("suggested" as const),
          freshness: "current" as const,
          origin: hasStableIdentity ? cue.origin : ("ai" as const),
          sourceDeckVersion: deck.version
        };
      });

    return { ...slide, semanticCues: [...preserved, ...generated] };
  });

  return {
    deck: deckSchema.parse({ ...deck, version: deck.version + 1, slides }),
    warnings,
    processedSlideCount
  };
}

function shouldPreserveCue(cue: SemanticCue, force: boolean): boolean {
  if (isProtectedCue(cue)) {
    return true;
  }
  if (force) {
    return false;
  }
  return !(
    cue.freshness === "stale" ||
    (cue.origin === "ai" && cue.reviewStatus === "suggested")
  );
}

function isProtectedCue(cue: SemanticCue): boolean {
  return cue.origin === "manual" || cue.reviewStatus === "approved";
}

async function saveDeckCheckpointWithCas(
  dataSource: DataSource,
  deck: Deck,
  baseVersion: number
): Promise<boolean> {
  const rows = await dataSource.query(
    `
      UPDATE decks
      SET deck_json = $3,
          version = $4,
          updated_at = now()
      WHERE project_id = $1
        AND deck_id = $2
        AND version = $5
        AND NOT EXISTS (
          SELECT 1
          FROM deck_patches
          WHERE project_id = $1
            AND deck_id = $2
            AND after_version > $5
        )
      RETURNING version
    `,
    [deck.projectId, deck.deckId, deck, deck.version, baseVersion]
  );
  return readFirstQueryRow<unknown>(rows) !== null;
}

function completeJob(
  dataSource: DataSource,
  jobId: string,
  deck: Deck,
  sourceDeckVersion: number,
  warnings: string[],
  processedSlideCount: number
): Promise<Job> {
  return updateJob(dataSource, jobId, {
    status: "succeeded",
    progress: 100,
    message: "Semantic cue extraction completed.",
    result: {
      deckId: deck.deckId,
      sourceDeckVersion,
      version: deck.version,
      cueCount: deck.slides.reduce(
        (sum, slide) => sum + slide.semanticCues.length,
        0
      ),
      processedSlideCount,
      warnings
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
): Promise<Job> {
  return updateJob(dataSource, jobId, {
    status: "failed",
    progress,
    message: "Semantic cue extraction failed.",
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

function readPayloadJobId(rawPayload: unknown): string {
  return rawPayload &&
    typeof rawPayload === "object" &&
    "jobId" in rawPayload &&
    typeof rawPayload.jobId === "string"
    ? rawPayload.jobId
    : "";
}

function readFirstQueryRow<T>(queryResult: unknown): T | null {
  if (!Array.isArray(queryResult)) {
    return null;
  }
  const first = queryResult[0];
  if (Array.isArray(first)) {
    return (first[0] as T | undefined) ?? null;
  }
  return (first as T | undefined) ?? null;
}

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

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp value: ${String(value)}`);
  }
  return date.toISOString();
}

function workerUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}
