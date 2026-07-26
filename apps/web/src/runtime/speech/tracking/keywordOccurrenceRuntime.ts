import type { Slide } from "@orbit/shared/deck";

import { deriveKeywordOccurrences } from "@orbit/editor-core/keywords";
import {
  normalizeSpeechText,
  splitSpeakerNotesIntoSentences
} from "./phraseExtractor";

export type KeywordOccurrenceRuntimeMatch = {
  matchedScriptOffset: number;
  keywordId: string;
  occurrenceId: string;
  text: string;
  currentCharOffset: number;
};

export type KeywordOccurrenceRuntimeWindow = {
  beforeChars: number;
  afterChars: number;
};

const defaultOccurrenceTriggerWindow: KeywordOccurrenceRuntimeWindow = {
  beforeChars: 24,
  afterChars: 36
};

const defaultProgressConfidenceThreshold = 0.7;

export function matchKeywordOccurrenceTriggers(options: {
  slide: Pick<Slide, "slideId" | "speakerNotes" | "keywords">;
  targetOccurrenceIds: readonly string[];
  previousTranscript?: string;
  transcript: string;
  latestTranscript: string;
  confidence?: number | null;
  confirmedOccurrenceIds?: readonly string[];
  window?: KeywordOccurrenceRuntimeWindow;
}): KeywordOccurrenceRuntimeMatch[] {
  const confidence = options.confidence ?? 1;
  if (confidence < defaultProgressConfidenceThreshold) {
    return [];
  }

  const targetOccurrenceIds = new Set(options.targetOccurrenceIds);
  if (targetOccurrenceIds.size === 0) {
    return [];
  }

  const confirmedOccurrenceIds = new Set(options.confirmedOccurrenceIds ?? []);
  const previousCharOffset = estimateScriptProgressOffset(
    options.slide.speakerNotes,
    options.previousTranscript ?? options.transcript
  );
  const currentCharOffset = estimateScriptProgressOffset(
    options.slide.speakerNotes,
    options.transcript
  );
  const window = options.window ?? defaultOccurrenceTriggerWindow;
  const latestTranscript = normalizeSpeechText(options.latestTranscript);
  const spanStart = Math.min(previousCharOffset, currentCharOffset);
  const spanEnd = Math.max(previousCharOffset, currentCharOffset);
  const allOccurrences = deriveKeywordOccurrences(options.slide);
  const keywordHitCounts = countKeywordHitsByKeyword(
    latestTranscript,
    options.slide.keywords
  );
  const matchedOccurrenceIds = getMatchedOccurrenceIdsForTranscriptSpan({
    occurrences: allOccurrences,
    hasProgressSpan: options.previousTranscript !== undefined,
    keywordHitCounts,
    slide: options.slide,
    spanEnd,
    spanStart,
    window
  });

  return allOccurrences.flatMap((occurrence) => {
    if (
      !targetOccurrenceIds.has(occurrence.occurrenceId) ||
      confirmedOccurrenceIds.has(occurrence.occurrenceId)
    ) {
      return [];
    }

    if (!matchedOccurrenceIds.has(occurrence.occurrenceId)) {
      return [];
    }

    const keyword = options.slide.keywords.find(
      (candidate) => candidate.keywordId === occurrence.keywordId
    );
    if (!keyword || (keywordHitCounts.get(keyword.keywordId) ?? 0) === 0) {
      return [];
    }

    return [
      {
        keywordId: occurrence.keywordId,
        occurrenceId: occurrence.occurrenceId,
        text: occurrence.text,
        matchedScriptOffset: occurrence.start,
        currentCharOffset
      }
    ];
  });
}

function getMatchedOccurrenceIdsForTranscriptSpan(options: {
  occurrences: ReturnType<typeof deriveKeywordOccurrences>;
  hasProgressSpan: boolean;
  keywordHitCounts: ReadonlyMap<string, number>;
  slide: Pick<Slide, "keywords">;
  spanEnd: number;
  spanStart: number;
  window: KeywordOccurrenceRuntimeWindow;
}) {
  const occurrenceIds = new Set<string>();

  for (const keyword of options.slide.keywords) {
    const hitCount = options.keywordHitCounts.get(keyword.keywordId) ?? 0;
    if (hitCount === 0) {
      continue;
    }

    const candidates = options.occurrences.filter(
      (occurrence) => {
        if (occurrence.keywordId !== keyword.keywordId) {
          return false;
        }

        if (!options.hasProgressSpan) {
          return (
            occurrence.start <= options.spanEnd &&
            occurrence.end + options.window.afterChars >= options.spanEnd
          );
        }

        return (
          occurrence.end >= options.spanStart - options.window.beforeChars &&
          occurrence.start <= options.spanEnd
        );
      }
    );

    const orderedCandidates = options.hasProgressSpan
      ? candidates.sort(
          (left, right) =>
            Math.abs(left.start - options.spanStart) -
            Math.abs(right.start - options.spanStart)
        )
      : candidates;

    const selectedCandidates = options.hasProgressSpan
      ? orderedCandidates.slice(0, hitCount)
      : orderedCandidates;

    for (const occurrence of selectedCandidates) {
      occurrenceIds.add(occurrence.occurrenceId);
    }
  }

  return occurrenceIds;
}

function countKeywordHitsByKeyword(
  normalizedTranscript: string,
  keywords: readonly Pick<
    Slide["keywords"][number],
    "abbreviations" | "keywordId" | "synonyms" | "text"
  >[]
) {
  const terms = keywords.flatMap((keyword, keywordIndex) =>
    Array.from(
      new Set(
        [keyword.text, ...keyword.synonyms, ...keyword.abbreviations]
          .map((term) => normalizeSpeechText(term))
          .filter(Boolean)
      )
    ).map((term) => ({
      keywordId: keyword.keywordId,
      keywordIndex,
      term
    }))
  );
  const hitCounts = new Map<string, number>();
  let cursor = 0;

  while (cursor < normalizedTranscript.length) {
    const term = terms
      .filter((candidate) =>
        normalizedTranscript.startsWith(candidate.term, cursor)
      )
      .sort(
        (left, right) =>
          right.term.length - left.term.length ||
          left.keywordIndex - right.keywordIndex ||
          left.keywordId.localeCompare(right.keywordId)
      )[0];
    if (term) {
      hitCounts.set(term.keywordId, (hitCounts.get(term.keywordId) ?? 0) + 1);
      cursor += term.term.length;
      continue;
    }
    cursor += 1;
  }

  return hitCounts;
}

export function estimateScriptProgressOffset(
  speakerNotes: string,
  transcript: string
): number {
  const normalizedTranscript = normalizeSpeechText(transcript);
  if (!normalizedTranscript) {
    return 0;
  }

  let cursor = 0;
  let currentCharOffset = 0;

  for (const sentence of splitSpeakerNotesIntoSentences(speakerNotes)) {
    const start = speakerNotes.indexOf(sentence, cursor);
    if (start === -1) {
      continue;
    }

    const end = start + sentence.length;
    const matchedEnd = findMatchedSentencePrefixEnd({
      normalizedTranscript,
      sentence,
      sentenceStart: start
    });

    if (matchedEnd > currentCharOffset) {
      currentCharOffset = matchedEnd;
    }

    cursor = end;
  }

  return currentCharOffset;
}

function findMatchedSentencePrefixEnd(options: {
  normalizedTranscript: string;
  sentence: string;
  sentenceStart: number;
}): number {
  for (let end = options.sentence.length; end > 0; end -= 1) {
    const normalizedPrefix = normalizeSpeechText(options.sentence.slice(0, end));
    if (
      normalizedPrefix.length >= 2 &&
      options.normalizedTranscript.includes(normalizedPrefix)
    ) {
      return options.sentenceStart + end;
    }
  }

  return 0;
}
