import type { Slide } from "@orbit/shared";

import { deriveKeywordOccurrences } from "../../../../../../packages/editor-core/src/index";
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

export type OccurrenceRejectReason =
  | "LOW_CONFIDENCE"
  | "NO_TARGET_OCCURRENCES"
  | "NOT_TARGET_OCCURRENCE"
  | "ALREADY_CONFIRMED"
  | "KEYWORD_NOT_PRESENT"
  | "OUTSIDE_PROGRESS_WINDOW"
  | "NOT_SELECTED_FOR_HIT_COUNT"
  | "KEYWORD_DEFINITION_MISSING";

export type KeywordOccurrenceEvaluation = {
  keywordId: string;
  occurrenceId: string;
  outcome: "accepted" | "rejected";
  reasons: OccurrenceRejectReason[];
  evidence: {
    latestTranscript: string;
    normalizedLatestTranscript: string;
    confidenceAvailable: boolean;
    confidenceValue: number | null;
    confidenceThreshold: number;
    confidencePassed: boolean;
    confidencePolicy:
      | "BYPASS_THRESHOLD_WHEN_UNAVAILABLE"
      | "COMPARE_TO_THRESHOLD";
    keywordTerms: string[];
    matchedTerms: string[];
    keywordHitCount: number;
    previousCharOffset: number;
    currentCharOffset: number;
    occurrenceStart: number;
    occurrenceEnd: number;
    windowBeforeChars: number;
    windowAfterChars: number;
    isTarget: boolean;
    alreadyConfirmed: boolean;
    withinProgressWindow: boolean;
    selectedForTranscriptSpan: boolean;
  };
};

export type KeywordOccurrenceOptions = {
  slide: Pick<Slide, "slideId" | "speakerNotes" | "keywords">;
  targetOccurrenceIds: readonly string[];
  previousTranscript?: string;
  transcript: string;
  latestTranscript: string;
  confidence?: number | null;
  confirmedOccurrenceIds?: readonly string[];
  window?: KeywordOccurrenceRuntimeWindow;
};

const defaultOccurrenceTriggerWindow: KeywordOccurrenceRuntimeWindow = {
  beforeChars: 24,
  afterChars: 36
};

const defaultProgressConfidenceThreshold = 0.7;

export function evaluateKeywordOccurrenceTriggers(
  options: KeywordOccurrenceOptions
): {
  evaluations: KeywordOccurrenceEvaluation[];
  matches: KeywordOccurrenceRuntimeMatch[];
} {
  const confidenceEvaluation =
    options.confidence == null
      ? {
          available: false,
          value: null,
          threshold: defaultProgressConfidenceThreshold,
          passed: true,
          policy: "BYPASS_THRESHOLD_WHEN_UNAVAILABLE" as const
        }
      : {
          available: true,
          value: options.confidence,
          threshold: defaultProgressConfidenceThreshold,
          passed:
            options.confidence >= defaultProgressConfidenceThreshold,
          policy: "COMPARE_TO_THRESHOLD" as const
        };
  const targetOccurrenceIds = new Set(options.targetOccurrenceIds);
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
  const occurrenceSelection = getOccurrenceSelectionForTranscriptSpan({
    confirmedOccurrenceIds,
    occurrences: allOccurrences,
    hasProgressSpan: options.previousTranscript !== undefined,
    keywordHitCounts,
    slide: options.slide,
    spanEnd,
    spanStart,
    window
  });

  const evaluations = allOccurrences.map((occurrence) => {
    const keyword = options.slide.keywords.find(
      (candidate) => candidate.keywordId === occurrence.keywordId
    );
    const keywordHitCount = keyword
      ? keywordHitCounts.get(keyword.keywordId) ?? 0
      : 0;
    const isTarget = targetOccurrenceIds.has(occurrence.occurrenceId);
    const alreadyConfirmed = confirmedOccurrenceIds.has(
      occurrence.occurrenceId
    );
    const withinProgressWindow =
      occurrenceSelection.eligibleOccurrenceIds.has(occurrence.occurrenceId);
    const selectedForTranscriptSpan =
      occurrenceSelection.selectedOccurrenceIds.has(occurrence.occurrenceId);
    const reasons: OccurrenceRejectReason[] = [];

    if (!confidenceEvaluation.passed) {
      reasons.push("LOW_CONFIDENCE");
    }
    if (targetOccurrenceIds.size === 0) {
      reasons.push("NO_TARGET_OCCURRENCES");
    } else if (!isTarget) {
      reasons.push("NOT_TARGET_OCCURRENCE");
    }
    if (alreadyConfirmed) {
      reasons.push("ALREADY_CONFIRMED");
    }
    if (!keyword) {
      reasons.push("KEYWORD_DEFINITION_MISSING");
    } else if (keywordHitCount === 0) {
      reasons.push("KEYWORD_NOT_PRESENT");
    }
    if (
      isTarget &&
      !alreadyConfirmed &&
      keyword &&
      keywordHitCount > 0
    ) {
      if (!withinProgressWindow) {
        reasons.push("OUTSIDE_PROGRESS_WINDOW");
      } else if (!selectedForTranscriptSpan) {
        reasons.push("NOT_SELECTED_FOR_HIT_COUNT");
      }
    }

    const keywordTerms = keyword
      ? Array.from(
          new Set(
            [keyword.text, ...keyword.synonyms, ...keyword.abbreviations]
              .map((term) => normalizeSpeechText(term))
              .filter(Boolean)
          )
        )
      : [];
    return {
      keywordId: occurrence.keywordId,
      occurrenceId: occurrence.occurrenceId,
      outcome:
        reasons.length === 0 ? ("accepted" as const) : ("rejected" as const),
      reasons,
      evidence: {
        latestTranscript: options.latestTranscript,
        normalizedLatestTranscript: latestTranscript,
        confidenceAvailable: confidenceEvaluation.available,
        confidenceValue: confidenceEvaluation.value,
        confidenceThreshold: confidenceEvaluation.threshold,
        confidencePassed: confidenceEvaluation.passed,
        confidencePolicy: confidenceEvaluation.policy,
        keywordTerms,
        matchedTerms: keywordTerms.filter((term) =>
          latestTranscript.includes(term)
        ),
        keywordHitCount,
        previousCharOffset,
        currentCharOffset,
        occurrenceStart: occurrence.start,
        occurrenceEnd: occurrence.end,
        windowBeforeChars: window.beforeChars,
        windowAfterChars: window.afterChars,
        isTarget,
        alreadyConfirmed,
        withinProgressWindow,
        selectedForTranscriptSpan
      }
    };
  });

  const acceptedOccurrenceIds = new Set(
    evaluations
      .filter((evaluation) => evaluation.outcome === "accepted")
      .map((evaluation) => evaluation.occurrenceId)
  );
  const matches = allOccurrences.flatMap((occurrence) =>
    acceptedOccurrenceIds.has(occurrence.occurrenceId)
      ? [
          {
            keywordId: occurrence.keywordId,
            occurrenceId: occurrence.occurrenceId,
            text: occurrence.text,
            matchedScriptOffset: occurrence.start,
            currentCharOffset
          }
        ]
      : []
  );

  return { evaluations, matches };
}

export function matchKeywordOccurrenceTriggers(
  options: KeywordOccurrenceOptions
): KeywordOccurrenceRuntimeMatch[] {
  return evaluateKeywordOccurrenceTriggers(options).matches;
}

function getOccurrenceSelectionForTranscriptSpan(options: {
  confirmedOccurrenceIds: ReadonlySet<string>;
  occurrences: ReturnType<typeof deriveKeywordOccurrences>;
  hasProgressSpan: boolean;
  keywordHitCounts: ReadonlyMap<string, number>;
  slide: Pick<Slide, "keywords">;
  spanEnd: number;
  spanStart: number;
  window: KeywordOccurrenceRuntimeWindow;
}) {
  const eligibleOccurrenceIds = new Set<string>();
  const selectedOccurrenceIds = new Set<string>();

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

        // 이미 재생한 occurrence는 후보 선정 전에 제외해야 한다. 그렇지 않으면
        // 반복 키워드에서 이전 occurrence가 가장 가까운 후보로 다시 선택되고,
        // 이후 confirmed 필터에 의해 제거되면서 다음 occurrence를 놓친다.
        if (options.confirmedOccurrenceIds.has(occurrence.occurrenceId)) {
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
    for (const occurrence of candidates) {
      eligibleOccurrenceIds.add(occurrence.occurrenceId);
    }

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
      selectedOccurrenceIds.add(occurrence.occurrenceId);
    }
  }

  return { eligibleOccurrenceIds, selectedOccurrenceIds };
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
