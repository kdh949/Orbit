import type { PronunciationLexiconEntry } from "@orbit/shared";
import type { LiveSttResult } from "../stt/liveSttPort";
import { createDefaultPhraseExtractor } from "./phraseExtractor";
import {
  createPrompterLexicalEvidenceAccumulator,
  type PrompterLexicalEvidenceAccumulator,
  type PrompterLexicalEvidenceSnapshot
} from "./prompterLexicalEvidence";
import { createPrompterFinalDeduplicator } from "./prompterFinalDeduplicator";
import { createPrompterProgressTracker, type PrompterBoundary } from "./prompterProgressTracker";
import {
  mergeSpeechTrackingConfig,
  type SpeechTrackingConfig,
  type SpeechTrackingConfigOverride
} from "./speechTrackingConfig";
import type {
  ExtractedSentence,
  SpeechTrackerSnapshot,
  SpeechTrackingEvent
} from "./speechTrackingEvents";
import {
  calculateWordMultisetRecall,
  createFinalSegmentWindow,
  matchKeywordAliases,
  matchPhraseCandidate,
  tokenizeSpeechRecallWords
} from "./speechMatcher";
import { createScriptProgressTracker } from "./scriptProgressTracker";
import { toCanonicalPronunciationMatchingText } from "./pronunciationMatchingAdapter";

export type SpeechTrackerKeyword = {
  keywordId: string;
  text: string;
  synonyms: readonly string[];
  abbreviations: readonly string[];
};

export type CreateSpeechTrackerInput = {
  slideId: string;
  speakerNotes: string;
  keywords: readonly SpeechTrackerKeyword[];
  controlPhrases?: readonly string[];
  pronunciationEntries?: readonly PronunciationLexiconEntry[];
  threshold?: number;
  config?: SpeechTrackingConfigOverride;
  now?: () => number;
};

type PrompterLookaheadCarry = {
  slideId: string;
  ownerRevision: number;
  ownerCurrentSentenceId: string;
  sentenceId: string;
  accumulator: PrompterLexicalEvidenceAccumulator;
  evidence: PrompterLexicalEvidenceSnapshot;
  atMs: number;
};

type InheritedPrompterEvidenceOwner = {
  slideId: string;
  revision: number;
  sentenceId: string;
  sourceFinalAtMs: number;
};

export type SpeechTracker = {
  acceptResult: (result: LiveSttResult) => SpeechTrackingEvent[];
  acceptSemanticSentenceMatch: (input: {
    sentenceId: string;
    transcript: string;
    similarity: number;
    matchKind?: "covered" | "paraphrased";
    lexicalOverlap?: number;
    expectedPrompterRevision?: number;
    atMs: number;
  }) => SpeechTrackingEvent[];
  acceptPrompterBoundary: (boundary: PrompterBoundary) => boolean;
  manualNextPrompter: (atMs: number) => boolean;
  manualPreviousPrompter: (atMs: number) => boolean;
  skipCurrentPrompter: (atMs: number) => boolean;
  exitSlide: (atMs: number) => SpeechTrackingEvent[];
  resetForSlideVisit: () => void;
  snapshot: () => SpeechTrackerSnapshot;
};

export function createSpeechTracker(input: CreateSpeechTrackerInput): SpeechTracker {
  const config = mergeSpeechTrackingConfig(input.config);
  const threshold = input.threshold ?? 0.7;
  const extractor = createDefaultPhraseExtractor({
    ...input.config,
    controlPhrases: input.controlPhrases
  });
  const sentences = extractor.extract(input.speakerNotes);
  const matchableSentenceIds = sentences
    .filter((sentence) => sentence.matchable)
    .map((sentence) => sentence.sentenceId);
  const keywordAliases = input.keywords.map((keyword) => ({
    keywordId: keyword.keywordId,
    aliases: [keyword.text, ...keyword.synonyms, ...keyword.abbreviations]
  }));

  const sessionKeywordHits = new Set<string>();
  const visit = createVisitState();
  const scriptProgressTracker = createScriptProgressTracker(
    input.speakerNotes,
    {
      pronunciationEntries: input.pronunciationEntries,
      slideId: input.slideId,
    }
  );
  const prompterProgressTracker = createPrompterProgressTracker({
    slideId: input.slideId,
    sentences
  });
  let prompterLexicalEvidence = createLexicalEvidenceForCurrentSentence();
  let prompterLookaheadLexicalEvidence = createLexicalEvidenceForNextSentence();
  let inheritedPrompterEvidenceOwner: InheritedPrompterEvidenceOwner | null =
    null;
  const prompterFinalDeduplicator = createPrompterFinalDeduplicator({
    now: input.now ?? (() => Date.now())
  });

  function acceptResult(result: LiveSttResult): SpeechTrackingEvent[] {
    const matchingText = toCanonicalPronunciationMatchingText(
      result.text,
      input.pronunciationEntries,
      input.slideId,
    );
    const scriptProgress = scriptProgressTracker.acceptResult(result);
    const atMs = result.timestampMs[1];
    const events: SpeechTrackingEvent[] = [];
    const prompterProgressBeforeResult = prompterProgressTracker.snapshot();
    const isDuplicatePrompterFinal =
      result.isFinal &&
      !prompterFinalDeduplicator.acceptFinal(result, {
        slideId: prompterProgressBeforeResult.slideId,
        revision: prompterProgressBeforeResult.revision,
        currentSentenceId: prompterProgressBeforeResult.currentSentenceId
      });

    if (!isDuplicatePrompterFinal) {
      const prompterProgress = prompterProgressBeforeResult;
      let lookaheadCarry: PrompterLookaheadCarry | null = null;
      const currentSentence = sentences.find(
        (sentence) =>
          sentence.sentenceId === prompterProgress.currentSentenceId,
      );
      let currentCommitEligible = false;
      if (currentSentence && prompterLexicalEvidence) {
        const lexicalEvidence = prompterLexicalEvidence.acceptResult({
          sentenceId: currentSentence.sentenceId,
          transcriptText: matchingText,
          sentenceProgressRatio:
            scriptProgress.sentenceId === currentSentence.sentenceId
              ? scriptProgress.sentenceRatio
              : 0,
          atMs
        });
        currentCommitEligible =
          isPrompterLexicalCommitEligible(lexicalEvidence);
        prompterProgressTracker.acceptEvidence({
          sentenceId: currentSentence.sentenceId,
          revision: prompterProgress.revision,
          candidate: lexicalEvidence.matchedMeaningfulTokenCount > 0,
          commitEligible: currentCommitEligible,
          source: "lexical",
          atMs: lexicalEvidence.updatedAtMs ?? atMs
        });
      }

      const nextSentence = findNextPrompterSentence(
        currentSentence?.sentenceId,
      );
      if (nextSentence && prompterLookaheadLexicalEvidence) {
        const lookaheadEvidence = prompterLookaheadLexicalEvidence.acceptResult(
          {
            sentenceId: nextSentence.sentenceId,
            transcriptText: matchingText,
            sentenceProgressRatio:
              scriptProgress.sentenceId === nextSentence.sentenceId
                ? scriptProgress.sentenceRatio
                : 0,
            atMs
          },
        );
        const lookaheadCommitEligible =
          isPrompterLexicalCommitEligible(lookaheadEvidence);
        if (result.isFinal && currentSentence && currentCommitEligible) {
          const residualTranscript = removeCurrentSentenceEvidence({
            transcriptText: matchingText,
            currentSentenceText: currentSentence.text,
          });
          const carryAccumulator =
            createPrompterLexicalEvidenceAccumulator(nextSentence);
          const carryEvidence = carryAccumulator.acceptResult({
            sentenceId: nextSentence.sentenceId,
            transcriptText: residualTranscript,
            sentenceProgressRatio:
              scriptProgress.sentenceId === nextSentence.sentenceId
                ? scriptProgress.sentenceRatio
                : 0,
            atMs,
          });
          if (
            isPrompterLexicalCommitEligible(carryEvidence) &&
            hasSufficientMeaningfulLexicalEvidence(carryEvidence)
          ) {
            lookaheadCarry = {
              slideId: prompterProgress.slideId,
              ownerRevision: prompterProgress.revision,
              ownerCurrentSentenceId: currentSentence.sentenceId,
              sentenceId: nextSentence.sentenceId,
              accumulator: carryAccumulator,
              evidence: carryEvidence,
              atMs
            };
          }
        }
        if (
          !currentCommitEligible &&
          lookaheadCommitEligible &&
          (result.isFinal || lookaheadEvidence.stableResultCount >= 2)
        ) {
          const resynced = prompterProgressTracker.resyncNext({
            sentenceId: nextSentence.sentenceId,
            revision: prompterProgress.revision,
            candidate: true,
            commitEligible: true,
            source: "lexical",
            atMs: lookaheadEvidence.updatedAtMs ?? atMs
          });
          if (resynced) {
            refreshPrompterLexicalEvidence();
          }
        }
      }

      if (result.isFinal) {
        const committed = acceptPrompterBoundary({ type: "stt-final", atMs });
        if (committed) {
          const progressAfterCommit = prompterProgressTracker.snapshot();
          prompterFinalDeduplicator.markCommitted(result, {
            slideId: progressAfterCommit.slideId,
            revision: progressAfterCommit.revision,
            currentSentenceId: progressAfterCommit.currentSentenceId
          });
          if (lookaheadCarry) {
            inheritPrompterLookaheadEvidence(lookaheadCarry);
          }
        }
      }
    }

    const finalWindow = createFinalSegmentWindow({
      previousFinalTranscript: visit.finalTranscript,
      latestFinalSegment: matchingText,
      tailCharacters: config.matchingTailCharacters,
    });
    const trackingTranscript = appendTranscript(
      visit.finalTranscript,
      matchingText,
    );

    if (result.isFinal) {
      visit.finalTranscript = trackingTranscript;
    }

    for (const sentence of sentences) {
      if (
        !sentence.matchable ||
        visit.coveredSentenceIds.has(sentence.sentenceId)
      ) {
        continue;
      }

      if (isSentenceMatched(sentence, finalWindow, config, result.isFinal)) {
        events.push(
          ...coverSentence(sentence, atMs, {
            matchKind: "covered"
          })
        );
      }
    }

    for (const match of matchKeywordAliases({
      transcript: result.text,
      keywords: keywordAliases,
      pronunciationEntries: input.pronunciationEntries,
      slideId: input.slideId,
    })) {
      if (sessionKeywordHits.has(match.keywordId)) {
        continue;
      }

      sessionKeywordHits.add(match.keywordId);
      events.push({
        type: "keyword-hit",
        slideId: input.slideId,
        keywordId: match.keywordId,
        atMs
      });
    }

    const coverage = computeCoverage({
      coveredSentenceCount: visit.coveredSentenceIds.size,
      matchableSentenceCount: matchableSentenceIds.length,
      transcript: trackingTranscript,
      speakerNotes: input.speakerNotes,
      threshold,
      config
    });
    visit.sentenceCoverage = coverage.sentenceCoverage;
    visit.wordCoverage = coverage.wordCoverage;
    visit.effectiveCoverage = coverage.effectiveCoverage;

    events.push({
      type: "coverage-updated",
      slideId: input.slideId,
      sentenceCoverage: coverage.sentenceCoverage,
      wordCoverage: coverage.wordCoverage,
      effectiveCoverage: coverage.effectiveCoverage,
      atMs
    });

    return events;
  }

  function acceptSemanticSentenceMatch(options: {
    sentenceId: string;
    transcript: string;
    similarity: number;
    matchKind?: "covered" | "paraphrased";
    lexicalOverlap?: number;
    expectedPrompterRevision?: number;
    atMs: number;
  }): SpeechTrackingEvent[] {
    const sentence = sentences.find(
      (candidate) =>
        candidate.sentenceId === options.sentenceId && candidate.matchable,
    );
    if (!sentence) {
      return [];
    }

    const currentPrompterRevision = prompterProgressTracker.snapshot().revision;
    if (
      options.expectedPrompterRevision === undefined ||
      options.expectedPrompterRevision === currentPrompterRevision
    ) {
      acceptSemanticPrompterAssistance(sentence.sentenceId, options.atMs);
    }
    if (visit.coveredSentenceIds.has(sentence.sentenceId)) {
      return [];
    }

    const events = coverSentence(sentence, options.atMs, {
      matchKind: options.matchKind ?? "paraphrased",
      similarity: options.similarity,
      lexicalOverlap: options.lexicalOverlap
    });
    events.push(createCoverageUpdatedEvent(options.atMs));
    return events;
  }

  function exitSlide(atMs: number): SpeechTrackingEvent[] {
    const missingKeywordIds = input.keywords
      .map((keyword) => keyword.keywordId)
      .filter((keywordId) => !sessionKeywordHits.has(keywordId));
    visit.provisionalMissingKeywordIds = new Set(missingKeywordIds);

    return missingKeywordIds.map((keywordId) => ({
      type: "keyword-missing",
      slideId: input.slideId,
      keywordId,
      provisional: true,
      atMs
    }));
  }

  function acceptPrompterBoundary(boundary: PrompterBoundary) {
    const before = prompterProgressTracker.snapshot();
    const committed = prompterProgressTracker.acceptBoundary(boundary);
    if (committed) {
      refreshPrompterLexicalEvidence();
      return true;
    }

    const after = prompterProgressTracker.snapshot();
    const staleCandidateCleared =
      before.phase === "candidate" &&
      after.phase === "tracking" &&
      before.revision === after.revision &&
      before.currentSentenceId === after.currentSentenceId;
    if (staleCandidateCleared) {
      refreshPrompterLexicalEvidence();
    }
    return false;
  }

  function manualNextPrompter(atMs: number) {
    const committed = prompterProgressTracker.manualNext(atMs);
    if (committed) {
      refreshPrompterLexicalEvidence();
    }
    return committed;
  }

  function manualPreviousPrompter(atMs: number) {
    const moved = prompterProgressTracker.manualPrevious(atMs);
    if (moved) {
      refreshPrompterLexicalEvidence();
    }
    return moved;
  }

  function skipCurrentPrompter(atMs: number) {
    const moved = prompterProgressTracker.skipCurrent(atMs);
    if (moved) {
      refreshPrompterLexicalEvidence();
    }
    return moved;
  }

  function resetForSlideVisit() {
    const nextVisit = createVisitState();
    Object.assign(visit, nextVisit);
    scriptProgressTracker.reset();
    prompterProgressTracker.reset();
    refreshPrompterLexicalEvidence();
    prompterFinalDeduplicator.reset();
  }

  function snapshot(): SpeechTrackerSnapshot {
    const prompterProgress = prompterProgressTracker.snapshot();
    return {
      slideId: input.slideId,
      coveredSentenceIds: Array.from(visit.coveredSentenceIds),
      coveredSentenceMatchKinds: Object.fromEntries(
        visit.coveredSentenceMatchKinds.entries(),
      ),
      matchableSentenceCount: matchableSentenceIds.length,
      sentenceCoverage: visit.sentenceCoverage,
      wordCoverage: visit.wordCoverage,
      effectiveCoverage: visit.effectiveCoverage,
      finalSentenceSpoken: visit.finalSentenceSpoken,
      hitKeywordIds: Array.from(sessionKeywordHits),
      provisionalMissingKeywordIds: Array.from(
        visit.provisionalMissingKeywordIds,
      ),
      scriptProgress: scriptProgressTracker.snapshot(),
      prompterProgress,
      finalSentenceCommitted: prompterProgress.finalSentenceCommitted
    };
  }

  return {
    acceptResult,
    acceptSemanticSentenceMatch,
    acceptPrompterBoundary,
    manualNextPrompter,
    manualPreviousPrompter,
    skipCurrentPrompter,
    exitSlide,
    resetForSlideVisit,
    snapshot
  };

  function createLexicalEvidenceForCurrentSentence(): PrompterLexicalEvidenceAccumulator | null {
    const currentSentenceId =
      prompterProgressTracker.snapshot().currentSentenceId;
    const currentSentence = sentences.find(
      (sentence) => sentence.sentenceId === currentSentenceId
    );
    return currentSentence
      ? createPrompterLexicalEvidenceAccumulator(currentSentence)
      : null;
  }

  function createLexicalEvidenceForNextSentence(): PrompterLexicalEvidenceAccumulator | null {
    const currentSentenceId =
      prompterProgressTracker.snapshot().currentSentenceId;
    const nextSentence = findNextPrompterSentence(currentSentenceId);
    return nextSentence
      ? createPrompterLexicalEvidenceAccumulator(nextSentence)
      : null;
  }

  function findNextPrompterSentence(currentSentenceId?: string | null) {
    if (!currentSentenceId) {
      return null;
    }
    const matchableSentences = sentences.filter(
      (sentence) => sentence.matchable,
    );
    const currentIndex = matchableSentences.findIndex(
      (sentence) => sentence.sentenceId === currentSentenceId,
    );
    return currentIndex >= 0
      ? (matchableSentences[currentIndex + 1] ?? null)
      : null;
  }

  function refreshPrompterLexicalEvidence() {
    inheritedPrompterEvidenceOwner = null;
    prompterLexicalEvidence = createLexicalEvidenceForCurrentSentence();
    prompterLookaheadLexicalEvidence = createLexicalEvidenceForNextSentence();
  }

  function inheritPrompterLookaheadEvidence(carry: PrompterLookaheadCarry) {
    const progress = prompterProgressTracker.snapshot();
    const expectedNextSentence = findNextPrompterSentence(
      carry.ownerCurrentSentenceId,
    );
    if (
      progress.slideId !== carry.slideId ||
      progress.revision !== carry.ownerRevision + 1 ||
      progress.lastCommittedSentenceId !== carry.ownerCurrentSentenceId ||
      progress.currentSentenceId !== carry.sentenceId ||
      expectedNextSentence?.sentenceId !== carry.sentenceId ||
      !isPrompterLexicalCommitEligible(carry.evidence) ||
      !hasSufficientMeaningfulLexicalEvidence(carry.evidence)
    ) {
      return false;
    }

    const accepted = prompterProgressTracker.acceptEvidence({
      sentenceId: carry.sentenceId,
      revision: progress.revision,
      candidate: true,
      commitEligible: true,
      source: "lexical",
      atMs: carry.evidence.updatedAtMs ?? carry.atMs
    });
    if (!accepted) {
      return false;
    }

    prompterLexicalEvidence = carry.accumulator;
    inheritedPrompterEvidenceOwner = {
      slideId: carry.slideId,
      revision: progress.revision,
      sentenceId: carry.sentenceId,
      sourceFinalAtMs: carry.atMs
    };
    return true;
  }

  function acceptSemanticPrompterAssistance(sentenceId: string, atMs: number) {
    const progress = prompterProgressTracker.snapshot();
    const currentEvidence = prompterLexicalEvidence?.snapshot();
    const reusesInheritedSourceFinal =
      inheritedPrompterEvidenceOwner?.slideId === progress.slideId &&
      inheritedPrompterEvidenceOwner.revision === progress.revision &&
      inheritedPrompterEvidenceOwner.sentenceId === sentenceId &&
      atMs <= inheritedPrompterEvidenceOwner.sourceFinalAtMs;
    if (
      progress.currentSentenceId === sentenceId &&
      currentEvidence &&
      currentEvidence.matchedMeaningfulTokenCount >= 2
    ) {
      if (reusesInheritedSourceFinal) {
        return;
      }
      prompterProgressTracker.acceptEvidence({
        sentenceId,
        revision: progress.revision,
        candidate: true,
        commitEligible: true,
        source: "semantic-assisted",
        atMs
      });
      acceptPrompterBoundary({ type: "stt-final", atMs });
      return;
    }

    const nextSentence = findNextPrompterSentence(progress.currentSentenceId);
    const lookaheadEvidence = prompterLookaheadLexicalEvidence?.snapshot();
    if (
      nextSentence?.sentenceId === sentenceId &&
      lookaheadEvidence &&
      lookaheadEvidence.matchedMeaningfulTokenCount >= 2 &&
      prompterProgressTracker.resyncNext({
        sentenceId,
        revision: progress.revision,
        candidate: true,
        commitEligible: true,
        source: "semantic-assisted",
        atMs
      })
    ) {
      acceptPrompterBoundary({ type: "stt-final", atMs });
    }
  }

  function coverSentence(
    sentence: ExtractedSentence,
    atMs: number,
    match: {
      matchKind: "covered" | "paraphrased";
      similarity?: number;
      lexicalOverlap?: number;
    },
  ): SpeechTrackingEvent[] {
    const events: SpeechTrackingEvent[] = [];
    visit.coveredSentenceIds.add(sentence.sentenceId);
    visit.coveredSentenceMatchKinds.set(sentence.sentenceId, match.matchKind);
    events.push({
      type: "sentence-covered",
      slideId: input.slideId,
      sentenceId: sentence.sentenceId,
      matchKind: match.matchKind,
      ...(match.similarity === undefined
        ? {}
        : { similarity: match.similarity }),
      ...(match.lexicalOverlap === undefined
        ? {}
        : { lexicalOverlap: match.lexicalOverlap }),
      atMs
    });

    if (sentence.isFinalTrigger && !visit.finalSentenceSpoken) {
      visit.finalSentenceSpoken = true;
      events.push({
        type: "last-sentence-spoken",
        slideId: input.slideId,
        sentenceId: sentence.sentenceId,
        atMs
      });
    }

    return events;
  }

  function createCoverageUpdatedEvent(atMs: number): SpeechTrackingEvent {
    const coverage = computeCoverage({
      coveredSentenceCount: visit.coveredSentenceIds.size,
      matchableSentenceCount: matchableSentenceIds.length,
      transcript: visit.finalTranscript,
      speakerNotes: input.speakerNotes,
      threshold,
      config
    });
    visit.sentenceCoverage = coverage.sentenceCoverage;
    visit.wordCoverage = coverage.wordCoverage;
    visit.effectiveCoverage = coverage.effectiveCoverage;

    return {
      type: "coverage-updated",
      slideId: input.slideId,
      sentenceCoverage: coverage.sentenceCoverage,
      wordCoverage: coverage.wordCoverage,
      effectiveCoverage: coverage.effectiveCoverage,
      atMs,
    };
  }
}

function isPrompterLexicalCommitEligible(
  evidence: PrompterLexicalEvidenceSnapshot,
) {
  if (evidence.meaningfulTokenCount === 0) {
    return false;
  }
  if (evidence.meaningfulTokenCount <= 4) {
    return evidence.lexicalRecall >= 1 && evidence.terminalAnchorMatched;
  }

  return (
    evidence.lexicalRecall >= 0.7 &&
    (evidence.terminalAnchorMatched || evidence.sentenceProgressRatio >= 0.85)
  );
}

function hasSufficientMeaningfulLexicalEvidence(
  evidence: PrompterLexicalEvidenceSnapshot,
) {
  const minimumMatchedTokenCount = Math.min(evidence.meaningfulTokenCount, 2);
  return (
    minimumMatchedTokenCount > 0 &&
    evidence.matchedMeaningfulTokenCount >= minimumMatchedTokenCount
  );
}

function removeCurrentSentenceEvidence(options: {
  transcriptText: string;
  currentSentenceText: string;
}) {
  const currentSentenceTokenCounts = countSpeechTokens(options.currentSentenceText);
  return tokenizeSpeechRecallWords(options.transcriptText)
    .filter((token) => {
      const remainingCount = currentSentenceTokenCounts.get(token) ?? 0;
      if (remainingCount === 0) {
        return true;
      }
      currentSentenceTokenCounts.set(token, remainingCount - 1);
      return false;
    })
    .join(" ");
}

function countSpeechTokens(text: string) {
  const counts = new Map<string, number>();
  for (const token of tokenizeSpeechRecallWords(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function createVisitState() {
  return {
    finalTranscript: "",
    coveredSentenceIds: new Set<string>(),
    coveredSentenceMatchKinds: new Map<string, "covered" | "paraphrased">(),
    provisionalMissingKeywordIds: new Set<string>(),
    sentenceCoverage: 0,
    wordCoverage: 0,
    effectiveCoverage: 0,
    finalSentenceSpoken: false
  };
}

function isSentenceMatched(
  sentence: ExtractedSentence,
  finalWindow: string,
  config: SpeechTrackingConfig,
  allowFuzzyMatch: boolean
) {
  return sentence.candidates.some(
    (candidate) =>
      matchPhraseCandidate({
        candidateText: candidate.text,
        finalSegmentWindow: finalWindow,
        diceThreshold: allowFuzzyMatch ? config.diceThreshold : 1
      }).matched
  );
}

function computeCoverage(options: {
  coveredSentenceCount: number;
  matchableSentenceCount: number;
  transcript: string;
  speakerNotes: string;
  threshold: number;
  config: SpeechTrackingConfig;
}) {
  const sentenceCoverage =
    options.matchableSentenceCount === 0
      ? 0
      : options.coveredSentenceCount / options.matchableSentenceCount;
  const wordCoverage = calculateWordMultisetRecall({
    scriptText: options.speakerNotes,
    transcriptText: options.transcript
  });
  const effectiveCoverage = computeEffectiveCoverage({
    sentenceCoverage,
    wordCoverage,
    threshold: options.threshold,
    config: options.config
  });

  return {
    sentenceCoverage,
    wordCoverage,
    effectiveCoverage
  };
}

function computeEffectiveCoverage(options: {
  sentenceCoverage: number;
  wordCoverage: number;
  threshold: number;
  config: SpeechTrackingConfig;
}) {
  const { sentenceCoverage, wordCoverage, threshold, config } = options;
  const correctionWindow = config.hybridCoverage.correctionWindow;
  if (Math.abs(sentenceCoverage - threshold) > correctionWindow) {
    return sentenceCoverage;
  }

  const weighted =
    config.hybridCoverage.sentenceWeight * sentenceCoverage +
    config.hybridCoverage.wordWeight * wordCoverage;
  return clamp(weighted, sentenceCoverage - correctionWindow, sentenceCoverage + correctionWindow);
}

function appendTranscript(current: string, next: string) {
  return [current.trim(), next.trim()].filter(Boolean).join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
