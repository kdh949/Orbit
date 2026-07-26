import type { AdviceEventType } from "./speechTrackingConfig";
import type { PrompterProgressSnapshot } from "./prompterProgressTracker";

export type PhraseCandidate = {
  candidateId: string;
  text: string;
  normalizedText: string;
  score: number;
  wordCount: number;
  startWordIndex: number;
  endWordIndex: number;
};

export type ExtractedSentence = {
  sentenceId: string;
  text: string;
  index: number;
  isFinalTrigger: boolean;
  matchable: boolean;
  candidates: PhraseCandidate[];
};

export type ScriptProgressSnapshot = {
  charOffset: number;
  totalChars: number;
  ratio: number;
  confidence: "none" | "candidate" | "confirmed";
  sentenceId: string | null;
  sentenceCharOffset: number;
  sentenceTotalChars: number;
  sentenceRatio: number;
};

export type SpeechTrackerSnapshot = {
  slideId: string;
  coveredSentenceIds: string[];
  coveredSentenceMatchKinds: Record<string, "covered" | "paraphrased">;
  matchableSentenceCount: number;
  sentenceCoverage: number;
  wordCoverage: number;
  effectiveCoverage: number;
  finalSentenceSpoken: boolean;
  hitKeywordIds: string[];
  provisionalMissingKeywordIds: string[];
  scriptProgress?: ScriptProgressSnapshot;
  prompterProgress?: PrompterProgressSnapshot;
  finalSentenceCommitted?: boolean;
};

export type SentenceCoveredEvent = {
  type: "sentence-covered";
  slideId: string;
  sentenceId: string;
  matchKind: "covered" | "paraphrased";
  similarity?: number;
  lexicalOverlap?: number;
  atMs: number;
};

export type CoverageUpdatedEvent = {
  type: "coverage-updated";
  slideId: string;
  sentenceCoverage: number;
  wordCoverage: number;
  effectiveCoverage: number;
  atMs: number;
};

export type LastSentenceSpokenEvent = {
  type: "last-sentence-spoken";
  slideId: string;
  sentenceId: string;
  atMs: number;
};

export type KeywordHitEvent = {
  type: "keyword-hit";
  slideId: string;
  keywordId: string;
  atMs: number;
};

export type KeywordMissingEvent = {
  type: "keyword-missing";
  slideId: string;
  keywordId: string;
  provisional: boolean;
  atMs: number;
};

export type AdviceEvent = {
  type: "advice-event";
  slideId: string;
  adviceType: AdviceEventType;
  atMs: number;
};

export type AdLibDetectedEvent = {
  type: "ad-lib-detected";
  slideId: string;
  text: string;
  nearestSentenceId: string | null;
  similarity: number | null;
  atMs: number;
};

export type SentenceMissedEvent = {
  type: "sentence-missed";
  slideId: string;
  sentenceId: string;
  atMs: number;
};

export type SpeechTrackingEvent =
  | SentenceCoveredEvent
  | CoverageUpdatedEvent
  | LastSentenceSpokenEvent
  | KeywordHitEvent
  | KeywordMissingEvent
  | AdviceEvent
  | AdLibDetectedEvent
  | SentenceMissedEvent;
