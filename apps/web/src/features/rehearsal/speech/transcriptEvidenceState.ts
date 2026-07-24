import type { LiveSttResult } from "../stt/liveSttPort";

import { normalizeSpeechText } from "./phraseExtractor";

export type TranscriptEvidenceKind = "final" | "stable-prefix" | "pending";

export type TranscriptEvidenceState = {
  committedTranscript: string;
  emittedDraftPrefix: string;
  lastRevision: number | null;
  lastUtteranceId: string | null;
  latestDraftTranscript: string;
};

export type TranscriptEvidenceUpdate = {
  currentTranscript: string;
  isDispatchable: boolean;
  kind: TranscriptEvidenceKind;
  newSegment: string;
  previousTranscript: string;
  state: TranscriptEvidenceState;
};

/**
 * Keeps the action trigger input deliberately stricter than the live caption.
 * A partial result must survive one subsequent revision before it can trigger
 * playback; a final result is dispatchable immediately.
 */
export function applyTranscriptEvidence(
  current: TranscriptEvidenceState,
  result: Pick<LiveSttResult, "isFinal" | "resultRevision" | "text" | "utteranceId">,
): TranscriptEvidenceUpdate {
  const text = normalizeSpeechText(result.text);
  const sameUtterance = Boolean(
    result.utteranceId && result.utteranceId === current.lastUtteranceId,
  );
  const previousTranscript = renderEvidenceTranscript(current);
  const isStale =
    sameUtterance &&
    result.resultRevision !== undefined &&
    current.lastRevision !== null &&
    result.resultRevision <= current.lastRevision;

  if (!text || isStale) {
    return {
      currentTranscript: previousTranscript,
      isDispatchable: false,
      kind: "pending",
      newSegment: "",
      previousTranscript,
      state: current,
    };
  }

  const stablePrefix = result.isFinal
    ? text
    : sameUtterance
      ? getCommonPrefix(current.latestDraftTranscript, text)
      : "";
  const nextEvidenceText = mergeEvidencePrefix(
    current.emittedDraftPrefix,
    stablePrefix,
  );
  const nextTranscript = appendEvidenceText(
    current.committedTranscript,
    nextEvidenceText,
  );
  const newSegment = getIncrementalSegment(previousTranscript, nextTranscript);
  const next: TranscriptEvidenceState = {
    committedTranscript: result.isFinal
      ? appendEvidenceText(current.committedTranscript, text)
      : current.committedTranscript,
    emittedDraftPrefix: result.isFinal ? "" : nextEvidenceText,
    lastRevision: result.resultRevision ?? (sameUtterance ? current.lastRevision : null),
    lastUtteranceId: result.utteranceId ?? current.lastUtteranceId,
    latestDraftTranscript: result.isFinal ? "" : text,
  };

  return {
    currentTranscript: nextTranscript,
    isDispatchable: newSegment.length > 0,
    kind: result.isFinal ? "final" : newSegment ? "stable-prefix" : "pending",
    newSegment,
    previousTranscript,
    state: next,
  };
}

export function createTranscriptEvidenceState(): TranscriptEvidenceState {
  return {
    committedTranscript: "",
    emittedDraftPrefix: "",
    lastRevision: null,
    lastUtteranceId: null,
    latestDraftTranscript: "",
  };
}

function appendEvidenceText(previous: string, next: string) {
  if (!next || previous.endsWith(next)) return previous;
  return `${previous}${next}`;
}

function mergeEvidencePrefix(previous: string, next: string) {
  if (!next || previous.startsWith(next)) return previous;
  if (next.startsWith(previous)) return next;
  return previous;
}

function getCommonPrefix(left: string, right: string) {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;
  while (index < maxLength && left[index] === right[index]) {
    index += 1;
  }
  return left.slice(0, index);
}

function getIncrementalSegment(previous: string, next: string) {
  if (!previous) return next;
  if (next.startsWith(previous)) return next.slice(previous.length);
  return "";
}

function renderEvidenceTranscript(state: TranscriptEvidenceState) {
  return appendEvidenceText(state.committedTranscript, state.emittedDraftPrefix);
}
