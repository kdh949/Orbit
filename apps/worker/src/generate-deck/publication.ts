import {
  generateDeckJobResultSchema,
  generateDeckResponseSchema,
  type Deck,
  type GenerateDeckDiagnostics,
  type GenerateDeckRequest,
  type GenerateDeckValidation,
} from "@orbit/shared/deck";
import { type Job } from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { allValidationIssues } from "./semantic-quality";

type GenerateDeckWorkerPayload = ReturnType<
  typeof generateDeckResponseSchema.parse
>;

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

type GenerateDeckJobPatch = {
  status: "running" | "succeeded" | "failed";
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
};

export async function publishGenerateDeckResult(input: {
  dataSource: DataSource;
  jobId: string;
  projectId: string;
  workerPayload: GenerateDeckWorkerPayload;
  deck: Deck;
  warnings: string[];
  validation: GenerateDeckValidation;
  diagnostics: GenerateDeckDiagnostics;
  coachingProvenance?: GenerateDeckRequest["coachingContext"];
  emitEvent: (event: string, fields: Record<string, unknown>) => void;
}): Promise<Job> {
  let result: ReturnType<typeof generateDeckJobResultSchema.parse>;
  try {
    await saveDeck(input.dataSource, input.deck);
    input.emitEvent("ai-ppt.deck.published", {
      jobId: input.jobId,
      projectId: input.projectId,
      deckId: input.deck.deckId,
      slideCount: input.deck.slides.length,
    });
    result = generateDeckJobResultSchema.parse({
      deckId: input.deck.deckId,
      ...input.workerPayload,
      warnings: input.warnings,
      validation: input.validation,
      diagnostics: input.diagnostics,
      deck: input.deck,
      coachingProvenance: input.coachingProvenance,
    });
  } catch (error) {
    return failGenerateDeckJob(
      input.dataSource,
      input.jobId,
      75,
      "PYTHON_WORKER_GENERATE_DECK_INVALID_RESPONSE",
      error instanceof Error
        ? error.message
        : "Python worker returned invalid deck generation response.",
    );
  }

  return updateGenerateDeckJob(input.dataSource, input.jobId, {
    status: "succeeded",
    progress: 100,
    message: "AI deck generation completed.",
    result,
    error: null,
  });
}

export async function failGenerateDeckQualityGate(
  dataSource: DataSource,
  jobId: string,
  workerPayload: GenerateDeckWorkerPayload,
  deck: Deck,
  validation: GenerateDeckValidation,
  warnings: string[],
  options: {
    errorCode?: string;
    diagnostics?: GenerateDeckDiagnostics;
  } = {},
) {
  const issueCount = allValidationIssues(validation).length;
  const result = generateDeckJobResultSchema.parse({
    deckId: deck.deckId,
    ...workerPayload,
    deck,
    warnings,
    validation,
    diagnostics: {
      ...workerPayload.diagnostics,
      ...options.diagnostics,
      validationIssueCount: issueCount,
    },
  });
  return failGenerateDeckJob(
    dataSource,
    jobId,
    90,
    options.errorCode ?? "GENERATE_DECK_QUALITY_GATE_FAILED",
    `Deck generation retained ${issueCount} quality issue(s).`,
    result,
  );
}

export async function failGenerateDeckVisualQaUnavailable(
  dataSource: DataSource,
  jobId: string,
  workerPayload: GenerateDeckWorkerPayload,
  deck: Deck,
  validation: GenerateDeckValidation,
  warnings: string[],
  message: string,
  attempts: {
    visualReviewAttempts: number;
    visualRepairAttempts: number;
  },
) {
  const result = generateDeckJobResultSchema.parse({
    deckId: deck.deckId,
    ...workerPayload,
    deck,
    warnings,
    validation,
    diagnostics: {
      ...workerPayload.diagnostics,
      visualQaStatus: "failed",
      ...attempts,
      visualIssueCodes: [],
      validationIssueCount: allValidationIssues(validation).length,
    },
  });
  return failGenerateDeckJob(
    dataSource,
    jobId,
    90,
    "GENERATE_DECK_VISUAL_QA_UNAVAILABLE",
    message,
    result,
  );
}

export async function failGenerateDeckOptionalImageFallback(
  dataSource: DataSource,
  jobId: string,
  workerPayload: GenerateDeckWorkerPayload,
  deck: Deck,
  validation: GenerateDeckValidation,
  warnings: string[],
  message: string,
) {
  const result = generateDeckJobResultSchema.parse({
    deckId: deck.deckId,
    ...workerPayload,
    deck,
    warnings,
    validation,
    diagnostics: {
      ...workerPayload.diagnostics,
      validationIssueCount: allValidationIssues(validation).length,
    },
  });
  return failGenerateDeckJob(
    dataSource,
    jobId,
    90,
    "GENERATE_DECK_OPTIONAL_IMAGE_FALLBACK_FAILED",
    message,
    result,
  );
}

export async function failGenerateDeckJob(
  dataSource: DataSource,
  jobId: string,
  progress: number,
  code: string,
  message: string,
  result: Record<string, unknown> | null = null,
): Promise<Job> {
  return updateGenerateDeckJob(dataSource, jobId, {
    status: "failed",
    progress,
    message: "AI deck generation failed.",
    result,
    error: { code, message },
  });
}

export async function updateGenerateDeckJob(
  dataSource: DataSource,
  jobId: string,
  patch: GenerateDeckJobPatch,
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
    [
      jobId,
      patch.status,
      patch.progress,
      patch.message,
      patch.result,
      patch.error,
    ],
  );

  const row = readFirstQueryRow<JobRow>(rows);
  if (!row) {
    throw new Error(`Job not found: ${jobId}`);
  }

  return rowToJob(row);
}

async function saveDeck(dataSource: DataSource, deck: Deck): Promise<void> {
  await dataSource.query(
    `
      INSERT INTO decks (project_id, deck_id, deck_json, version, updated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (project_id)
      DO UPDATE SET
        deck_id = EXCLUDED.deck_id,
        deck_json = EXCLUDED.deck_json,
        version = EXCLUDED.version,
        updated_at = EXCLUDED.updated_at
    `,
    [deck.projectId, deck.deckId, deck, deck.version],
  );
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
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp value: ${String(value)}`);
  }

  return date.toISOString();
}
