import {
  deckSchema,
  speakerNotesSuggestionJobPayloadSchema,
  speakerNotesSuggestionProviderRequestSchema,
  speakerNotesSuggestionProviderResultSchema,
  speakerNotesSuggestionResultSchema,
  type Deck,
} from "@orbit/shared/deck";
import { type Job } from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { z } from "zod";

const deckRowSchema = z.object({
  deck_json: z.record(z.unknown()),
  version: z.number().int().positive(),
  deck_id: z.string().min(1),
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

export async function processSpeakerNotesSuggestionJob(
  dataSource: DataSource,
  pythonWorkerUrl: string,
  rawPayload: unknown,
): Promise<Job> {
  const parsedPayload = speakerNotesSuggestionJobPayloadSchema.safeParse(rawPayload);
  if (!parsedPayload.success) {
    const jobId = readPayloadJobId(rawPayload);
    if (!jobId) throw new Error(parsedPayload.error.message);
    return failJob(
      dataSource,
      jobId,
      0,
      "SPEAKER_NOTES_SUGGESTION_PAYLOAD_INVALID",
      parsedPayload.error.message,
    );
  }
  const payload = parsedPayload.data;

  await updateJob(dataSource, payload.jobId, {
    status: "running",
    progress: 10,
    message: "Speaker notes source loading.",
    result: null,
    error: null,
  });

  let deck: Deck;
  try {
    deck = await loadDeck(
      dataSource,
      payload.projectId,
      payload.request.deckId,
      payload.request.baseVersion,
    );
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      10,
      "SPEAKER_NOTES_SOURCE_STALE",
      error instanceof Error ? error.message : "Speaker notes source unavailable.",
    );
  }

  const slide = deck.slides.find(
    (candidate) => candidate.slideId === payload.request.slideId,
  );
  if (!slide) {
    return failJob(
      dataSource,
      payload.jobId,
      10,
      "SPEAKER_NOTES_SLIDE_NOT_FOUND",
      "Requested slide does not exist.",
    );
  }
  const hasNotes = slide.speakerNotes.trim().length > 0;
  const requiresExistingNotes =
    payload.request.mode !== "draft" && payload.request.mode !== "icebreaker";
  if (
    (payload.request.mode === "draft" && hasNotes) ||
    (requiresExistingNotes && !hasNotes)
  ) {
    return failJob(
      dataSource,
      payload.jobId,
      10,
      "SPEAKER_NOTES_MODE_INVALID",
      hasNotes
        ? "Draft mode requires empty speaker notes."
        : "Refinement mode requires existing speaker notes.",
    );
  }

  const providerRequest = speakerNotesSuggestionProviderRequestSchema.parse({
    mode: payload.request.mode,
    slideTitle: slide.title,
    slideContent: visibleSlideText(slide),
    currentNotes: slide.speakerNotes,
    targetSpeakerNotesChars: slide.aiNotes?.timingPlan?.targetSpeakerNotesChars,
    charsPerMinute: slide.aiNotes?.timingPlan?.charsPerMinute,
  });

  await updateJob(dataSource, payload.jobId, {
    status: "running",
    progress: 45,
    message: "Speaker notes suggestion generating.",
    result: null,
    error: null,
  });

  let providerPayload: unknown;
  try {
    const response = await fetch(
      workerUrl(pythonWorkerUrl, "/ai/speaker-notes/suggest"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(providerRequest),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) {
      return failJob(
        dataSource,
        payload.jobId,
        45,
        "PYTHON_WORKER_SPEAKER_NOTES_FAILED",
        "Python worker speaker notes suggestion failed.",
      );
    }
    providerPayload = await response.json();
  } catch {
    return failJob(
      dataSource,
      payload.jobId,
      45,
      "PYTHON_WORKER_SPEAKER_NOTES_UNAVAILABLE",
      "Python worker speaker notes suggestion unavailable.",
    );
  }

  let result;
  try {
    const providerResult = speakerNotesSuggestionProviderResultSchema.parse(
      providerPayload,
    );
    const characterCount = countSpokenChars(providerResult.suggestedNotes);
    result = speakerNotesSuggestionResultSchema.parse({
      slideId: slide.slideId,
      baseVersion: payload.request.baseVersion,
      mode: payload.request.mode,
      ...providerResult,
      metrics: {
        characterCount,
        ...(providerRequest.charsPerMinute
          ? {
              estimatedSeconds: Math.ceil(
                (characterCount / providerRequest.charsPerMinute) * 60,
              ),
            }
          : {}),
      },
    });
  } catch {
    return failJob(
      dataSource,
      payload.jobId,
      70,
      "SPEAKER_NOTES_SUGGESTION_RESULT_INVALID",
      "Speaker notes suggestion result is invalid.",
    );
  }

  return updateJob(dataSource, payload.jobId, {
    status: "succeeded",
    progress: 100,
    message: "Speaker notes suggestion completed.",
    result,
    error: null,
  });
}

async function loadDeck(
  dataSource: DataSource,
  projectId: string,
  deckId: string,
  baseVersion: number,
): Promise<Deck> {
  const rows = await dataSource.query(
    "SELECT deck_id, deck_json, version FROM decks WHERE project_id = $1 AND deck_id = $2",
    [projectId, deckId],
  );
  const row = deckRowSchema.parse(readFirstQueryRow<unknown>(rows));
  const deck = deckSchema.parse(row.deck_json);
  if (row.version !== baseVersion || deck.version !== baseVersion) {
    throw new Error("Deck version does not match the suggestion baseVersion.");
  }
  const patchRows = await dataSource.query(
    "SELECT 1 FROM deck_patches WHERE project_id = $1 AND deck_id = $2 AND after_version > $3 LIMIT 1",
    [projectId, deckId, baseVersion],
  );
  if (readFirstQueryRow<unknown>(patchRows)) {
    throw new Error("Deck changed after the suggestion was requested.");
  }
  return deck;
}

function visibleSlideText(slide: Deck["slides"][number]): string[] {
  return slide.elements.flatMap((element) => {
    if (!element.visible || element.type !== "text") return [];
    const text = element.props.text.trim();
    return text && text !== slide.title.trim() ? [text.slice(0, 2_000)] : [];
  });
}

function countSpokenChars(value: string): number {
  return value.replace(/\s/g, "").length;
}

async function failJob(
  dataSource: DataSource,
  jobId: string,
  progress: number,
  code: string,
  message: string,
): Promise<Job> {
  return updateJob(dataSource, jobId, {
    status: "failed",
    progress,
    message: "Speaker notes suggestion failed.",
    result: null,
    error: { code, message },
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
  },
): Promise<Job> {
  const rows = await dataSource.query(
    `UPDATE jobs SET status = $2, progress = $3, message = $4,
      result = $5, error = $6, updated_at = now()
      WHERE job_id = $1 RETURNING *`,
    [jobId, patch.status, patch.progress, patch.message, patch.result, patch.error],
  );
  const row = readFirstQueryRow<JobRow>(rows);
  if (!row) throw new Error(`Job not found: ${jobId}`);
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

function readPayloadJobId(value: unknown): string {
  return value && typeof value === "object" && "jobId" in value &&
    typeof value.jobId === "string"
    ? value.jobId
    : "";
}

function readFirstQueryRow<T>(result: unknown): T | null {
  if (!Array.isArray(result)) return null;
  const first = result[0];
  return Array.isArray(first)
    ? ((first[0] as T | undefined) ?? null)
    : ((first as T | undefined) ?? null);
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid job timestamp.");
  return date.toISOString();
}

function workerUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}
