import type { LiveSttPartialTranscriptEvent } from "@orbit/shared";

export type LiveSttEngineId =
  | "openai-realtime"
  | "sherpa"
  | "web-speech"
  | "moonshine";

export type LiveSttCapabilities = {
  onDevice: boolean;
  streaming: boolean;
  keywordBiasing: boolean;
  languages: string[];
};

export type LiveSttBiasPhraseSource =
  | "control-phrase"
  | "final-trigger"
  | "cue-trigger"
  | "keyword"
  | "synonym"
  | "abbreviation"
  | "representative-phrase"
  | "legacy"
  | "title"
  | "slide-text"
  | "speaker-notes"
  | "nearby-slide-text";

export type LiveSttBiasPhrase = {
  text: string;
  weight: number;
  source?: LiveSttBiasPhraseSource;
  keywordId?: string;
  canonicalText?: string;
};

export type LiveSttSessionConfig = {
  language: "ko";
  audioSource: MediaStream;
  biasPhrases?: readonly LiveSttBiasPhrase[];
};

export type LiveSttAlternative = {
  text: string;
  confidence?: number;
};

export type LiveSttResult = {
  text: string;
  isFinal: boolean;
  timestampMs: [number, number];
  confidence?: number;
  alternatives?: LiveSttAlternative[];
};

export type LiveSttErrorCode =
  | "unsupported_runtime"
  | "model_unavailable"
  | "consent_required"
  | "start_failed"
  | "runtime_error";

export class LiveSttError extends Error {
  constructor(
    readonly code: LiveSttErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LiveSttError";
  }
}

export type LiveSttUnsubscribe = () => void;

export type LiveSttPort = {
  readonly engineId: LiveSttEngineId;
  readonly capabilities: LiveSttCapabilities;
  start: (config: LiveSttSessionConfig) => Promise<void>;
  stop: () => Promise<void>;
  updateBiasPhrases: (phrases: readonly LiveSttBiasPhrase[]) => void | Promise<void>;
  onResult: (cb: (result: LiveSttResult) => void) => LiveSttUnsubscribe;
  onError: (cb: (error: LiveSttError) => void) => LiveSttUnsubscribe;
  dispose: () => void | Promise<void>;
};

export function mapPartialTranscriptToLiveSttResult(
  event: LiveSttPartialTranscriptEvent,
  elapsedMs: number
): LiveSttResult {
  const confidence =
    typeof event.confidence === "number" ? event.confidence : undefined;

  return {
    text: event.transcript,
    isFinal: event.isFinal,
    timestampMs: [elapsedMs, elapsedMs],
    ...(confidence === undefined ? {} : { confidence })
  };
}

export function normalizeLiveSttBiasPhrases(
  phrases: readonly LiveSttBiasPhrase[] = []
): LiveSttBiasPhrase[] {
  const normalized: LiveSttBiasPhrase[] = [];
  const indexesByText = new Map<string, number>();

  for (const phrase of phrases) {
    const next = normalizeLiveSttBiasPhrase(phrase);
    if (!next) {
      continue;
    }

    const index = indexesByText.get(next.text);
    if (index === undefined) {
      indexesByText.set(next.text, normalized.length);
      normalized.push(next);
      continue;
    }

    const existing = normalized[index];
    if (existing && existing.weight < next.weight) {
      normalized[index] = next;
    }
  }

  return normalized;
}

function normalizeLiveSttBiasPhrase(
  phrase: LiveSttBiasPhrase
): LiveSttBiasPhrase | null {
  const text = normalizeLiveSttBiasPhraseText(phrase.text);
  if (!text) {
    return null;
  }

  const weight = Number.isFinite(phrase.weight)
    ? clamp(phrase.weight, 0, 1)
    : 0;

  return {
    text,
    weight,
    ...(phrase.source === undefined ? {} : { source: phrase.source }),
    ...(phrase.keywordId === undefined ? {} : { keywordId: phrase.keywordId }),
    ...(phrase.canonicalText === undefined
      ? {}
      : { canonicalText: phrase.canonicalText })
  };
}

function normalizeLiveSttBiasPhraseText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
