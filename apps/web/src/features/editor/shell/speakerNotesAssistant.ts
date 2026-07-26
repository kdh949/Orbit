import {
  createSpeakerNotesSuggestionJobResponseSchema,
  speakerNotesSuggestionResultSchema,
  type SpeakerNotesSuggestionRequest,
  type SpeakerNotesSuggestionResult,
} from "@orbit/shared/deck";
import { jobSchema } from "@orbit/shared/jobs";

export type SpeakerNotesLengthGuidance = {
  characterCount: number;
  estimatedSeconds?: number;
  label: string;
  progressPercent?: number;
  targetCharacters?: number;
  tone: "neutral" | "short" | "balanced" | "long";
};

export const SPEAKER_NOTES_CHARS_PER_MINUTE = 400;

export function getSpeakerNotesLengthGuidance(
  notes: string,
  timingPlan?: {
    charsPerMinute?: number;
    targetSpeakerNotesChars?: number;
    targetSpokenSeconds?: number;
  },
): SpeakerNotesLengthGuidance {
  const characterCount = countSpokenChars(notes);
  const estimatedSeconds = Math.ceil(
    (characterCount / SPEAKER_NOTES_CHARS_PER_MINUTE) * 60,
  );
  const targetCharacters = getTargetCharacters(timingPlan);

  if (!targetCharacters || targetCharacters <= 0) {
    return {
      characterCount,
      estimatedSeconds,
      label: "현재 분량",
      tone: "neutral",
    };
  }

  const ratio = characterCount / targetCharacters;
  const tone = ratio < 0.8 ? "short" : ratio > 1.2 ? "long" : "balanced";
  return {
    characterCount,
    estimatedSeconds,
    label:
      tone === "short"
        ? "조금 더 보충하면 좋아요"
        : tone === "long"
          ? "핵심 위주로 줄여보세요"
          : "권장 분량에 맞아요",
    progressPercent: Math.min(100, Math.round(ratio * 100)),
    targetCharacters,
    tone,
  };
}

function getTargetCharacters(timingPlan?: {
  charsPerMinute?: number;
  targetSpeakerNotesChars?: number;
  targetSpokenSeconds?: number;
}): number | undefined {
  if (timingPlan?.targetSpokenSeconds) {
    return Math.round(
      (timingPlan.targetSpokenSeconds * SPEAKER_NOTES_CHARS_PER_MINUTE) / 60,
    );
  }
  if (
    timingPlan?.targetSpeakerNotesChars &&
    timingPlan.charsPerMinute &&
    timingPlan.charsPerMinute !== SPEAKER_NOTES_CHARS_PER_MINUTE
  ) {
    return Math.round(
      (timingPlan.targetSpeakerNotesChars * SPEAKER_NOTES_CHARS_PER_MINUTE) /
        timingPlan.charsPerMinute,
    );
  }
  return timingPlan?.targetSpeakerNotesChars;
}

export function formatSpeakerNotesDuration(seconds?: number): string | null {
  if (seconds === undefined) return null;
  if (seconds < 60) return `약 ${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `약 ${minutes}분 ${remainder}초` : `약 ${minutes}분`;
}

export async function createSpeakerNotesSuggestionJob(
  projectId: string,
  request: SpeakerNotesSuggestionRequest,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/deck/speaker-notes/suggestions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) {
    throw new Error(await readPlainError(response, "발표 메모 AI 제안을 시작하지 못했습니다."));
  }
  return createSpeakerNotesSuggestionJobResponseSchema.parse(await response.json()).job;
}

export async function waitForSpeakerNotesSuggestionJob(
  jobId: string,
  fetcher: typeof fetch = fetch,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<SpeakerNotesSuggestionResult> {
  const pollIntervalMs = options.pollIntervalMs ?? 1_200;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const startedAt = Date.now();

  for (;;) {
    const response = await fetcher(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok) {
      throw new Error(await readPlainError(response, "발표 메모 AI 제안을 불러오지 못했습니다."));
    }
    const job = jobSchema.parse(await response.json());
    if (job.status === "failed") {
      throw new Error(job.error?.message ?? "발표 메모 AI 제안 생성에 실패했습니다.");
    }
    if (job.status === "succeeded") {
      return speakerNotesSuggestionResultSchema.parse(job.result);
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("발표 메모 AI 제안 시간이 초과되었습니다.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, pollIntervalMs));
  }
}

function countSpokenChars(value: string): number {
  return value.replace(/\s/g, "").length;
}

async function readPlainError(response: Response, fallback: string): Promise<string> {
  const body = await response.text();
  if (!body) return fallback;
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : fallback;
  } catch {
    return fallback;
  }
}
