import type { Keyword, Slide } from "@orbit/shared/deck";
import {
  matchPronunciationAliases,
  normalizePronunciationText,
  type PronunciationLexiconSnapshot,
} from "@orbit/shared/pronunciation";
import type {
  LiveSttAnimationCueEvent,
  LiveSttKeywordDetectedEvent,
  LiveSttPartialTranscriptEvent,
} from "@orbit/shared/rehearsals";
import { normalizeLiveTranscriptText } from "../stt/liveTranscriptText";
import type { KeywordOccurrenceRuntimeMatch } from "./keywordOccurrenceRuntime";

type LiveKeywordCandidate = {
  keyword: Keyword;
  aliases: string[];
};

export type LiveTranscriptAnalysis = {
  slideId: string;
  transcript: string;
  coverage: number;
  detectedKeywords: LiveSttKeywordDetectedEvent[];
  missingKeywordIds: string[];
};

export type LiveKeywordOccurrenceState = {
  slideId: string;
  confirmedOccurrenceIds: string[];
};

export type OccurrenceTriggerProgress = {
  targetOccurrenceIds: string[];
  confirmedOccurrenceIds: string[];
  coverage: number;
};

export type LiveTranscriptBuffer = {
  committedTranscript: string;
  draftTranscript: string;
};

export function createLiveTranscriptBuffer(): LiveTranscriptBuffer {
  return {
    committedTranscript: "",
    draftTranscript: "",
  };
}

export function applyLiveTranscriptEvent(
  buffer: LiveTranscriptBuffer,
  event: Pick<LiveSttPartialTranscriptEvent, "transcript" | "isFinal">,
): LiveTranscriptBuffer {
  const transcript = normalizeLiveTranscriptDisplayText(event.transcript);

  if (event.isFinal) {
    return {
      committedTranscript: appendLiveTranscriptText(
        buffer.committedTranscript,
        transcript,
      ),
      draftTranscript: "",
    };
  }

  return {
    ...buffer,
    draftTranscript: transcript,
  };
}

export function renderLiveTranscriptBuffer(buffer: LiveTranscriptBuffer) {
  return appendLiveTranscriptText(
    buffer.committedTranscript,
    buffer.draftTranscript,
  );
}

export function evaluateLiveTranscript(
  slide: Slide,
  transcript: string,
  pronunciationLexicon?: PronunciationLexiconSnapshot,
): LiveTranscriptAnalysis {
  const candidates = getLiveKeywordCandidates(slide);
  const normalizedTranscript = normalizeLiveTranscriptText(transcript);
  const pronunciationEvidence = pronunciationLexicon
    ? matchPronunciationAliases(transcript, pronunciationLexicon, {
        slideIds: [slide.slideId],
      }).evidence
    : [];
  const detectedKeywords = candidates.flatMap((candidate) => {
    const matchedText = candidate.aliases.find((alias) => {
      const normalizedAlias = normalizeLiveTranscriptText(alias);
      return normalizedAlias && normalizedTranscript.includes(normalizedAlias);
    });

    const canonicalKeys = new Set(
      candidate.aliases.map(
        (alias) => normalizePronunciationText(alias).compactText,
      ),
    );
    const matchedEvidence = pronunciationEvidence.find((evidence) =>
      canonicalKeys.has(evidence.canonicalKey),
    );

    if (!matchedText && !matchedEvidence) {
      return [];
    }

    return [
      {
        type: "keyword-detected" as const,
        slideId: slide.slideId,
        keywordId: candidate.keyword.keywordId,
        text: candidate.keyword.text,
        matchedText: matchedText ?? matchedEvidence?.matchedText ?? "",
        coverage: 0,
      },
    ];
  });
  const coverage =
    candidates.length === 0 ? 0 : detectedKeywords.length / candidates.length;
  const missingKeywordIds = candidates
    .filter(
      (candidate) =>
        !detectedKeywords.some(
          (event) => event.keywordId === candidate.keyword.keywordId,
        ),
    )
    .map((candidate) => candidate.keyword.keywordId);

  return {
    slideId: slide.slideId,
    transcript,
    coverage,
    detectedKeywords: detectedKeywords.map((event) => ({
      ...event,
      coverage,
    })),
    missingKeywordIds,
  };
}

export function createKeywordOccurrenceAnimationCueEvent(args: {
  match: KeywordOccurrenceRuntimeMatch;
  slideId: string;
}): LiveSttAnimationCueEvent {
  return {
    type: "animation-cue",
    slideId: args.slideId,
    keywordId: args.match.keywordId,
    occurrenceId: args.match.occurrenceId,
    cue: "emphasis",
    text: args.match.text,
  };
}

export function createLiveKeywordOccurrenceState(
  slideId: string,
): LiveKeywordOccurrenceState {
  return {
    slideId,
    confirmedOccurrenceIds: [],
  };
}

export function getLiveKeywordOccurrenceStateForSlide(
  current: LiveKeywordOccurrenceState | null,
  slideId: string,
): LiveKeywordOccurrenceState {
  return current?.slideId === slideId
    ? current
    : createLiveKeywordOccurrenceState(slideId);
}

export function confirmKeywordOccurrenceMatches(
  state: LiveKeywordOccurrenceState,
  matches: readonly Pick<KeywordOccurrenceRuntimeMatch, "occurrenceId">[],
): LiveKeywordOccurrenceState {
  const confirmedOccurrenceIds = new Set(state.confirmedOccurrenceIds);

  for (const match of matches) {
    confirmedOccurrenceIds.add(match.occurrenceId);
  }

  return {
    slideId: state.slideId,
    confirmedOccurrenceIds: [...confirmedOccurrenceIds],
  };
}

export function getOccurrenceTriggerProgress(options: {
  targetOccurrenceIds: readonly string[];
  confirmedOccurrenceIds: readonly string[];
}): OccurrenceTriggerProgress {
  const targetOccurrenceIds = [...new Set(options.targetOccurrenceIds)];
  const targetOccurrenceIdSet = new Set(targetOccurrenceIds);
  const confirmedOccurrenceIds = [
    ...new Set(
      options.confirmedOccurrenceIds.filter((occurrenceId) =>
        targetOccurrenceIdSet.has(occurrenceId),
      ),
    ),
  ];

  return {
    targetOccurrenceIds,
    confirmedOccurrenceIds,
    coverage:
      targetOccurrenceIds.length === 0
        ? 0
        : confirmedOccurrenceIds.length / targetOccurrenceIds.length,
  };
}

export function appendLiveTranscriptText(current: string, next: string) {
  return [current, next]
    .map(normalizeLiveTranscriptDisplayText)
    .filter((part) => part.length > 0)
    .join(" ");
}

function normalizeLiveTranscriptDisplayText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getLiveKeywordCandidates(slide: Slide): LiveKeywordCandidate[] {
  return slide.keywords.map((keyword) => ({
    keyword,
    aliases: [
      keyword.text,
      ...keyword.synonyms,
      ...keyword.abbreviations,
    ].filter((value) => value.trim().length > 0),
  }));
}
