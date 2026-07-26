export type PrompterProgressPhase = "tracking" | "candidate";

export type PrompterProgressSentence = {
  sentenceId: string;
  index: number;
  matchable: boolean;
  isFinalTrigger: boolean;
};

export type PrompterProgressEvidence = {
  sentenceId: string;
  revision: number;
  candidate: boolean;
  commitEligible: boolean;
  source: "lexical" | "semantic-assisted";
  atMs: number;
};

export type PrompterBoundary = {
  type: "stt-final" | "pause-started";
  atMs: number;
};

export type PrompterProgressSnapshot = {
  slideId: string;
  revision: number;
  phase: PrompterProgressPhase;
  currentSentenceId: string | null;
  candidateSentenceId: string | null;
  candidateSinceMs: number | null;
  hasCurrentLexicalEvidence?: boolean;
  committedSentenceIds: string[];
  skippedSentenceIds?: string[];
  lastCommittedSentenceId: string | null;
  lastCommitSource: "lexical" | "semantic-assisted" | "manual" | null;
  finalSentenceCommitted: boolean;
};

export type PrompterProgressTracker = {
  acceptEvidence: (evidence: PrompterProgressEvidence) => boolean;
  resyncForward: (evidence: PrompterProgressEvidence) => boolean;
  acceptBoundary: (boundary: PrompterBoundary) => boolean;
  manualNext: (atMs: number) => boolean;
  manualPrevious: (atMs: number) => boolean;
  skipCurrent: (atMs: number) => boolean;
  reset: () => void;
  snapshot: () => PrompterProgressSnapshot;
};

export const defaultPrompterResyncDistance = 3;

export function createPrompterProgressTracker(options: {
  slideId: string;
  sentences: readonly PrompterProgressSentence[];
  maxEvidenceAgeMs?: number;
  maxResyncDistance?: number;
}): PrompterProgressTracker {
  const sentences = options.sentences
    .filter((sentence) => sentence.matchable)
    .sort((left, right) => left.index - right.index);
  const maxEvidenceAgeMs = options.maxEvidenceAgeMs ?? 1_500;
  const maxResyncDistance = Math.max(
    1,
    Math.trunc(options.maxResyncDistance ?? defaultPrompterResyncDistance)
  );
  let currentIndex = 0;
  let revision = 0;
  let phase: PrompterProgressPhase = "tracking";
  let latestEvidence: PrompterProgressEvidence | null = null;
  let candidateSinceMs: number | null = null;
  let hasCurrentLexicalEvidence = false;
  let committedSentenceIds: string[] = [];
  let skippedSentenceIds: string[] = [];
  let lastCommittedSentenceId: string | null = null;
  let lastCommitSource: PrompterProgressSnapshot["lastCommitSource"] = null;

  function acceptEvidence(evidence: PrompterProgressEvidence) {
    const currentSentence = sentences[currentIndex];
    if (
      !currentSentence ||
      evidence.sentenceId !== currentSentence.sentenceId ||
      evidence.revision !== revision
    ) {
      return false;
    }

    latestEvidence = evidence;
    if (evidence.candidate) {
      if (evidence.source === "lexical") {
        hasCurrentLexicalEvidence = true;
      }
      phase = "candidate";
      candidateSinceMs ??= evidence.atMs;
    } else {
      clearCandidate();
    }

    return true;
  }

  function acceptBoundary(boundary: PrompterBoundary) {
    if (!isFreshCommitEvidence(boundary.atMs)) {
      if (latestEvidence && boundary.atMs - latestEvidence.atMs > maxEvidenceAgeMs) {
        clearCandidate();
      }
      return false;
    }

    return commitCurrent(latestEvidence?.source ?? "lexical");
  }

  function resyncForward(evidence: PrompterProgressEvidence) {
    const currentSentence = sentences[currentIndex];
    const targetIndex = sentences.findIndex(
      (sentence, index) =>
        index > currentIndex && sentence.sentenceId === evidence.sentenceId
    );
    const resyncDistance = targetIndex - currentIndex;
    if (
      !currentSentence ||
      targetIndex < 0 ||
      resyncDistance > maxResyncDistance ||
      !evidence.candidate ||
      !evidence.commitEligible
    ) {
      return false;
    }

    const skippedSentenceIdSet = new Set(skippedSentenceIds);
    for (const skippedSentence of sentences.slice(currentIndex, targetIndex)) {
      skippedSentenceIdSet.add(skippedSentence.sentenceId);
    }
    skippedSentenceIds = [...skippedSentenceIdSet];
    currentIndex = targetIndex;
    revision += 1;
    latestEvidence = { ...evidence, revision };
    phase = "candidate";
    candidateSinceMs = evidence.atMs;
    hasCurrentLexicalEvidence = evidence.source === "lexical";
    return true;
  }

  function manualNext(_atMs: number) {
    return commitCurrent("manual");
  }

  function manualPrevious(_atMs: number) {
    if (sentences.length === 0) {
      return false;
    }

    const targetIndex = Math.max(
      Math.min(currentIndex - 1, sentences.length - 1),
      0
    );
    const targetSentence = sentences[targetIndex];
    if (!targetSentence) {
      return false;
    }

    currentIndex = targetIndex;
    committedSentenceIds = committedSentenceIds.filter((sentenceId) => {
      const sentence = sentences.find((candidate) => candidate.sentenceId === sentenceId);
      return sentence ? sentence.index < targetSentence.index : false;
    });
    skippedSentenceIds = skippedSentenceIds.filter((sentenceId) => {
      const sentence = sentences.find((candidate) => candidate.sentenceId === sentenceId);
      return sentence ? sentence.index < targetSentence.index : false;
    });
    lastCommittedSentenceId = committedSentenceIds.at(-1) ?? null;
    lastCommitSource = null;
    revision += 1;
    hasCurrentLexicalEvidence = false;
    clearCandidate();
    return true;
  }

  function skipCurrent(_atMs: number) {
    const currentSentence = sentences[currentIndex];
    const nextSentence = sentences[currentIndex + 1];
    if (!currentSentence || !nextSentence) {
      return false;
    }

    if (!skippedSentenceIds.includes(currentSentence.sentenceId)) {
      skippedSentenceIds = [...skippedSentenceIds, currentSentence.sentenceId];
    }
    currentIndex += 1;
    revision += 1;
    hasCurrentLexicalEvidence = false;
    clearCandidate();
    return true;
  }

  function reset() {
    currentIndex = 0;
    committedSentenceIds = [];
    skippedSentenceIds = [];
    lastCommittedSentenceId = null;
    lastCommitSource = null;
    revision += 1;
    hasCurrentLexicalEvidence = false;
    clearCandidate();
  }

  function snapshot(): PrompterProgressSnapshot {
    const currentSentence = sentences[currentIndex] ?? null;
    return {
      slideId: options.slideId,
      revision,
      phase,
      currentSentenceId: currentSentence?.sentenceId ?? null,
      candidateSentenceId:
        phase === "candidate" ? (latestEvidence?.sentenceId ?? null) : null,
      candidateSinceMs,
      hasCurrentLexicalEvidence,
      committedSentenceIds: [...committedSentenceIds],
      ...(skippedSentenceIds.length > 0
        ? { skippedSentenceIds: [...skippedSentenceIds] }
        : {}),
      lastCommittedSentenceId,
      lastCommitSource,
      finalSentenceCommitted:
        sentences.length > 0 && currentIndex >= sentences.length
    };
  }

  function isFreshCommitEvidence(atMs: number) {
    if (!latestEvidence?.candidate || !latestEvidence.commitEligible) {
      return false;
    }

    const ageMs = atMs - latestEvidence.atMs;
    return ageMs >= 0 && ageMs <= maxEvidenceAgeMs;
  }

  function commitCurrent(
    source: Exclude<PrompterProgressSnapshot["lastCommitSource"], null>
  ) {
    const currentSentence = sentences[currentIndex];
    if (!currentSentence) {
      return false;
    }

    committedSentenceIds = [...committedSentenceIds, currentSentence.sentenceId];
    lastCommittedSentenceId = currentSentence.sentenceId;
    lastCommitSource = source;
    currentIndex += 1;
    revision += 1;
    hasCurrentLexicalEvidence = false;
    clearCandidate();
    return true;
  }

  function clearCandidate() {
    latestEvidence = null;
    candidateSinceMs = null;
    phase = "tracking";
  }

  return {
    acceptEvidence,
    resyncForward,
    acceptBoundary,
    manualNext,
    manualPrevious,
    skipCurrent,
    reset,
    snapshot
  };
}
